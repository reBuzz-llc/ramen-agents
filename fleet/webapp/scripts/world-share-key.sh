#!/bin/sh
# The public office's shared secret: common-data/keys/world-share.key, mode 600, 64 hex characters. The team portal signs
# the office link with the same value (its WORLD_SHARE_SECRET). Never overwrites an existing key unless --rotate is given
# (then every open link stops working, and the portal needs the new value).
set -eu
KEY="${BOTS_DIR:-$HOME/bots}/common-data/keys/world-share.key"
if [ -s "$KEY" ] && [ "${1:-}" != "--rotate" ]; then
  echo "$KEY exists; pass --rotate to replace it"
  exit 0
fi
umask 077
mkdir -p "$(dirname "$KEY")"
openssl rand -hex 32 > "$KEY.tmp"
chmod 600 "$KEY.tmp"
mv "$KEY.tmp" "$KEY"
echo "wrote $KEY (600); give the team portal the same value as WORLD_SHARE_SECRET"
