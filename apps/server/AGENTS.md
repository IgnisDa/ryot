# Server Assembly

- Keep process startup and layer sequencing here; domain behavior belongs in plugins and reusable runtime behavior belongs in the kernel.
- Keep development assembly under `apps/server` aligned with the `/home/ryot` image layout and working-directory-relative configuration defaults.
- Build client runtime and kernel renderer artifacts during assembly; the production server imports prebuilt artifacts and does not ship compiler workers.
- Declare the shipped plugin set in `shipped-plugins.json`; assembly, documentation generation, and the image all derive from it.
- Assembly ships one `<slug>.zip` archive per declared plugin.
