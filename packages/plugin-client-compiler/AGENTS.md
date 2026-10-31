# Client Plugin Compiler

- Keep compiler policy and artifacts independent of the backend compiler; share only `@ryot-app/typescript-compiler` infrastructure.
- `CLIENT_DEPENDENCY_REGISTRY` in `src/dependencies.ts` is the sole import-policy authority. Resolve trusted packages through public exports; never add package-specific bundler repairs.
- Keep `shared/**` imports aligned with sandbox policy: approved neutral shims and relative imports within `shared/` only.
- Scan client sources and both SDKs for Tailwind classes; disable automatic scanning. Preserve compiler-owned CSS ordering.
- The compiler embeds artifact identity. Hash all emitted files, imports, identity, and authored client declarations; reuse cache only on an exact metadata match. See `README.md` before changing emission or identity.
