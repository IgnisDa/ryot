import { assert, expect, layer } from "@effect/vitest";
import { jsonByteLength, utf8ByteLength } from "@ryot-app/sandbox-compiler/limits";
import { Effect, Schema } from "effect";

import { SANDBOX_LIMITS } from "#lib/infrastructure/sandbox-runtime/limits";

import { SandboxCompiler } from "./sandbox-compiler";
import {
	compileSandboxSourceForTest as compile,
	validSandboxSource as validSource,
} from "./sandbox-compiler-test-support";

layer(SandboxCompiler.layer)((test) => {
	test.effect("accepts the source byte boundary and rejects ASCII and multi-byte overflow", () =>
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
					expect.objectContaining({ file: "script.ts", code: "RYOT_SOURCE_SIZE" }),
				]);
			}
		}),
	);
});

layer(SandboxCompiler.layer)((test) => {
	test.effect("accepts the full manifest byte boundary and rejects static UTF-8 overflow", () =>
		Effect.gen(function* () {
			const baseline = yield* compile(validSource);
			const manifestBytes = jsonByteLength(baseline.manifest);
			assert(manifestBytes !== null);
			const padding = SANDBOX_LIMITS.compiler.manifestBytes - manifestBytes;
			const name = `Plain value${"a".repeat(padding)}`;
			const boundary = yield* compile(validSource.replace("Plain value", name));
			expect(jsonByteLength(boundary.manifest)).toBe(SANDBOX_LIMITS.compiler.manifestBytes);

			for (const overflow of ["a", "🙂"]) {
				const failure = yield* compile(
					validSource.replace("Plain value", `${name}${overflow}`),
				).pipe(Effect.flip);
				expect(failure.diagnostics).toEqual([
					expect.objectContaining({ file: "script.ts", code: "RYOT_MANIFEST_SIZE" }),
				]);
			}
		}),
	);
	test.effect.each(["required", "optional"] as const)(
		"counts generated %s configuration keys in the manifest byte limit",
		(keyKind) =>
			Effect.gen(function* () {
				const keys = Array.from({ length: 200 }, (_, index) => `${index}-${"k".repeat(90)}`);
				const encoded = yield* Schema.encodeEffect(
					Schema.fromJsonString(Schema.Array(Schema.String)),
				)(keys);
				const source = validSource
					.replace("capabilities: []", 'capabilities: ["getPluginConfig"]')
					.replace(
						"run: (input) => Effect.succeed(input.value)",
						`run: (_input, host) => host.getPluginConfig({ ${keyKind}: ${encoded} }).pipe(Effect.as(1))`,
					);
				expect(utf8ByteLength(source)).toBeLessThan(SANDBOX_LIMITS.compiler.sourceBytes);
				expect(jsonByteLength(keys)).toBeGreaterThan(SANDBOX_LIMITS.compiler.manifestBytes);
				const failure = yield* compile(source).pipe(Effect.flip);
				expect(failure.diagnostics).toEqual([
					expect.objectContaining({ file: "script.ts", code: "RYOT_MANIFEST_SIZE" }),
				]);
			}),
	);
});

layer(SandboxCompiler.layer)((test) => {
	test.effect("caps TypeScript diagnostic entries and serialized UTF-8 bytes", () =>
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
});

layer(SandboxCompiler.layer)((test) => {
	test.effect("rejects bundled JavaScript over the compiled-module byte limit", () =>
		Effect.gen(function* () {
			const enumMembers = Array.from({ length: 25_000 }, (_, index) => `A${index},`).join("");
			const source = `
	import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
	import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
	export enum LargeCompiledValue { ${enumMembers} }
	export const manifest = defineManifest({
	  kind: "script",
	  capabilities: [],
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
				expect.objectContaining({ file: "script.ts", code: "RYOT_COMPILED_SIZE" }),
			]);
		}),
	);
});
