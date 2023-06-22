#!/usr/bin/env bash

set -euxo pipefail

cp "../../LICENSE" "./LICENSE"
cd "../"
cp -r "kodi" "script.kodi"
zip -r "script.kodi.zip" "script.kodi"
rm -rf "script.kodi"
cd "../"
mkdir -p "./tmp"
mv "./apps/script.kodi.zip" "./tmp/script.kodi.zip"
