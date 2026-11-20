#!/usr/bin/env bash
set -euo pipefail

archive="oci-archive:${1:?Supply the OCI archive}"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
docker_archive="$scratch/image.tar"

skopeo copy "$archive" "docker-archive:$docker_archive:ryot-image:latest"
expected_config="$(skopeo inspect --raw "$archive" | jq -er '.config.digest')"
config_path="$(tar -xOf "$docker_archive" manifest.json | jq -er '.[0].Config')"
actual_config="sha256:$(tar -xOf "$docker_archive" "$config_path" | sha256sum | cut -d' ' -f1)"
test "$actual_config" = "$expected_config"
docker load --input "$docker_archive"
