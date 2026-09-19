#!/usr/bin/env bash
#
# WEMG release build — signed and notarised DMG for Apple Silicon.
#
# Run:   ./build-mac.command
# (double-clickable from Finder — the .command extension does the work)
#
# Mirrors the WESC mac release flow: Developer ID identity pinned by hash,
# notarisation through a notarytool keychain profile, then staple + verify.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

VERSION=$(node -p "require('./package.json').version")
MAC_SIGNING_IDENTITY="Developer ID Application: Bernie Rainer-Guy (T57Q5FRCB6)"
# Same 2031 Developer ID Application certificate WESC pins to.
MAC_SIGNING_IDENTITY_HASH="${APPLE_SIGNING_IDENTITY_HASH:-E08DE52E8B6FB53ED78BFBF5979ABC7DF75B08CB}"
MAC_TEAM_ID="T57Q5FRCB6"
MAC_BUILD_ARGS=()
MAC_DIST_TMP=""

# Stray com.apple.* attributes make codesign fail deep inside the bundle,
# so strip them before packaging.
clean_macos_metadata() {
  local target="$1"
  local attr
  local attrs=(
    "com.apple.FinderInfo"
    "com.apple.ResourceFork"
    "com.apple.quarantine"
    "com.apple.provenance"
    "com.apple.macl"
    "com.apple.metadata:kMDItemWhereFroms"
    "com.apple.lastuseddate#PS"
  )
  [ -e "$target" ] || return 0
  find "$target" -name '.DS_Store' -delete 2>/dev/null || true
  find "$target" -name '._*' -delete 2>/dev/null || true
  if command -v dot_clean >/dev/null 2>&1; then
    dot_clean -m "$target" || true
  fi
  xattr -cr "$target" 2>/dev/null || true
  find "$target" -exec xattr -c {} + 2>/dev/null || true
  for attr in "${attrs[@]}"; do
    find "$target" -exec xattr -d "$attr" {} + 2>/dev/null || true
    xattr -d "$attr" "$target" 2>/dev/null || true
  done
  xattr -cr "$target" 2>/dev/null || true
}

preflight_mac_signing() {
  MAC_BUILD_ARGS=()

  if [ "${WEMG_SKIP_MAC_SIGNING:-0}" = "1" ]; then
    echo "WARNING: WEMG_SKIP_MAC_SIGNING=1 - build will be unsigned and not notarised."
    MAC_BUILD_ARGS+=("-c.mac.identity=null" "-c.mac.notarize=false")
    return 0
  fi

  command -v security >/dev/null 2>&1 || { echo "ERROR: security not on PATH; cannot check Developer ID certificate."; exit 1; }
  command -v xcrun >/dev/null 2>&1 || { echo "ERROR: xcrun not on PATH; Apple signing tools are required."; exit 1; }

  local signing_identities
  signing_identities="$(security find-identity -v -p codesigning)"

  if ! printf '%s\n' "$signing_identities" | grep -F "$MAC_SIGNING_IDENTITY" >/dev/null; then
    echo "ERROR: Developer ID Application signing certificate not found in this login keychain:"
    echo "  $MAC_SIGNING_IDENTITY"
    echo "Install the Developer ID Application certificate/private key, then retry."
    exit 1
  fi

  if ! printf '%s\n' "$signing_identities" | grep -F "$MAC_SIGNING_IDENTITY_HASH" >/dev/null; then
    echo "ERROR: configured Developer ID signing identity hash not found in this login keychain:"
    echo "  $MAC_SIGNING_IDENTITY_HASH"
    echo "Set APPLE_SIGNING_IDENTITY_HASH to the installed Developer ID Application hash, then retry."
    exit 1
  fi

  export CSC_NAME="$MAC_SIGNING_IDENTITY_HASH"
  MAC_BUILD_ARGS+=("-c.mac.identity=$MAC_SIGNING_IDENTITY_HASH")
  echo "Mac signing identity hash: $MAC_SIGNING_IDENTITY_HASH"

  if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] && [ -z "${APPLE_TEAM_ID:-}" ]; then
    export APPLE_TEAM_ID="$MAC_TEAM_ID"
  fi

  if [ "${WEMG_SKIP_NOTARIZE:-0}" = "1" ]; then
    echo "WARNING: WEMG_SKIP_NOTARIZE=1 - build will be signed but not notarised."
    MAC_BUILD_ARGS+=("-c.mac.notarize=false")
  elif [ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]; then
    echo "Notarisation will use keychain profile '$APPLE_KEYCHAIN_PROFILE'."
  elif [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    echo "Notarisation will use Apple ID credentials from the environment."
  else
    # Same Apple account as WESC, so the existing notary profile works here.
    export APPLE_KEYCHAIN_PROFILE="WESC_NOTARY"
    echo "Notarisation will use default keychain profile '$APPLE_KEYCHAIN_PROFILE'."
  fi

  if [ "${WEMG_SKIP_NOTARIZE:-0}" != "1" ]; then
    xcrun notarytool history --keychain-profile "$APPLE_KEYCHAIN_PROFILE" >/dev/null
  fi
}

# electron-builder passes identity.name to the signer, which is ambiguous when
# two Developer ID certificates share a name. Prefer the hash.
patch_electron_builder_mac_signing() {
  local packager="node_modules/app-builder-lib/out/macPackager.js"

  if [ ! -f "$packager" ]; then
    echo "ERROR: app-builder-lib macPackager.js not found; cannot patch Mac signing identity handling."
    exit 1
  fi

  node - "$packager" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const oldText = "return customSign ? Promise.resolve(customSign(opts, this)) : (0, macCodeSign_1.sign)({ ...opts, identity: identity ? identity.name : undefined });";
const newText = "return customSign ? Promise.resolve(customSign(opts, this)) : (0, macCodeSign_1.sign)({ ...opts, identity: identity ? (identity.hash || identity.name) : undefined });";

if (src.includes(newText)) {
  console.log("[release] electron-builder Mac signing already prefers identity hash.");
  process.exit(0);
}

if (!src.includes(oldText)) {
  console.error("[release] ERROR: app-builder-lib signing call has changed; cannot apply identity hash patch.");
  process.exit(1);
}

fs.writeFileSync(file, src.replace(oldText, newText));
console.log("[release] patched electron-builder Mac signing to prefer identity hash.");
NODE
}

prepare_mac_output_dir() {
  if [ -n "$MAC_DIST_TMP" ] && [ -d "$MAC_DIST_TMP" ]; then
    rm -rf "$MAC_DIST_TMP"
  fi
  MAC_DIST_TMP="$(mktemp -d /private/tmp/wemg-mac-dist.XXXXXX)"
  echo "  ↳ Mac build output: $MAC_DIST_TMP"
}

run_mac_builder() {
  if [ -z "$MAC_DIST_TMP" ] || [ ! -d "$MAC_DIST_TMP" ]; then
    echo "ERROR: temporary Mac output folder was not prepared."
    return 1
  fi
  COPYFILE_DISABLE=1 NPM_CONFIG_AUDIT=false npx electron-builder --mac --arm64 \
    "--config.directories.output=$MAC_DIST_TMP" "${MAC_BUILD_ARGS[@]}"
}

copy_mac_artifacts_to_dist() {
  mkdir -p dist
  find "$MAC_DIST_TMP" -maxdepth 1 -type f \( \
    -name "WEMG-${VERSION}-*.dmg" -o \
    -name "WEMG-${VERSION}-*.dmg.blockmap" -o \
    -name "latest-mac.yml" -o \
    -name "builder-effective-config.yaml" \
  \) -exec cp -p {} dist/ \;
  clean_macos_metadata dist
}

notarize_and_verify_dmg() {
  local dmg="$1"

  echo "Signing $(basename "$dmg") with Developer ID..."
  codesign --force --timestamp --sign "$MAC_SIGNING_IDENTITY_HASH" "$dmg"
  codesign --verify --verbose=2 "$dmg"
  echo "Submitting $(basename "$dmg") to Apple notarisation..."
  xcrun notarytool submit "$dmg" \
    --keychain-profile "$APPLE_KEYCHAIN_PROFILE" \
    --wait
  xcrun stapler staple -v "$dmg"
  xcrun stapler validate "$dmg"
  spctl --assess --type open --context context:primary-signature -vvv "$dmg"
}

echo "──────────────────────────────────────────────────────────────"
echo "  WEMG release build — v${VERSION}"
echo "  Project: ${SCRIPT_DIR}"
echo "──────────────────────────────────────────────────────────────"

if ! git diff --quiet || ! git diff --cached --quiet 2>/dev/null; then
  echo "⚠  Uncommitted changes in working tree — building anyway."
fi

echo
echo "▸ Cleaning ./dist…"
rm -rf dist

echo
echo "▸ Stripping Mac metadata before packaging…"
clean_macos_metadata .
clean_macos_metadata node_modules/electron/dist

preflight_mac_signing
patch_electron_builder_mac_signing

echo
echo "▸ electron-builder --mac --arm64 (DMG)…"
prepare_mac_output_dir
if ! run_mac_builder; then
  echo
  echo "⚠ Mac build failed once. Re-stripping metadata and retrying…"
  prepare_mac_output_dir
  clean_macos_metadata node_modules/electron/dist
  run_mac_builder
fi
copy_mac_artifacts_to_dist

if [ "${WEMG_SKIP_MAC_SIGNING:-0}" != "1" ] && [ "${WEMG_SKIP_NOTARIZE:-0}" != "1" ]; then
  echo
  echo "▸ Notarising DMG…"
  for dmg in dist/WEMG-${VERSION}-*.dmg; do
    [ -e "$dmg" ] || continue
    notarize_and_verify_dmg "$dmg"
  done
fi

rm -rf "$MAC_DIST_TMP"

echo
echo "✓ Done. Artefacts in ./dist:"
ls -lh dist/*.dmg 2>/dev/null || echo "  (no dmg produced)"
