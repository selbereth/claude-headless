FROM node:22-bookworm-slim

# Tools Claude reaches for while working. Add project toolchains here
# (or in a derived image) rather than on the Unraid host.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      openssh-client \
      curl \
      ca-certificates \
      ripgrep \
      jq \
      less \
      procps \
      tmux \
      python3 \
      tzdata \
    && rm -rf /var/lib/apt/lists/*

# ttyd isn't packaged for bookworm; use the upstream static build.
ARG TTYD_VERSION=1.7.7
RUN arch="$(uname -m)" \
    && curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${arch}" -o /usr/local/bin/ttyd \
    && chmod +x /usr/local/bin/ttyd \
    && ttyd --version

# Pinned so a rebuild doesn't silently change behaviour. Bump deliberately.
ARG CLAUDE_CODE_VERSION=2.1.302
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

ENV TERM=xterm-256color \
    LANG=C.UTF-8

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["claude", "remote-control", "--name", "unraid"]
