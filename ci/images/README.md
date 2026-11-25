# Image validation and publication

PR Validation and Main Publication share the build, catalog, chart, sandbox, and Kubernetes jobs.
Each job checks out the triggering commit supplied by GitHub. PR Validation uses the synthetic
merge commit. The build uploads each smoke-tested architecture as a single OCI archive named for
that revision. Validation and publication use those archives by digest.

Main Publication takes protected main pushes, protected release tags on main, and manual runs on
protected main. It promotes both architectures from the current run. Release builds and publishers
run with Actions caches disabled. The release tag run also publishes the chart, bundled extensions,
and documentation.

Publish PR Preview runs on the protected default branch and accepts a PR number. It finds a
successful PR Validation run for the current same-repository PR and downloads both OCI archives
from that run by artifact ID. The workflow verifies archive integrity, rechecks the current merge
revision, and promotes the images to `ghcr.io/ignisda/ryot-preview:pr-<number>`. Preview code runs
during PR Validation. The publishing runner handles the archived images as data.

## Repository settings

- Use GitHub rulesets to require review before merging to `main` and restrict matching release tag
  creation and updates to release maintainers.
- Configure the `release` environment to admit protected `main` and protected release tags. Set
  the `RELEASE_GHCR_USERNAME` variable and the `RELEASE_GHCR_TOKEN` and `DOCKER_TOKEN` secrets
  there. Grant the GHCR account write access to the release images and chart package.
- Configure the `preview` environment to admit only the protected default branch. Set the
  `PREVIEW_GHCR_USERNAME` variable and the `PREVIEW_GHCR_TOKEN` secret there. Grant that account
  write access to the preview image package only.
- Keep registry credentials environment-scoped. Configure registry package access so that
  GitHub Actions' repository token cannot write the release or preview packages.
