import { SandboxCompilationFailure } from "@ryot-app/contract/modules/scripts/schemas";
import { assert } from "@ryot-app/testing/assert";
import { Effect } from "effect";

import { SandboxCompiler } from "./compiler";

export const validSandboxSource = `
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

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

export const compilationFailureForTest = Effect.fnUntraced(function* (source: string) {
	const failure = yield* compileSandboxSourceForTest(source).pipe(Effect.flip);
	assert(failure instanceof SandboxCompilationFailure);
	return failure;
});
