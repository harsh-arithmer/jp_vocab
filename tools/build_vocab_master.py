from __future__ import annotations

import csv
import glob
import hashlib
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Row:
    deck: str
    front: str
    back: str
    japanese: str
    hiragana: str
    english: str
    example_jp: str
    example_hiragana: str
    example_en: str


def _pick_index(seed: str, n: int) -> int:
    h = hashlib.sha256(seed.encode("utf-8")).digest()
    return int.from_bytes(h[:4], "big") % n


@dataclass(frozen=True)
class ManualExamples:
    example1_jp: str
    example1_hiragana: str
    example1_en: str
    example2_jp: str
    example2_hiragana: str
    example2_en: str
    example3_jp: str
    example3_hiragana: str
    example3_en: str


def load_manual_examples(path: str) -> dict[tuple[str, str], ManualExamples]:
    if not os.path.exists(path):
        return {}

    out: dict[tuple[str, str], ManualExamples] = {}
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            deck = (row.get("Deck") or "").strip()
            japanese = (row.get("Japanese") or "").strip()
            if not deck or not japanese:
                continue
            out[(deck, japanese)] = ManualExamples(
                example1_jp=(row.get("Example1_JP") or row.get("Example_JP") or "").strip(),
                example1_hiragana=(row.get("Example1_Hiragana") or row.get("Example_Hiragana") or "").strip(),
                example1_en=(row.get("Example1_EN") or row.get("Example_EN") or "").strip(),
                example2_jp=(row.get("Example2_JP") or "").strip(),
                example2_hiragana=(row.get("Example2_Hiragana") or "").strip(),
                example2_en=(row.get("Example2_EN") or "").strip(),
                example3_jp=(row.get("Example3_JP") or "").strip(),
                example3_hiragana=(row.get("Example3_Hiragana") or "").strip(),
                example3_en=(row.get("Example3_EN") or "").strip(),
            )
    return out


def load_manual_example1(path: str) -> dict[tuple[str, str], tuple[str, str, str]]:
    if not os.path.exists(path):
        return {}
    out: dict[tuple[str, str], tuple[str, str, str]] = {}
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            deck = (row.get("Deck") or "").strip()
            japanese = (row.get("Japanese") or "").strip()
            if not deck or not japanese:
                continue
            ex_jp = (row.get("Example_JP") or "").strip()
            ex_hira = (row.get("Example_Hiragana") or "").strip()
            ex_en = (row.get("Example_EN") or "").strip()
            if not ex_jp or not ex_en:
                continue
            out[(deck, japanese)] = (ex_jp, ex_hira, ex_en)
    return out


def make_reading(sentence_jp: str, *, term_jp: str, term_hira: str) -> str:
    if term_jp in sentence_jp:
        return sentence_jp.replace(term_jp, term_hira)
    return ""


def read_rows(csv_path: str, deck: str) -> list[Row]:
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        out: list[Row] = []
        for r in reader:
            out.append(
                Row(
                    deck=deck,
                    front=(r.get("Front") or "").strip(),
                    back=(r.get("Back") or "").strip(),
                    japanese=(r.get("Japanese") or "").strip(),
                    hiragana=(r.get("Hiragana") or "").strip(),
                    english=(r.get("English") or "").strip(),
                    example_jp=(r.get("Example_JP") or "").strip(),
                    example_hiragana=(r.get("Example_Hiragana") or "").strip(),
                    example_en=(r.get("Example_EN") or "").strip(),
                )
            )
        return out


def make_example2(row: Row) -> tuple[str, str, str]:
    jp = row.japanese
    hira = row.hiragana
    en = row.english

    specials: dict[str, tuple[str, str, str]] = {
        "結論から言うと": ("結論から言うと、問題ありません。", "けつろんからいうと、もんだいありません。", "Bottom line: no problem."),
        "次回までに": ("次回までに、対応します。", "じかいまでに、たいおうします。", "I'll handle it by next time."),
        "前倒し": ("前倒しで進めます。", "まえだおしですすめます。", "We'll move it earlier."),
        "後ろ倒し": ("後ろ倒しにします。", "うしろだおしにします。", "We'll push it back."),
        "予定通り": ("予定通り進めます。", "よていどおりすすめます。", "We'll proceed as planned."),
        "いったん": ("いったん、ここで止めます。", "いったん、ここでとめます。", "For now, we'll stop here."),
    }
    if jp in specials:
        return specials[jp]

    # Fill templates that contain a placeholder.
    if "〜" in jp:
        if "よろしいでしょうか" in jp:
            ex_jp = "この内容でよろしいでしょうか。"
            ex_hira = "このないようでよろしいでしょうか。"
            ex_en = "Would this be okay?"
            return ex_jp, ex_hira, ex_en
        if "という認識です" in jp:
            ex_jp = "この点はそういう認識です。"
            ex_hira = "このてんはそういうにんしきです。"
            ex_en = "That's my understanding."
            return ex_jp, ex_hira, ex_en
        filled_jp = jp.replace("〜", "この点")
        filled_hira = hira.replace("〜", "このてん")
        ex_jp = f"{filled_jp}。"
        ex_hira = f"{filled_hira}。"
        ex_en = f"Example: {en}"
        return ex_jp, ex_hira, ex_en

    # Incomplete question stems (e.g. 根拠は)
    if jp.endswith("は") and ("?" in en or "evidence" in en.lower()):
        ex_jp = f"{jp}ありますか。"
        ex_hira = f"{hira}ありますか。"
        ex_en = "Could you share the evidence?"
        return ex_jp, ex_hira, ex_en

    is_meeting = row.deck.endswith("meeting_phrases")
    seed = f"{row.deck}|{jp}|{hira}|{en}"

    def _make_reading(sentence_jp: str) -> str:
        return make_reading(sentence_jp, term_jp=jp, term_hira=hira)

    if jp.endswith("します"):
        frames = [
            ("いま、{t}。", "{en} now."),
            ("このあと、{t}。", "{en} after this."),
            ("{t}ので、すこしまってください。", "{en}, so please wait a moment."),
            ("{t}。おわったらおしえます。", "{en}. I'll let you know when I'm done."),
        ]
        tmpl_jp, tmpl_en = frames[_pick_index(seed + "|v1", len(frames))]
        ex_jp = tmpl_jp.format(t=jp)
        ex_hira = _make_reading(ex_jp)
        ex_en = tmpl_en.format(en=en.strip().rstrip("."))
        return ex_jp, ex_hira, ex_en

    if jp.endswith("ください"):
        frames = [
            ("すみません、{t}。", "{en}."),
            ("もういちど{t}。", "{en} again."),
            ("あとで{t}。", "{en} later."),
        ]
        tmpl_jp, tmpl_en = frames[_pick_index(seed + "|v2", len(frames))]
        ex_jp = tmpl_jp.format(t=jp)
        ex_hira = _make_reading(ex_jp)
        ex_en = tmpl_en.format(en=en.strip().rstrip("."))
        return ex_jp, ex_hira, ex_en

    # Many meeting cards are short adverbs/phrases that should feel like spoken Japanese.
    if is_meeting and jp in {"念のため", "追加で"}:
        frames = [
            ("{t}、もういちどかくにんします。", "{en} — I'll double-check."),
            ("{t}、いまのじょうきょうをきょうゆうします。", "{en} — I'll share the current status."),
            ("{t}、つぎのすてっぷをせつめいします。", "{en} — I'll explain the next steps."),
        ]
        tmpl_jp, tmpl_en = frames[_pick_index(seed + "|v3", len(frames))]
        ex_jp = tmpl_jp.format(t=jp)
        ex_hira = _make_reading(ex_jp)
        ex_en = tmpl_en.format(en=en.strip().rstrip("."))
        return ex_jp, ex_hira, ex_en

    # Questions / question-like phrases
    if jp.endswith("か") or en.strip().endswith("?"):
        frames = [
            ("このへんこうで{t}", "Is there any impact from this change?"),
            ("{t}。", "{en}?"),
            ("いまのじょうきょうで{t}", "{en}?"),
        ]
        tmpl_jp, tmpl_en = frames[_pick_index(seed + "|v4", len(frames))]
        ex_jp = tmpl_jp.format(t=jp)
        if not ex_jp.endswith("か") and not ex_jp.endswith("？"):
            ex_jp = ex_jp.rstrip("。") + "？"
        ex_hira = _make_reading(ex_jp)
        ex_en = tmpl_en.format(en=en.rstrip("?").rstrip("."))
        if not ex_en.endswith("?"):
            ex_en += "?"
        return ex_jp, ex_hira, ex_en

    if jp.endswith("です"):
        frames = [
            ("きょうは{t}。", "Today it's {en}."),
            ("このけんは{t}。", "For this item, it's {en}."),
            ("いまは{t}。", "Right now, it's {en}."),
        ]
        tmpl_jp, tmpl_en = frames[_pick_index(seed + "|v5", len(frames))]
        ex_jp = tmpl_jp.format(t=jp)
        ex_hira = _make_reading(ex_jp)
        ex_en = tmpl_en.format(en=en)
        return ex_jp, ex_hira, ex_en

    if is_meeting:
        frames = [
            ("まず{t}をそろえましょう。", "Let's align on {en} first."),
            ("{t}をきめてからすすみます。", "We'll proceed after deciding {en}."),
            ("この{t}はどうおもいますか。", "What do you think about this {en}?"),
            ("{t}をみなおして、つぎにすすみます。", "We'll revisit {en} and move forward."),
            ("{t}をきょうゆうしてもらえますか。", "Could you share the {en}?"),
        ]
        tmpl_jp, tmpl_en = frames[_pick_index(seed + "|m1", len(frames))]
        ex_jp = tmpl_jp.format(t=jp)
        ex_hira = _make_reading(ex_jp)
        ex_en = tmpl_en.format(en=en)
        return ex_jp, ex_hira, ex_en

    # Default: tech/engineering noun-ish
    frames = [
        ("この{t}をつかって、けっかをくらべます。", "We'll use {en} and compare results."),
        ("{t}をかえて、せいのうをみます。", "We'll adjust {en} and check performance."),
        ("{t}をためして、ばらつきをしらべます。", "We'll test {en} and look for variability."),
        ("{t}をついかして、せいどをあげます。", "We'll add {en} to improve accuracy."),
        ("{t}をへらして、ふかをさげます。", "We'll reduce {en} to lower load."),
        ("{t}のせっていをきろくします。", "We'll document the {en} settings."),
        ("{t}のちがいをせつめいできますか。", "Can you explain {en}?"),
        ("{t}をえらぶりゆうをきょうゆうしてください。", "Please share why we chose {en}."),
        ("まず{t}をみなおします。", "First, we'll revisit {en}."),
        ("このしすてむで{t}をつかいます。", "We'll use {en} in this system."),
    ]
    tmpl_jp, tmpl_en = frames[_pick_index(seed + "|t1", len(frames))]
    ex_jp = tmpl_jp.format(t=jp)
    ex_hira = _make_reading(ex_jp)
    ex_en = tmpl_en.format(en=en)
    return ex_jp, ex_hira, ex_en


def make_example3(row: Row) -> tuple[str, str, str]:
    jp = row.japanese
    hira = row.hiragana
    en = row.english
    seed = f"{row.deck}|{jp}|{hira}|{en}|ex3"

    def _make_reading(sentence_jp: str) -> str:
        return make_reading(sentence_jp, term_jp=jp, term_hira=hira)

    is_meeting = row.deck.endswith("meeting_phrases")

    # Meeting-specific polite "let me ..." permission requests.
    if is_meeting and ("させてください" in jp):
        frames = [
            ("{t}。ごふんだけいいですか。", "{en}. Do you have five minutes?"),
            ("{t}。いまきめきれません。", "{en}. I can't decide right now."),
            ("このけん、{t}。あとでじかんをください。", "{en} on this—please give me some time later."),
        ]
        tmpl_jp, tmpl_en = frames[_pick_index(seed + "|mperm", len(frames))]
        ex_jp = tmpl_jp.format(t=jp)
        ex_hira = _make_reading(ex_jp)
        ex_en = tmpl_en.format(en=en.strip().rstrip("."))
        return ex_jp, ex_hira, ex_en

    # Requests ending in ください (typical "please ...").
    if jp.endswith("ください"):
        frames = [
            ("{t}。よろしくおねがいします。", "{en}. Thank you."),
            ("{t}。あとででもだいじょうぶです。", "{en}. Later is fine too."),
            ("すみません、{t}。", "{en}. Sorry to bother you."),
        ]
        tmpl_jp, tmpl_en = frames[_pick_index(seed + "|kudasai", len(frames))]
        ex_jp = tmpl_jp.format(t=jp)
        ex_hira = _make_reading(ex_jp)
        ex_en = tmpl_en.format(en=en.strip().rstrip("."))
        return ex_jp, ex_hira, ex_en

    # If the card is a "します" verb, keep the term intact and add a follow-up sentence.
    if jp.endswith("します"):
        frames = [
            ("{t}。そのあと、つぎにすすみます。", "{en}. Then we'll move on."),
            ("あとで{t}。いまはべつのたいおうちゅうです。", "{en} later. I'm handling something else right now."),
            ("{t}。すこしじかんをください。", "{en}. Please give me a bit of time."),
            ("{t}。おわったらすぐにおしえます。", "{en}. I'll let you know once it's done."),
        ]
        tmpl_jp, tmpl_en = frames[_pick_index(seed + "|suru", len(frames))]
        ex_jp = tmpl_jp.format(t=jp)
        ex_hira = _make_reading(ex_jp)
        ex_en = tmpl_en.format(en=en.strip().rstrip("."))
        return ex_jp, ex_hira, ex_en

    if is_meeting:
        if jp == "念のため":
            frames = [
                ("{t}、ろぐをみます。", "{en}, I'll check the logs."),
                ("{t}、すくりーんしょっとをとります。", "{en}, I'll take a screenshot."),
                ("{t}、めもをのこします。", "{en}, I'll leave a note."),
            ]
            tmpl_jp, tmpl_en = frames[_pick_index(seed + "|nen", len(frames))]
            ex_jp = tmpl_jp.format(t=jp)
            ex_hira = _make_reading(ex_jp)
            ex_en = tmpl_en.format(en=en.strip().rstrip("."))
            return ex_jp, ex_hira, ex_en

        frames = [
            ("この{t}はあとでまとめます。", "We'll summarize this {en} later."),
            ("{t}がずれているかもしれません。", "{en} might be misaligned."),
            ("{t}をかくにんしてから、けつろんをだします。", "We'll confirm {en} before we conclude."),
            ("{t}をへんこうするよていはありますか。", "Do we plan to change the {en}?"),
        ]
        tmpl_jp, tmpl_en = frames[_pick_index(seed + "|m", len(frames))]
        ex_jp = tmpl_jp.format(t=jp)
        ex_hira = _make_reading(ex_jp)
        ex_en = tmpl_en.format(en=en.strip().rstrip("."))
        return ex_jp, ex_hira, ex_en

    # Tech/engineering: make an action sentence that differs from Example2.
    frames = [
        ("{t}をぶんせきして、げんいんをさがします。", "We'll analyze {en} and look for the root cause."),
        ("{t}をもとに、けっていをします。", "We'll make a decision based on {en}."),
        ("{t}をいったんさくじょして、えいきょうをみます。", "We'll temporarily remove {en} and see the impact."),
        ("{t}をさいていぎして、けいそくしなおします。", "We'll redefine {en} and measure again."),
        ("{t}をさいげんできるように、ろぐをのこします。", "We'll keep logs so we can reproduce {en}."),
    ]
    tmpl_jp, tmpl_en = frames[_pick_index(seed + "|t", len(frames))]
    ex_jp = tmpl_jp.format(t=jp)
    ex_hira = _make_reading(ex_jp)
    ex_en = tmpl_en.format(en=en.strip().rstrip("."))
    return ex_jp, ex_hira, ex_en


def main() -> int:
    csv_files = sorted(glob.glob("[0-9][0-9]_*.csv"))
    manual = load_manual_examples(os.path.join("data", "manual_examples.csv"))
    manual_ex1 = load_manual_example1(os.path.join("data", "manual_example1.csv"))
    all_rows: list[Row] = []
    for path in csv_files:
        deck = os.path.splitext(os.path.basename(path))[0]
        all_rows.extend(read_rows(path, deck=deck))

    os.makedirs("data", exist_ok=True)
    out_path = os.path.join("data", "vocab_master.csv")

    fieldnames = [
        "Deck",
        "Front",
        "Back",
        "Japanese",
        "Hiragana",
        "English",
        "Example_JP",
        "Example_Hiragana",
        "Example_EN",
        "Example2_JP",
        "Example2_Hiragana",
        "Example2_EN",
        "Example3_JP",
        "Example3_Hiragana",
        "Example3_EN",
        "Tags",
        "Notes",
    ]

    with open(out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        for r in all_rows:
            manual_row = manual.get((r.deck, r.japanese))

            manual_ex1_row = manual_ex1.get((r.deck, r.japanese))
            if manual_ex1_row:
                ex1_jp, ex1_hira, ex1_en = manual_ex1_row
                ex1_hira = ex1_hira or make_reading(ex1_jp, term_jp=r.japanese, term_hira=r.hiragana)
            elif manual_row and manual_row.example1_jp and manual_row.example1_en:
                ex1_jp = manual_row.example1_jp
                ex1_en = manual_row.example1_en
                ex1_hira = manual_row.example1_hiragana or make_reading(ex1_jp, term_jp=r.japanese, term_hira=r.hiragana)
            else:
                ex1_jp = r.example_jp
                ex1_hira = r.example_hiragana
                ex1_en = r.example_en

            if manual_row and manual_row.example2_jp and manual_row.example2_en:
                ex2_jp = manual_row.example2_jp
                ex2_en = manual_row.example2_en
                ex2_hira = manual_row.example2_hiragana or make_reading(ex2_jp, term_jp=r.japanese, term_hira=r.hiragana)
            else:
                ex2_jp, ex2_hira, ex2_en = make_example2(r)

            if manual_row and manual_row.example3_jp and manual_row.example3_en:
                ex3_jp = manual_row.example3_jp
                ex3_en = manual_row.example3_en
                ex3_hira = manual_row.example3_hiragana or make_reading(ex3_jp, term_jp=r.japanese, term_hira=r.hiragana)
            else:
                ex3_jp, ex3_hira, ex3_en = make_example3(r)

            writer.writerow(
                {
                    "Deck": r.deck,
                    "Front": r.front,
                    "Back": r.back,
                    "Japanese": r.japanese,
                    "Hiragana": r.hiragana,
                    "English": r.english,
                    "Example_JP": ex1_jp,
                    "Example_Hiragana": ex1_hira,
                    "Example_EN": ex1_en,
                    "Example2_JP": ex2_jp,
                    "Example2_Hiragana": ex2_hira,
                    "Example2_EN": ex2_en,
                    "Example3_JP": ex3_jp,
                    "Example3_Hiragana": ex3_hira,
                    "Example3_EN": ex3_en,
                    "Tags": r.deck,
                    "Notes": "",
                }
            )

    print(f"Wrote {len(all_rows)} rows -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
