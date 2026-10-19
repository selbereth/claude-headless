# claude-headless

Run [Claude Code](https://claude.com/claude-code) on your home server and use it from your phone or
browser. Claude works on the files on your server; you start and steer sessions from
[claude.ai/code](https://claude.ai/code) or the Claude mobile app using
[Remote Control](https://code.claude.com/docs/en/remote-control).

```
 phone / claude.ai/code ──HTTPS──▶ Anthropic ◀──outbound HTTPS── claude container ──▶ /workspace
 browser on your LAN ──────────────────http :7681─────────────▶ terminal container ──▶ /workspace
```

The stack has two containers built from the same image, sharing the same home and workspace folders:

| Container | What it does | Ports |
|---|---|---|
| `claude-headless` | Runs `claude remote-control`. This is what your phone/browser talks to. | none (outbound only) |
| `claude-headless-terminal` | A password-protected browser terminal (ttyd + tmux) with the full Claude Code TUI. Used for the one-time login and a few commands Remote Control can't do. | `7681` |

Image: `ghcr.io/selbereth/claude-headless` (public, linux/amd64). Tags: `latest`, the Claude Code
version (e.g. `2.1.303`) and the git sha. A daily build publishes new Claude Code releases automatically.

## What you can do

**From your phone or claude.ai/code**

- Start new sessions and run several at once (up to 32), all working in `/workspace`
- Chat, edit files, run commands, use subagents
- Answer Claude's questions and approve/deny permission prompts (they wait for you)
- `/model`, `/effort`, `/compact`, `/clear`, `/context`, `/usage`, `/rename`, `/config key=value`, `/mcp` (status)

**Only from the browser terminal**

- `/login`, `/plugin`, `/resume`, `/reload-plugins`, `/mcp reconnect|enable|disable`
- Anything with an interactive picker

## Requirements

- Docker (Portainer, Unraid, Synology, plain Docker…) on an x86-64 machine
- A **claude.ai Pro, Max, Team or Enterprise** subscription. API keys don't work with Remote Control.

## Setup

### 1. Pick your folders

You need two folders on the host:

- **Home** — Claude's login, settings and history. Any empty folder, e.g. `/mnt/user/appdata/claude-headless/home`.
  Created automatically if missing.
- **Workspace** — the files Claude should work on, e.g. your projects share. Claude gets read/write access to
  everything in it.

Find who owns the workspace (`ls -ln <folder>`) and use that as `PUID`/`PGID`.
On Unraid that is usually `1000` / `100`.

### 2. Deploy

#### Portainer

1. **Stacks → Add stack**, name it `claude-headless`, choose **Web editor**.
2. Paste this, changing the two folder paths on the left of each `:` and `TZ` if needed:

   ```yaml
   services:
     claude:
       image: ghcr.io/selbereth/claude-headless:latest
       container_name: claude-headless
       restart: unless-stopped
       tty: true
       stdin_open: true
       environment:
         TZ: America/Los_Angeles
         PUID: 1000
         PGID: 100
       volumes:
         - /mnt/user/appdata/claude-headless/home:/home/node
         - /mnt/user/projects:/workspace

     terminal:
       image: ghcr.io/selbereth/claude-headless:latest
       container_name: claude-headless-terminal
       restart: unless-stopped
       environment:
         TZ: America/Los_Angeles
         PUID: 1000
         PGID: 100
       ports:
         - "7681:7681"
       command: ["ttyd", "-W", "-p", "7681", "-c", "${TTYD_CREDENTIAL}", "tmux", "new", "-A", "-s", "main"]
       volumes:
         - /mnt/user/appdata/claude-headless/home:/home/node
         - /mnt/user/projects:/workspace
   ```

3. Below the editor, under **Environment variables**, click **Add an environment variable**:
   - name: `TTYD_CREDENTIAL`
   - value: `username:password` (one colon, no quotes, no spaces) — this is the login for the browser terminal
4. **Deploy the stack**.

The `claude-headless` container will keep restarting with *"You must be logged in to use Remote
Control"* until you finish step 3 below. That's expected.

#### Docker Compose

Use [`compose.yaml`](compose.yaml). Create a `.env` next to it:

```env
TTYD_CREDENTIAL=username:password
WORKSPACE=/path/to/your/projects
PUID=1000
PGID=1000
TZ=America/Los_Angeles
```

then `docker compose up -d`. The home folder is `./data/home`.

### 3. Sign in (once)

1. Open `http://<server-ip>:7681` and log in with your `TTYD_CREDENTIAL`.
2. Run `claude`, then `/login`, and sign in with your claude.ai account (open the link it shows on any
   device, approve, paste the code back).
3. Accept the **trust this folder** prompt for `/workspace`, then `/exit`.
4. Run `claude remote-control`, answer `y` to *Enable Remote Control?*, then press **Ctrl+C**.
5. Restart the `claude-headless` container.

The login is stored in the home folder, so this survives updates and rebuilds.

### 4. Use it

Open [claude.ai/code](https://claude.ai/code) or the Claude app → **Code**. Pick the environment
named **unraid** and start a session.

Tip: in the terminal, `/config` → turn on **Push when actions required** to get a phone notification
when Claude is waiting on a question or permission.

## Configuration

| Variable | Container | Default | Purpose |
|---|---|---|---|
| `TTYD_CREDENTIAL` | terminal | — (required) | `username:password` for the browser terminal |
| `PUID` / `PGID` | both | `1000` / `1000` | User/group Claude runs as. Match the owner of your workspace. |
| `TZ` | both | `UTC` | Timezone |

To rename the session from **unraid**, override the `claude` service's command:
`command: ["claude", "remote-control", "--name", "my-server"]`.

Need more tools inside the container (Go, Rust, .NET…)? Build your own image `FROM
ghcr.io/selbereth/claude-headless` and `apt-get install` them. The image already has git, ssh,
curl, ripgrep, jq, python3 and Node 22. Put SSH keys for git in `<home>/.ssh/`.

## Updating

Portainer: **Stacks → claude-headless → Pull and redeploy**. Compose: `docker compose pull && docker compose up -d`.
Your login and settings are kept.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `claude-headless` loops with *"You must be logged in to use Remote Control"* | Do [Sign in](#3-sign-in-once). If you already did, check both containers mount the **same** home folder. |
| Terminal container loops with *"ttyd: invalid credential, format: username:password"* | `TTYD_CREDENTIAL` is missing or has no colon. Add it under the stack's Environment variables and **Update the stack**. |
| Claude gets *permission denied* writing files | `PUID`/`PGID` don't match the workspace owner. Check with `ls -ln`. |
| Session doesn't appear in the app | Make sure step 3.4 was done, then restart `claude-headless` and check its logs. |
| Session drops after network loss | Remote Control exits after ~10 minutes offline; the restart policy brings it back. |

## Security

- The browser terminal is **plain HTTP with basic auth**. Keep port 7681 on your LAN or behind
  Tailscale / Cloudflare Access. Never port-forward it.
- Claude can read and change everything in `/workspace`, including other projects' `.env` files.
- Claude runs as an unprivileged user, not root.

## License

The files in this repo are MIT. Claude Code itself is Anthropic's software, subject to
[Anthropic's terms](https://www.anthropic.com/legal/commercial-terms).
