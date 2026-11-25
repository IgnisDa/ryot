#!/usr/bin/env bash
set -euo pipefail

directory="${1:?Supply the image artifact directory}"
revision="${2:?Supply the source revision}"
architectures=(amd64 arm64)
archives=()
digests=()
versions=()

for arch in "${architectures[@]}"; do
  archive="oci-archive:$directory/ryot-image-$revision-$arch.tar"
  version="$(skopeo inspect --config "$archive" | jq -er --arg arch "$arch" --arg revision "$revision" '
    select(.os == "linux" and .architecture == $arch and .config.Labels["org.opencontainers.image.revision"] == $revision)
    | .config.Labels["org.opencontainers.image.version"]
    | strings | select(length > 0)
  ')"
  archives+=("$archive")
  versions+=("$version")
  digests+=("$(skopeo inspect --raw "$archive" | skopeo manifest-digest /dev/stdin)")
done

if [[ "${versions[0]}" != "${versions[1]}" ]]; then
  echo "Architecture images carry different build versions" >&2
  exit 1
fi

IFS=',' read -ra repositories <<< "${IMAGE_REPOSITORIES:?Supply the destination image repositories}"
for repository in "${repositories[@]}"; do
  mapfile -t tags < <(jq -er --arg repository "$repository" \
    '.tags[] | select(startswith($repository + ":")) | "--tag=" + .' <<< "$DOCKER_METADATA_OUTPUT_JSON")
  test "${#tags[@]}" -gt 0
  sources=()
  for index in "${!archives[@]}"; do
    destination="$repository@${digests[$index]}"
    skopeo copy --preserve-digests "${archives[$index]}" "docker://$destination"
    sources+=("$destination")
  done
  docker buildx imagetools create "${tags[@]}" "${sources[@]}"
done
