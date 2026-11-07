#!/bin/sh
# Install the kc binary from the newest GitHub release (pre-releases included).
# Works unauthenticated; `gh` or GH_TOKEN are used when present.
set -eu

REPO="aikongen/knowledge-capsules"
DEST_DIR="${KC_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) ASSET="kc-darwin-arm64" ;;
  Linux-x86_64) ASSET="kc-linux-x64" ;;
  *) echo "kc: unsupported platform $(uname -s)-$(uname -m) (macOS arm64 and Linux x64 only)" >&2; exit 1 ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# "latest" on GitHub skips pre-releases, so resolve the newest tag including them.
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  TAG="$(gh release list --repo "$REPO" --limit 1 --json tagName --jq '.[0].tagName')"
  gh release download "$TAG" --repo "$REPO" --pattern "$ASSET" --pattern SHA256SUMS --dir "$TMP"
else
  TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=1" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
  BASE="https://github.com/$REPO/releases/download/$TAG"
  curl -fsSL "$BASE/$ASSET" -o "$TMP/$ASSET"
  curl -fsSL "$BASE/SHA256SUMS" -o "$TMP/SHA256SUMS"
fi

EXPECTED="$(grep " $ASSET\$" "$TMP/SHA256SUMS" | awk '{print $1}')"
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "$TMP/$ASSET" | awk '{print $1}')"
else
  ACTUAL="$(shasum -a 256 "$TMP/$ASSET" | awk '{print $1}')"
fi
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "kc: checksum mismatch for $ASSET" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
cp "$TMP/$ASSET" "$DEST_DIR/kc"
chmod +x "$DEST_DIR/kc"
echo "kc installed to $DEST_DIR/kc"
case ":$PATH:" in *":$DEST_DIR:"*) ;; *) echo "Add $DEST_DIR to your PATH." ;; esac
echo "Next: kc --help"
