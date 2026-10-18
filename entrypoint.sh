#!/bin/bash
# Runs as root only long enough to fix ownership of the home volume, then
# drops to the unprivileged `node` user (uid 1000) for Claude itself.
set -euo pipefail

# /home/node is a volume so ~/.claude/ and ~/.claude.json (login, workspace
# trust, the Remote Control confirmation) survive container rebuilds.
# /workspace is left alone: it's the user's files, owned however they like.
if [ "$(stat -c %u /home/node)" != "1000" ]; then
  chown node:node /home/node
fi

if [ -d /home/node/.ssh ]; then
  chown -R node:node /home/node/.ssh
  chmod 700 /home/node/.ssh
  find /home/node/.ssh -type f ! -name '*.pub' -exec chmod 600 {} \;
fi

exec setpriv --reuid=node --regid=node --init-groups env HOME=/home/node "$@"
