import { Effect } from "effect";

import { SandboxCompiler } from "./compiler";

export const validSandboxSource = `
import { defineDriver, defineManifest, defineScript } from "@ryot/sandbox-sdk/core";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  capabilities: [],
  name: "Plain value",
  slug: "plain-value",
  requiredAppConfigKeys: [],
});

const main = defineDriver(manifest, {
  output: Schema.Number,
  run: (input) => Effect.succeed(input.value),
  input: Schema.Struct({ value: Schema.Number }),
});

export default defineScript({ manifest, drivers: { main } });
`;

export const compileSandboxSourceForTest = (source: string) =>
	Effect.gen(function* () {
		const compiler = yield* SandboxCompiler;
		return yield* compiler.compile(source);
	}).pipe(Effect.provide(SandboxCompiler.Default));
