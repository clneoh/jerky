# print-bridge/Dockerfile — the label bridge as a container (v671).
#
# ⭐ WHY THIS EXISTS: her house already runs an always-on Ubuntu server (UGREEN), so the bridge does not need a
# Mac awake, a Pi on the shelf, or anything installed into that server's own operating system. ⚠️ A container also
# means **a NAS firmware update cannot take the printer with it** — the image is the same before and after.
#
# ⚠️ IT PRINTS OVER THE NETWORK, not USB: the printer stays on Wi-Fi and this asks it at <address>:9100, exactly
# as the Mac does. ⭐ `BRIDGE_NO_PROMPT` matters here — with no terminal attached, a first-run question would
# hang for ever and look exactly like a bridge that is running.
FROM node:20-alpine
WORKDIR /app
COPY bridge.mjs printer.mjs retry.mjs tspl.mjs ./
ENV BRIDGE_NO_PROMPT=1
# ⚠️ The config is MOUNTED, never baked into the image: it holds the app login and the printer's address, and an
# image is a thing that gets built, tagged and copied around.
VOLUME ["/config"]
ENV HOME=/config
CMD ["node", "bridge.mjs"]
