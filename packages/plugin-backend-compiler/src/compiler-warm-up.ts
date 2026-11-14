export const SANDBOX_COMPILER_WARM_UP_SOURCE = `import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/agent";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";
export const manifest = defineManifest({ kind: "script", name: "Compiler warm-up", slug: "compiler-warm-up" });
export default defineScript({ manifest, input: Schema.Struct({}), output: Schema.Unknown,
 run: (_input, host) => host.invokeCapability({ id: "kernel:pages.list", input: {} }) });`;
