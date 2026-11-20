#!/bin/sh
# Usage: tests/corpus/capture.sh [site-id[,site-id...]]
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
{ printf 'globalThis.CORPUS_ROOT = %s; globalThis.CORPUS_ONLY = %s;\n' "'$ROOT'" "'${1:-}'"; cat "$ROOT/tests/corpus/capture.mjs"; } | ego-browser nodejs
