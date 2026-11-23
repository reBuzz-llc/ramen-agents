#!/bin/sh
# Refresh the read-only copy of the code on main (maintainers, at each release; the branches stay the install source).
#
#   sh scripts/sync-code-copy.sh                     # copies origin/fleet and origin/engine, and commits
#   sh scripts/sync-code-copy.sh <fleet> <engine>    # two commits that are about to be pushed to those branches
#
# It refuses on a dirty tree, on a private word (scripts/check_code_copy.py --words, with the maintainers' two lists), and
# when the copy does not equal the two commits afterwards. It pushes nothing. Push the branches first, then main.
set -eu
cd "$(dirname "$0")/.."
[ -z "$(git status --porcelain)" ] || { echo "STOP: this checkout has uncommitted changes" >&2; exit 1; }
if [ $# -eq 0 ]; then git fetch -q origin fleet engine; FROM_F=refs/remotes/origin/fleet; FROM_E=refs/remotes/origin/engine
elif [ $# -eq 2 ]; then FROM_F=$1; FROM_E=$2
else echo "usage: sh scripts/sync-code-copy.sh [<fleet> <engine>]" >&2; exit 2; fi
FLEET=$(git rev-parse --verify "$FROM_F^{commit}")
ENGINE=$(git rev-parse --verify "$FROM_E^{commit}")
python3 scripts/check_code_copy.py --words "$FLEET" "$ENGINE"

note() { python3 scripts/check_code_copy.py --note "$1" > "$1/READ-ONLY-COPY.md"; }
git rm -r -q --ignore-unmatch fleet engine
rm -rf fleet engine
git read-tree --prefix=fleet/ -u "$FLEET"
git read-tree --prefix=engine/ -u "$ENGINE"
note fleet
note engine
printf '{\n  "fleet": "%s",\n  "engine": "%s"\n}\n' "$FLEET" "$ENGINE" > CODE-COPY.json
git add fleet/READ-ONLY-COPY.md engine/READ-ONLY-COPY.md CODE-COPY.json
if git diff --cached --quiet; then echo "the copy is already current"; exit 0; fi
TZ=UTC GIT_AUTHOR_NAME="ReBuzz LLC" GIT_AUTHOR_EMAIL="reBuzz-llc@users.noreply.github.com" \
  GIT_COMMITTER_NAME="ReBuzz LLC" GIT_COMMITTER_EMAIL="reBuzz-llc@users.noreply.github.com" \
  git -c core.hooksPath=/dev/null commit -q -m "Code copy for reading: fleet $(git rev-parse --short "$FLEET"), engine $(git rev-parse --short "$ENGINE")${CODE_COPY_TRAILER:+

$CODE_COPY_TRAILER}"
if [ $# -eq 2 ]; then python3 scripts/check_code_copy.py --verify --unpushed; else python3 scripts/check_code_copy.py --verify; fi
echo "committed $(git rev-parse --short HEAD); nothing is pushed"
