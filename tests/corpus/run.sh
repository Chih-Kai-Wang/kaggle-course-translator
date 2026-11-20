#!/bin/sh
# Usage: tests/corpus/run.sh [git-rev] [site-id,...]
#   no rev  -> checks the working tree
#   git-rev -> checks shared/config.js + content/*.js (+ content.css) from that revision
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT=8779
REV="${1:-}"
SRC=""
LABEL="working"
if [ -n "$REV" ]; then
  LABEL="$REV"
  SRC="tests/corpus/.rev/$REV/"
  for f in shared/config.js content/site-analyzer.js content/renderer.js content/content.css; do
    mkdir -p "$ROOT/$SRC$(dirname "$f")"
    git -C "$ROOT" show "$REV:$f" > "$ROOT/$SRC$f"
  done
fi
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
{ printf "globalThis.CORPUS_ROOT='%s'; globalThis.CORPUS_PORT=%s; globalThis.CORPUS_SRC='%s'; globalThis.CORPUS_LABEL='%s'; globalThis.CORPUS_ONLY='%s';\n" "$ROOT" "$PORT" "$SRC" "$LABEL" "${2:-}"; cat "$ROOT/tests/corpus/run.mjs"; } | ego-browser nodejs
