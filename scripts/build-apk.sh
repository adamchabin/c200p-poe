#!/bin/sh
# Build apk v3 packages for the Cudy C200P PoE work and create a local index.
#
# Usage:
#   APK=/path/to/apk.static ./scripts/build-apk.sh
#
# Environment:
#   APK      apk-tools 3.x binary with mkpkg (default: apk)
#   VERSION  package version (default: 1.0.0-r1)
#   OUT      output directory (default: <project>/dist)

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK="${APK:-apk}"
VERSION="${VERSION:-1.0.0-r1}"
OUT="${OUT:-$ROOT/dist}"

if ! command -v "$APK" >/dev/null 2>&1 && [ ! -x "$APK" ]; then
	echo "error: apk binary not found: $APK" >&2
	exit 1
fi

mkdir -p "$OUT"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Post-install hook: reload rpcd so the new ACL is picked up.
cat > "$WORK/post-install" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT:-}" ] && exit 0
killall -HUP rpcd 2>/dev/null || true
rm -rf /tmp/luci-indexcache.* /tmp/luci-modulecache/ 2>/dev/null || true
exit 0
EOF
chmod 755 "$WORK/post-install"

SRC="$ROOT/src/luci-app-pse"
if [ ! -d "$SRC" ]; then
	echo "error: source directory missing: $SRC" >&2
	exit 1
fi

"$APK" mkpkg \
	--info "name:luci-app-pse" \
	--info "version:$VERSION" \
	--info "arch:mipsel_24kc" \
	--info "description:PoE Manager for Cudy C200P (ethtool PSE status and control)" \
	--info "license:Apache-2.0" \
	--info "depends:luci-base" \
	--info "depends:ethtool-full" \
	--files "$SRC" \
	--script "post-install:$WORK/post-install" \
	--output "$OUT/luci-app-pse-$VERSION.apk"

echo "built $OUT/luci-app-pse-$VERSION.apk"

# Local index so the router can install from a repository.
"$APK" --allow-untrusted mkndx -o "$OUT/packages.adb" "$OUT"/*.apk
echo "built $OUT/packages.adb"
