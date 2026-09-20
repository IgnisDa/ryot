import { Effect } from "effect";

import { SandboxCompiler } from "./sandbox-compiler";

export const validSandboxSource = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Plain value",
  slug: "plain-value",
});

export default defineScript({
	manifest,
  output: Schema.Number,
  run: (input) => Effect.succeed(input.value),
  input: Schema.Struct({ value: Schema.Number }),
});
`;

export const compileSandboxSourceForTest = Effect.fnUntraced(function* (source: string) {
	const compiler = yield* SandboxCompiler;
	return yield* compiler.compile(source);
});
