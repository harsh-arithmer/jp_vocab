from __future__ import annotations

import argparse
import os
import subprocess
import sys


def run(argv: list[str]) -> None:
    subprocess.check_call(argv)


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild data/vocab_master.csv (optionally with LLM Example2).")
    parser.add_argument("--with-llm", action="store_true", help="Also run LLM Example2 generation.")
    parser.add_argument("--llm-limit", type=int, default=0, help="Generate at most N Example2 rows (0 = no limit).")
    parser.add_argument("--llm-deck", default="", help="Only generate Example2 for a specific Deck id.")
    parser.add_argument("--force", action="store_true", help="Force regenerate Example2 even if already present.")
    args = parser.parse_args()

    run([sys.executable, "tools/build_vocab_master.py"])

    if not args.with_llm:
        return 0

    if not os.environ.get("OPENAI_API_KEY", "").strip():
        raise SystemExit("OPENAI_API_KEY is required for --with-llm")

    llm_args = [
        sys.executable,
        "tools/llm_expand_examples.py",
        "--input",
        "data/vocab_master.csv",
        "--output",
        "data/vocab_master.csv",
    ]
    if args.llm_limit:
        llm_args += ["--limit", str(args.llm_limit)]
    if args.llm_deck:
        llm_args += ["--deck", args.llm_deck]
    if args.force:
        llm_args += ["--force"]

    run(llm_args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

