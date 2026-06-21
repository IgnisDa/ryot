import { Effect } from "effect";

import { SandboxCompiler } from "./compiler";

export const validSandboxSource = `
import { defineDriver, defineManifest, defineScript } from "@ryot/sandbox-sdk";
import * as z from "@ryot/sandbox-sdk/zod";

export const manifest = defineManifest({
  kind: "script",
  capabilities: [],
  name: "Plain value",
  slug: "plain-value",
  requiredAppConfigKeys: [],
});

const main = defineDriver(manifest, {
  output: z.number(),
  run: async (input) => input.value,
  input: z.object({ value: z.number() }),
});

export default defineScript({ manifest, drivers: { main } });
`;

export const compileSandboxSourceForTest = (source: string) =>
	Effect.gen(function* () {
		const compiler = yield* SandboxCompiler;
		return yield* compiler.compile(source);
	}).pipe(Effect.provide(SandboxCompiler.Default));
