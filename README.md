# JP Vocab Trainer (interactive)

This repo contains Japanese tech vocabulary in CSV plus a small local website to review it with spaced repetition and progress tracking.

## Run the website

Because the site loads CSV via `fetch()`, open it via a local server (not `file://`):

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`.

## Use it on your phone (PWA)

- Host this folder on any HTTPS static host. HTTPS is required for install.
- Open the URL on your Android phone in Chrome:
  - Tap **Install** in the app (right panel), or Chrome menu → **Install app**
- The app works offline after first load (service worker cache) and progress stays local to the device.
- Mobile UI: use the bottom tabs (**Review / Quiz / Lists / Stats / Settings**). Settings includes **Single-hand mode**.

### GitHub Pages (recommended)

1) Create a new GitHub repo (public is simplest).
2) Commit + push this folder to `main`:
   - `git init`
   - `git add .`
   - `git commit -m "JP vocab trainer"`
   - `git branch -M main`
   - `git remote add origin https://github.com/<you>/<repo>.git`
   - `git push -u origin main`
3) In GitHub: **Settings → Pages**
   - **Build and deployment** → Deploy from a branch
   - Branch: `main` • Folder: `/ (root)`
4) Your site will be at: `https://<you>.github.io/<repo>/`

Then open that URL on Android Chrome and install.

## How it works

- Click the card (or press `Space`) to reveal the answer.
- Optional: enable **Typing mode** in Settings, type your answer, then press `Enter` (or click **Check**).
- Click **Next** to move on; it counts toward your daily goal as a **skipped review**.
- Grade yourself:
  - `1` Again (marks as **unknown**, repeats soon)
  - `2` Hard
  - `3` Good
  - `4` Easy
- Audio (text-to-speech): click **Speak JP / Speak EN** or press `J` / `E`.
- Mobile: swipe up to reveal; when revealed swipe left/right/down/up to grade.
- The right panel shows **Unknown** words (keeps reminding) and **Due now**.
- The right panel also includes **Analytics** (accuracy + recent review history + hardest words).
- Use **Quiz** (right panel) to run a fixed-length session in **MCQ** (or Typing) mode and track score (optionally updates SRS).
- In a quiz, **Next** acts like **Skip** until you answer; after you answer it becomes **Next question**.
- Progress is stored locally in your browser (`localStorage`) and can be exported/imported.
- Optional: enable **Local File** auto-save (Chrome/Edge) to keep progress in a JSON file on your PC.

### Local file auto-save notes

- This uses the browser File System Access API (works best in Chrome/Edge).
- Pick a file once, then progress writes happen automatically (or use **Write now**).
- This is still 100% local (no server, no cloud), but the file is safer than relying only on browser storage.

## CSV data (more examples)

The original decks live at repo root (`01_*.csv`, `02_*.csv`, …).

The website reads `data/vocab_master.csv`, which combines all decks and adds `Example2_*` and `Example3_*` columns (extra examples per card).

To rebuild `data/vocab_master.csv` after editing any deck CSV:

```bash
python tools/build_vocab_master.py
```

### Manually curated examples

`tools/build_vocab_master.py` will use:
- `data/manual_example1.csv` for higher-quality `Example_JP` / `Example_Hiragana` / `Example_EN`
- `data/manual_examples.csv` for higher-quality `Example2_*` / `Example3_*`

## LLM-quality extra examples (recommended)

This repo already includes manually curated examples in:
- `data/manual_example1.csv` (Example 1)
- `data/manual_examples.csv` (Examples 2–3)

If you want to generate (or regenerate) additional example candidates with an online LLM, you can use (requires network access + an API key):

```bash
export OPENAI_API_KEY="..."
export OPENAI_MODEL="gpt-4o-mini"   # optional
python tools/llm_expand_examples.py --input data/vocab_master.csv --output data/vocab_master.csv
```

The generator is resumable via `.cache/example2_cache.jsonl`.

Or do both steps in one command:

```bash
export OPENAI_API_KEY="..."
python tools/rebuild_vocab_master.py --with-llm
```
