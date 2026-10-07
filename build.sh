#!/bin/bash
# Compile Echo.app (sans Xcode : outils en ligne de commande uniquement)
set -euo pipefail
cd "$(dirname "$0")"
rm -rf build/Echo.app build/Verre.app
mkdir -p build/Echo.app/Contents/MacOS build/Echo.app/Contents/Resources
# -wmo : optimisation de tout le module d'un coup (compilation plus rapide, binaire plus petit)
swiftc -O -wmo -swift-version 5 -target arm64-apple-macos14.0 \
  -framework AppKit -framework WebKit -framework AVFoundation -framework MediaPlayer \
  Sources/*.swift -o build/Echo.app/Contents/MacOS/Echo
cp Info.plist build/Echo.app/Contents/
cp -R web build/Echo.app/Contents/Resources/web
[ -f AppIcon.icns ] && cp AppIcon.icns build/Echo.app/Contents/Resources/
codesign --force --deep -s - build/Echo.app
echo "OK : build/Echo.app"
