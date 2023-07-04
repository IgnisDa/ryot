#!/usr/bin/env bash

set -euxo pipefail

cp "../../LICENSE" "./LICENSE"
cd "../"
cp -r "kodi" "script.ryot"
cp -r "../libs/graphql/src/backend/." "./script.ryot/resources/lib"
zip -r "script.ryot.zip" "script.ryot"
rm -rf "script.ryot" "kodi/LICENSE" "kodi/graphql"
cd "../"
mkdir -p "./tmp"
mv "./apps/script.ryot.zip" "./tmp/script.ryot.zip"
