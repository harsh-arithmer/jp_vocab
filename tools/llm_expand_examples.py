from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


HIRAGANA_KATAKANA_RE = re.compile(r"^[\u3040-\u309F\u30A0-\u30FF\u3000-\u303F 0-9a-zA-Z。、！？ー・「」『』（）()…:;,.!?/]+$")


def stable_key(deck: str, japanese: str, hiragana: str, english: str) -> str:
    raw = f"{deck}|{japanese}|{hiragana}|{english}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:16]


def is_hiraganaish(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    return bool(HIRAGANA_KATAKANA_RE.match(t))


def read_csv_rows(path: str) -> tuple[list[str], list[dict[str, str]]]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []
        rows = []
        for row in reader:
            rows.append({k: (v or "") for k, v in row.items()})
        return headers, rows


def write_csv_rows(path: str, headers: list[str], rows: list[dict[str, str]]) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        for row in rows:
            writer.writerow({h: row.get(h, "") for h in headers})


def load_jsonl_cache(path: str) -> dict[str, dict[str, str]]:
    if not os.path.exists(path):
        return {}
    cache: dict[str, dict[str, str]] = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                key = obj.get("key")
                ex = obj.get("example2")
                if isinstance(key, str) and isinstance(ex, dict):
                    cache[key] = {
                        "Example2_JP": str(ex.get("Example2_JP", "")),
                        "Example2_Hiragana": str(ex.get("Example2_Hiragana", "")),
                        "Example2_EN": str(ex.get("Example2_EN", "")),
                    }
            except json.JSONDecodeError:
                continue
    return cache


def append_jsonl(path: str, obj: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def extract_response_text(payload: dict[str, Any]) -> str:
    # Responses API shape: output[*].content[*].text
    out = payload.get("output")
    if isinstance(out, list):
        chunks: list[str] = []
        for item in out:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for c in content:
                if isinstance(c, dict) and c.get("type") == "output_text":
                    t = c.get("text")
                    if isinstance(t, str):
                        chunks.append(t)
        if chunks:
            return "\n".join(chunks).strip()

    # Fallbacks (defensive)
    if isinstance(payload.get("text"), str):
        return payload["text"].strip()
    return ""


@dataclass(frozen=True)
class Example2:
    jp: str
    hira: str
    en: str


class OpenAIClient:
    def __init__(self, api_key: str, model: str, base_url: str = "https://api.openai.com/v1") -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")

    def generate_example2(
        self,
        *,
        deck: str,
        japanese: str,
        hiragana: str,
        english: str,
        example1_jp: str,
        example1_en: str,
        temperature: float,
        max_output_tokens: int,
    ) -> Example2:
        system = (
            "You create original Japanese example sentences for language learning.\n"
            "Return ONLY valid minified JSON with keys: jp, hiragana, en.\n"
            "Rules:\n"
            "- The sentence must be natural, short (<= 25 Japanese words), and professional.\n"
            "- It must include the target term EXACTLY as provided (same characters).\n"
            "- The `hiragana` field must be the full sentence reading in hiragana/katakana only (no kanji).\n"
            "- The English translation must be natural.\n"
            "- Avoid copying Example 1.\n"
        )

        style_hint = "Workplace meeting / collaboration context." if deck.endswith("meeting_phrases") else "Tech / engineering context."
        user = (
            f"Deck: {deck}\n"
            f"Style: {style_hint}\n"
            f"Target term: {japanese}\n"
            f"Target reading: {hiragana}\n"
            f"Target meaning (EN): {english}\n"
            f"Example 1 (JP): {example1_jp}\n"
            f"Example 1 (EN): {example1_en}\n"
            "Create a different Example 2.\n"
        )

        body = {
            "model": self.model,
            "input": [
                {"role": "system", "content": [{"type": "text", "text": system}]},
                {"role": "user", "content": [{"type": "text", "text": user}]},
            ],
            "temperature": temperature,
            "max_output_tokens": max_output_tokens,
        }

        req = urllib.request.Request(
            f"{self.base_url}/responses",
            method="POST",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"OpenAI API HTTP {e.code}: {detail}") from e

        text = extract_response_text(payload)
        if not text:
            raise RuntimeError("Empty response text from OpenAI")

        try:
            obj = json.loads(text)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Model did not return JSON. Got: {text}") from e

        jp = str(obj.get("jp", "")).strip()
        hira_out = str(obj.get("hiragana", "")).strip()
        en_out = str(obj.get("en", "")).strip()

        if not jp or not hira_out or not en_out:
            raise RuntimeError(f"Incomplete JSON fields. Got: {text}")
        return Example2(jp=jp, hira=hira_out, en=en_out)


def ensure_headers(headers: list[str]) -> list[str]:
    needed = [
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
        "Tags",
        "Notes",
    ]
    for h in needed:
        if h not in headers:
            headers.append(h)
    return headers


def should_generate(row: dict[str, str], force: bool) -> bool:
    if force:
        return True
    return not (row.get("Example2_JP", "").strip() and row.get("Example2_Hiragana", "").strip() and row.get("Example2_EN", "").strip())


def validate_example2(example: Example2, *, japanese: str) -> str | None:
    if japanese not in example.jp:
        return "example.jp does not contain the target term exactly"
    if not is_hiraganaish(example.hira):
        return "example.hiragana contains non-hiragana/katakana characters (likely kanji)"
    if len(example.jp) > 140:
        return "example.jp seems too long"
    if len(example.en) > 200:
        return "example.en seems too long"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate LLM-quality Example2_* columns for vocab_master.csv.")
    parser.add_argument("--input", default="data/vocab_master.csv")
    parser.add_argument("--output", default="data/vocab_master.csv")
    parser.add_argument("--cache", default=".cache/example2_cache.jsonl")
    parser.add_argument("--force", action="store_true", help="Regenerate even if Example2_* exists.")
    parser.add_argument("--limit", type=int, default=0, help="Generate at most N rows (0 = no limit).")
    parser.add_argument("--deck", default="", help="Only generate for a specific Deck id.")
    parser.add_argument("--sleep", type=float, default=0.6, help="Seconds to sleep between API calls.")
    parser.add_argument("--model", default=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"))
    parser.add_argument("--temperature", type=float, default=0.8)
    parser.add_argument("--max-output-tokens", type=int, default=220)
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("Missing OPENAI_API_KEY env var.")

    headers, rows = read_csv_rows(args.input)
    headers = ensure_headers(headers)

    cache = load_jsonl_cache(args.cache)
    client = OpenAIClient(api_key=api_key, model=args.model)

    generated = 0
    for i, row in enumerate(rows):
        deck = (row.get("Deck") or "").strip()
        if args.deck and deck != args.deck:
            continue

        japanese = (row.get("Japanese") or row.get("Front") or "").strip()
        hiragana = (row.get("Hiragana") or "").strip()
        english = (row.get("English") or "").strip()

        if not japanese or not english:
            continue

        if not should_generate(row, force=args.force):
            continue

        key = stable_key(deck, japanese, hiragana, english)
        cached = cache.get(key)
        if cached and not args.force:
            row.update(cached)
            continue

        example1_jp = (row.get("Example_JP") or "").strip()
        example1_en = (row.get("Example_EN") or "").strip()

        last_err: str | None = None
        for attempt in range(1, 4):
            try:
                ex2 = client.generate_example2(
                    deck=deck,
                    japanese=japanese,
                    hiragana=hiragana,
                    english=english,
                    example1_jp=example1_jp,
                    example1_en=example1_en,
                    temperature=args.temperature,
                    max_output_tokens=args.max_output_tokens,
                )
                err = validate_example2(ex2, japanese=japanese)
                if err:
                    last_err = err
                    time.sleep(0.3)
                    continue

                row["Example2_JP"] = ex2.jp
                row["Example2_Hiragana"] = ex2.hira
                row["Example2_EN"] = ex2.en

                cache[key] = {
                    "Example2_JP": ex2.jp,
                    "Example2_Hiragana": ex2.hira,
                    "Example2_EN": ex2.en,
                }
                append_jsonl(
                    args.cache,
                    {
                        "key": key,
                        "deck": deck,
                        "japanese": japanese,
                        "english": english,
                        "example2": cache[key],
                    },
                )
                generated += 1
                print(f"[{generated}] row {i+1}/{len(rows)} ok: {deck} {japanese}")
                break
            except Exception as e:  # noqa: BLE001
                last_err = str(e)
                time.sleep(0.6)

        if last_err and (not row.get("Example2_JP")):
            print(f"[warn] row {i+1} failed: {deck} {japanese} :: {last_err}")

        if args.sleep:
            time.sleep(args.sleep)

        if args.limit and generated >= args.limit:
            break

    write_csv_rows(args.output, headers, rows)
    print(f"Done. Generated {generated} Example2 entries. Wrote: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

