#!/bin/sh
# Check every repo of the project and push whichever has commits GitHub does not have yet.
# The two repos: the engine (~/Projects/bot) and this fleet (~/bots). Committing without pushing backs up nothing,
# so "push" means both, every time. Uncommitted changes are reported, never committed here.
#   sh ~/bots/scripts/push-all.sh          # push where needed, report the rest
#   sh ~/bots/scripts/push-all.sh --check  # report only
set -u
check_only=0; [ "${1:-}" = "--check" ] && check_only=1
status=0
for repo in "$HOME/Projects/bot" "$HOME/bots"; do
    [ -d "$repo/.git" ] || { echo "?? $repo: not a git repo"; status=1; continue; }
    name="$(git -C "$repo" remote get-url origin 2>/dev/null | sed -E 's#\.git$##; s#.*[:/]([^/]+/[^/]+)$#\1#')"
    branch="$(git -C "$repo" branch --show-current)"
    git -C "$repo" fetch -q origin 2>/dev/null || { echo "!! $name: fetch failed (offline? no access?)"; status=1; continue; }
    dirty="$(git -C "$repo" status --porcelain | wc -l | tr -d ' ')"
    ahead="$(git -C "$repo" rev-list --count "origin/$branch..$branch" 2>/dev/null || echo 0)"
    behind="$(git -C "$repo" rev-list --count "$branch..origin/$branch" 2>/dev/null || echo 0)"
    line="$name ($branch): $ahead to push, $behind behind, $dirty uncommitted"
    if [ "$behind" != "0" ]; then echo "!! $line -- pull/rebase first"; status=1; continue; fi
    if [ "$ahead" != "0" ] && [ "$check_only" = "0" ]; then
        if git -C "$repo" push -q origin "$branch" 2>/dev/null; then echo "^^ $line -- pushed"; else echo "!! $line -- push FAILED"; status=1; fi
    elif [ "$ahead" != "0" ]; then echo "^^ $line"; status=1
    else echo "ok $line"; fi
    [ "$dirty" != "0" ] && echo "   uncommitted in $name:" && git -C "$repo" status --porcelain | head -8 | sed 's/^/     /'
done
exit $status
