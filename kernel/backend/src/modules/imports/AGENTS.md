# Imports Module

- Keep source-specific normalization and schema slugs in the owning plugin.
- Declare every source input, including files, in one strict `AppSchema`; keep upload field keys
  identical to sandbox artifact keys.
- Plugin sources add metadata and workflows to the owning plugin manifest, parse artifacts in a plugin
  activity, and compose the kernel generic-import child.
- The kernel-owned `data-json` source accepts generic records using existing definitions; it does not depend on a plugin installation.
- Keep orchestration tests beside the owning workflow, helper tests beside helpers, and
  source-specific tests in the plugin package.
