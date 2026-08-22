#!/bin/sh

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ARCH=$(uname -m)

case "$ARCH" in
    arm64|aarch64)
        SERVER="$ROOT_DIR/run/game-server-macos-arm64"
        ;;
    x86_64|amd64)
        SERVER="$ROOT_DIR/run/game-server-macos-amd64"
        ;;
    *)
        printf 'Unsupported Mac architecture: %s\n' "$ARCH"
        printf 'Press Return to close this window.\n'
        read -r _
        exit 1
        ;;
esac

if [ ! -f "$SERVER" ]; then
    printf 'The portable game server is missing:\n%s\n' "$SERVER"
    printf 'Press Return to close this window.\n'
    read -r _
    exit 1
fi

# ZIP downloads can mark every extracted file as quarantined. Clear that mark
# before launching the bundled, architecture-matched local server.
xattr -dr com.apple.quarantine "$ROOT_DIR" 2>/dev/null || true
chmod +x "$SERVER" 2>/dev/null || true
exec "$SERVER" -port 8137
