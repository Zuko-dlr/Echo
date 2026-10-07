#!/bin/bash
# Compile Verre.app (sans Xcode : outils en ligne de commande uniquement)
set -euo pipefail
cd "$(dirname "$0")"
rm -rf build/Verre.app
mkdir -p build/Verre.app/Contents/MacOS build/Verre.app/Contents/Resources
# -wmo : optimisation de tout le module d'un coup (compilation plus rapide, binaire plus petit)
swiftc -O -wmo -swift-version 5 -target arm64-apple-macos14.0 \
  -framework AppKit -framework WebKit -framework AVFoundation -framework MediaPlayer \
  Sources/*.swift -o build/Verre.app/Contents/MacOS/Verre
cp Info.plist build/Verre.app/Contents/
cp -R web build/Verre.app/Contents/Resources/web
[ -f AppIcon.icns ] && cp AppIcon.icns build/Verre.app/Contents/Resources/
codesign --force --deep -s - build/Verre.app
echo "OK : build/Verre.app"
