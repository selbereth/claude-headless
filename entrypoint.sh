#!/bin/bash
# Runs as root only long enough to fix ownership of the home volume, then
# drops to the unprivileged `node` user for Claude itself.
set -euo pipefail

# PUID/PGID make `node` match whoever owns the host folders
# (e.g. 1000:100 for Unraid's `users` group).
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -g node)" != "$PGID" ]; then
  if getent group "$PGID" > /dev/null; then
    usermod -g "$PGID" node
  else
    groupmod -g "$PGID" node
  fi
fi
if [ "$(id -u node)" != "$PUID" ]; then
  usermod -u "$PUID" node
fi

# /home/node is a volume so ~/.claude/ and ~/.claude.json (login, workspace
# trust, the Remote Control confirmation) survive container rebuilds.
# /workspace is left alone: it's the user's files, owned however they like.
if [ "$(stat -c %u:%g /home/node)" != "$PUID:$PGID" ]; then
  chown "$PUID:$PGID" /home/node
fi

if [ -d /home/node/.ssh ]; then
  chown -R "$PUID:$PGID" /home/node/.ssh
  chmod 700 /home/node/.ssh
  find /home/node/.ssh -type f ! -name '*.pub' -exec chmod 600 {} \;
fi

exec setpriv --reuid=node --regid="$PGID" --init-groups env HOME=/home/node "$@"
