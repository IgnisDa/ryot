# Server Assembly

- Keep process startup and layer sequencing here; domain behavior belongs in plugins and reusable runtime behavior belongs in the kernel.
- Keep development assembly under `apps/server` aligned with the `/home/ryot` image layout and working-directory-relative configuration defaults.
- Keep the production image aligned with both compiler packages: install their package-owned production dependencies, ship both worker artifacts, and smoke-check both workers before completing image assembly.
- Declare the shipped plugin set in `shipped-plugins.json`; assembly, documentation generation, and the image all derive from it.
- Assembly ships one `<slug>.zip` archive per declared plugin.
