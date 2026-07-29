#!/bin/bash
# Builds the menu-bar app (and the icon preview tool used to eyeball the icon).
#
# No Xcode project on purpose: this is two Swift files with no dependencies, and
# `swiftc` is enough. The output is a plain binary, not an .app bundle — the app
# calls setActivationPolicy(.accessory) itself, so it stays out of the Dock
# without needing an Info.plist.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p mac/build
swiftc -O mac/PlanerBotIcon.swift mac/PlanerBotMenu.swift -o mac/build/PlanerBotMenu
swiftc -O mac/PlanerBotIcon.swift mac/IconPreview.swift  -o mac/build/IconPreview
echo "собрано: mac/build/PlanerBotMenu"

if launchctl print "gui/$(id -u)/com.planerbot.menubar" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/com.planerbot.menubar"
  echo "меню перезапущено"
fi
