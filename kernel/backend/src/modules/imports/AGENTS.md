# Imports

- Declare all source inputs, including files, in one strict `AppSchema`; upload field keys must match sandbox artifact keys.
- Plugin sources parse artifacts in plugin activities and compose the kernel generic-import child. Keep source-specific tests in the plugin and orchestration tests with their workflows.
