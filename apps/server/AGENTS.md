# Server Assembly

- Keep process startup and layer sequencing here; domain behavior belongs in plugins and reusable runtime behavior belongs in the kernel.
- Keep development assembly under `apps/server` aligned with the `/home/ryot` image layout and working-directory-relative configuration defaults.
- Declare the shipped plugin set in `shipped-plugins.json`; assembly, documentation generation, and the image all derive from it.
