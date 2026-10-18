# claude-headless

[Claude Code](https://claude.com/claude-code) running headless in Docker, driven from
[claude.ai/code](https://claude.ai/code) or the Claude mobile app through
[Remote Control](https://code.claude.com/docs/en/remote-control) server mode.

- **`claude` service** runs `claude remote-control`: up to 32 concurrent sessions, started and
  steered from your phone or browser. Outbound HTTPS only, no ports opened.
- **`terminal` service** is a password-protected browser terminal (ttyd + tmux) on port 7681 for
  first-time login and the few commands Remote Control can't run remotely
  (`/plugin`, `/resume`, `/reload-plugins`, `/mcp reconnect`, …).

Image: `ghcr.io/selbereth/claude-headless` — tags `latest`, the Claude Code version
(e.g. `2.1.302`) and the git sha. A daily workflow publishes new Claude Code releases.

Requires a claude.ai Pro/Max/Team/Enterprise login; API keys don't work with Remote Control.

## Run

See [`compose.yaml`](compose.yaml). Set `TTYD_CREDENTIAL=user:password` and point
`WORKSPACE` at the folder Claude should work in, then `docker compose up -d`.

## First-time setup

The `claude` service restarts until it is signed in and the workspace is trusted. Once:

1. Open the terminal at `http://<host>:7681`.
2. Run `claude`, `/login` with your claude.ai account, accept the trust prompt for `/workspace`, then `/exit`.
3. Run `claude remote-control`, answer `y` to "Enable Remote Control?", then Ctrl+C.
4. `docker restart claude-headless`.

Then open claude.ai/code or the Claude app → **Code** → session **unraid**.

## Notes

- Runs as the unprivileged `node` user (uid 1000). The workspace must be readable/writable by uid 1000.
- Permission prompts and questions are forwarded to your phone and wait for an answer. Turn on
  "Push when actions required" in `/config` to be notified.
- ttyd is plain HTTP with basic auth. Keep it on your LAN or behind Tailscale/Cloudflare Access.
- Claude Code itself is Anthropic's software, subject to
  [Anthropic's terms](https://www.anthropic.com/legal/commercial-terms). The files in this repo are MIT.
