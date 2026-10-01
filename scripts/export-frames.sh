#!/usr/bin/env bash
# Export canvas frames to PNG, headless, straight from the design file.
#
#   ./scripts/export-frames.sh <out-dir> <frameId> [frameId…]
#   SCALE=2 ./scripts/export-frames.sh /tmp/frames gAQnT BPuki
#
# Writes <out-dir>/<frameId>.png per frame. Uses the pen.dev CLI
# (`npm install -g @pen.dev/cli`, then `pen login`) in headless interactive
# mode: no desktop app, no open document, and so no risk of exporting an
# unsaved in-memory canvas instead of what is in git.
#
# Why this exists: a post-build design review compares the built screens with
# their frames (design/qa/REVIEW.md, "Comparing a build with its frames"). The
# frames must come from the committed `.pen`, not from PNGs someone exported
# weeks ago. The design file is COPIED first and the copy is opened, so this
# can never write to design/ab-initial-app.pen.
set -euo pipefail

if [ "$#" -lt 2 ]; then
  sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi
command -v pen >/dev/null || {
  echo "pen CLI not found: npm install -g @pen.dev/cli && pen login" >&2
  exit 1
}

cd "$(dirname "$0")/.."
OUT="$(realpath -m "$1")"
shift
SCALE="${SCALE:-1}"
mkdir -p "$OUT"

for id in "$@"; do
  # Frame ids are short alphanumerics; refuse anything that could break out of
  # the JS string handed to the CLI.
  [[ "$id" =~ ^[A-Za-z0-9]+$ ]] || { echo "not a frame id: $id" >&2; exit 2; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp design/ab-initial-app.pen "$WORK/canvas.pen"

# One execute per frame: a bad id rolls back only its own call, not the rest.
script=""
for id in "$@"; do
  script+="execute({ input: 'Export([\"$id\"], \"png\", \"$OUT\", {scale:$SCALE})' })"$'\n'
done
script+="exit()"
# A bad id makes the CLI print a stack trace; keep only the line that says why.
printf '%s\n' "$script" |
  pen interactive -i "$WORK/canvas.pen" -o "$WORK/scratch.pen" 2>&1 |
  grep -oE 'Failed to find a node with id [A-Za-z0-9]+' | sort -u >&2 || true

missing=0
for id in "$@"; do
  if [ -s "$OUT/$id.png" ]; then echo "$OUT/$id.png"; else
    echo "no export for $id (is it a node id in the design file?)" >&2
    missing=1
  fi
done
exit "$missing"
