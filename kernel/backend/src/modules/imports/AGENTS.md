# Imports Module

- Keep source-specific normalization and schema slugs in the owning plugin.
- Declare every source input, including files, in one strict `AppSchema`; keep upload field keys
  identical to sandbox artifact keys.
- Add source metadata and workflows to the owning plugin manifest, parse artifacts in a plugin
  activity, and compose the kernel generic-import child.
- Keep orchestration tests beside the owning workflow, helper tests beside helpers, and
  source-specific tests in the plugin package.
