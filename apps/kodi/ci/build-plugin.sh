#!/usr/bin/env bash
set -euxo pipefail

cd "apps/kodi"
cp "../../LICENSE" "./LICENSE"
cd "../"
cp -r "kodi" "script.ryot"
zip -r "script.ryot.zip" "script.ryot"
rm -rf "script.ryot" "kodi/LICENSE"
cd "../"
mkdir -p "./tmp"
mv "./apps/script.ryot.zip" "./tmp/script.ryot.zip"
