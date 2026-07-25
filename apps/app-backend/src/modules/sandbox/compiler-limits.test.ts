import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
	jsonByteLength,
	SANDBOX_LIMITS,
	utf8ByteLength,
} from "#lib/infrastructure/sandbox-runtime/limits";

import {
	compileSandboxSourceForTest as compile,
	validSandboxSource as validSource,
} from "./compiler-test-support";

it.effect("accepts the source byte boundary and rejects ASCII and multi-byte overflow", () =>
	Effect.gen(function* () {
		const commentOverhead = utf8ByteLength("\n/**/");
		const paddingBytes =
			SANDBOX_LIMITS.compiler.sourceBytes - utf8ByteLength(validSource) - commentOverhead;
		const boundarySource = `${validSource}\n/*${"a".repeat(paddingBytes)}*/`;

		expect(utf8ByteLength(boundarySource)).toBe(SANDBOX_LIMITS.compiler.sourceBytes);
		expect((yield* compile(boundarySource)).manifest.slug).toBe("plain-value");

		for (const source of [
			`${boundarySource}a`,
			"🙂".repeat(Math.floor(SANDBOX_LIMITS.compiler.sourceBytes / 4) + 1),
		]) {
			const failure = yield* compile(source).pipe(Effect.flip);
			expect(failure.diagnostics).toEqual([
				expect.objectContaining({ code: "RYOT_SOURCE_SIZE", file: "script.ts" }),
			]);
		}
	}),
);

it.effect("rejects a static manifest over its JSON byte boundary", () =>
	Effect.gen(function* () {
		const requiredKeys = Array.from(
			{ length: 900 },
			(_, index) => `"key-${index}-${"x".repeat(12)}"`,
		);
		const failure = yield* compile(
			validSource.replace(
				"requiredPluginConfigKeys: []",
				`requiredPluginConfigKeys: [${requiredKeys.join(",")}]`,
			),
		).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({ code: "RYOT_MANIFEST_SIZE", file: "script.ts" }),
		]);
	}),
);

it.effect("caps TypeScript diagnostic entries and serialized UTF-8 bytes", () =>
	Effect.gen(function* () {
		const invalidReferences = Array.from(
			{ length: SANDBOX_LIMITS.compiler.diagnosticCount + 25 },
			(_, index) => `void missingIdentifier${index};`,
		).join("\n");
		const failure = yield* compile(`${validSource}\n${invalidReferences}`).pipe(Effect.flip);

		expect(failure.diagnostics).toHaveLength(SANDBOX_LIMITS.compiler.diagnosticCount);
		expect(jsonByteLength(failure.diagnostics)).toBeLessThanOrEqual(
			SANDBOX_LIMITS.compiler.diagnosticBytes,
		);
	}),
);

it.effect("rejects bundled JavaScript over the compiled-module byte limit", () =>
	Effect.gen(function* () {
		const enumMembers = Array.from({ length: 25_000 }, (_, index) => `A${index},`).join("");
		const source = `
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
export enum LargeCompiledValue { ${enumMembers} }
export const manifest = defineManifest({
  kind: "script",
  capabilities: [],
  requiredPluginConfigKeys: [],
  requiredSystemConfigKeys: [],
  name: "Large compiled value",
  slug: "large-compiled-value",
	});
export default defineScript({
	manifest,
  output: Schema.Null,
  input: Schema.Struct({}),
  run: () => Effect.succeed(null),
});
`;
		expect(utf8ByteLength(source)).toBeLessThan(SANDBOX_LIMITS.compiler.sourceBytes);
		const failure = yield* compile(source).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({ code: "RYOT_COMPILED_SIZE", file: "script.ts" }),
		]);
	}),
);
