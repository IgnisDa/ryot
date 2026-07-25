# Upload-Based Install And Update

**Parent Plan:** [Plugin Package Transport](./README.md)

**Status:** pending

## What to build

Replace the request-body source transport for plugin install and update with the existing upload path, following the parent plan's Upload Lifecycle decisions. Only transport changes; every validation, compilation, and configuration behavior stays exactly as it is.

Change the install and update contract to accept an upload token and configuration. Remove the manifest object and the source file map from the request body. There is no compatibility path for the previous shape.

Have the server claim the uploaded object through the existing upload intent path used by imports and backup restore, releasing it on both success and failure. Read and validate the archive before ingestion begins, then hand the decoded manifest and file map to the unchanged pipeline. Package limits, manifest decoding, source validation, compilation, effective-registry collision checks, schema-evolution checks, and configuration validation keep their current behavior and current order. Add the plugin archive extension to the supported upload extensions so upload validation accepts it.

Preserve existing structured failure reasons and report archive-level failures distinctly from manifest, compilation, and configuration failures, so an author can tell a bad file from a bad plugin.

No plugin management interface exists, so this task changes no client code. The interface is built against this contract when the client plugin architecture is implemented.

## Acceptance criteria

- [ ] Install and update accept an upload token and configuration, and reject a manifest or source file map in the request body.
- [ ] The uploaded object is claimed through the existing upload intent path and released on both success and failure.
- [ ] The archive is read and validated before any ingestion, compilation, or database work begins.
- [ ] Package limits, manifest decoding, source validation, compilation, collision checks, schema-evolution checks, and configuration validation are unchanged in behavior and order.
- [ ] Installing the same package as an archive produces the same plugin, installation, scripts, and source hash as the previous transport did.
- [ ] The plugin archive extension is accepted by upload validation.
- [ ] Archive-level failures are reported distinctly from manifest, compilation, and configuration failures, and existing structured reasons are preserved.
- [ ] No compatibility path for the previous request body remains.
- [ ] Repository check and test tasks pass.
