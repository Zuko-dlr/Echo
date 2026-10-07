#!/bin/bash
# Fabrique l'archive à déposer sur la page « Releases » de GitHub : Echo-<version>-macOS-arm64.zip + sa somme SHA-256
set -euo pipefail
cd "$(dirname "$0")"
./build.sh
version=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" Info.plist)
mkdir -p dist
zip="dist/Echo-${version}-macOS-arm64.zip"
rm -f "$zip" "$zip.sha256"
ditto -c -k --keepParent build/Echo.app "$zip"
(cd dist && shasum -a 256 "$(basename "$zip")" > "$(basename "$zip").sha256")
echo "OK : $zip"
cat "$zip.sha256"
echo "→ Déposez ces deux fichiers sur la release v${version}.0 : https://github.com/Zuko-dlr/Echo/releases"
