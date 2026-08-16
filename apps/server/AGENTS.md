# Server Assembly

- Keep process startup and layer sequencing here; domain behavior belongs in plugins and reusable runtime behavior belongs in the kernel.
- Keep development assembly under `apps/server` aligned with the `/home/ryot` image layout and working-directory-relative configuration defaults.
- Add or remove shipped development plugins in `scripts/assemble.ts`; production shipment is explicit in the root `Dockerfile`.
