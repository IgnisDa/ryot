# Server Assembly

- Keep startup and assembly here, domain behavior in plugins, and reusable runtime behavior in the kernel.
- Read shipped plugin declarations only through `tooling/shipped-plugins.ts`. Production imports prebuilt client artifacts and must not require compiler workers.
