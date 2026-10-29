#!/usr/bin/env bash
# Full rebuild: review kit (badged) + final/ exports (no SAMPLE COPY / MOCK badges). TICKER and MARK env vars optional.
set -e; cd "$(dirname "$0")"
export TICKER="${TICKER:-\$QUIVR}"
python3 mark_options.py
python3 build.py
python3 tokens_build.py
python3 hero.py && python3 rec.py still && python3 rec.py video
python3 tweets.py
python3 sheets.py
# FINAL exports
FINAL=1 python3 hero.py && FINAL=1 python3 rec.py still && FINAL=1 python3 rec.py video
FINAL=1 python3 tweets.py
mkdir -p ../final/social && cp ../social/x-banner-1500x500.png ../social/x-banner-3000x1000.png ../social/x-avatar-400.png ../social/x-avatar-1000.png ../final/social/
python3 mark_v4_sheet.py
echo done
