import { describe, expect, test } from "bun:test";

import {
	claimPersistentValueResultSchema,
	httpCallArgsSchema,
	httpCallResultSchema,
	logArgsSchema,
	spanArgsSchema,
} from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import { defineManifest, defineScript, SANDBOX_SCRIPT_DEFINITION } from "../src/driver";
import { asRecord, jsonValueSchema } from "../src/wire";

describe("generic script definitions", () => {
	test("preserves the manifest, schemas, and inferred implementation", () => {
		const manifest = defineManifest({ kind: "script", name: "Increment", slug: "increment" });
		const definition = defineScript({
			manifest,
			output: Schema.Finite,
			input: Schema.Struct({ value: Schema.Finite }),
			run: (input) => Effect.succeed(input.value + 1),
		});

		expect(definition.definitionType).toBe(SANDBOX_SCRIPT_DEFINITION);
		expect(definition.manifest).toBe(manifest);
		expect(Effect.runSync(definition.run({ value: 41 }))).toBe(42);
	});
});

describe("shared value contracts", () => {
	it.effect(
		"accepts nested JSON and discriminates host failures",
		() =>
			Effect.gen(function* () {
				expect(yield* Schema.decodeEffect(jsonValueSchema)({ nested: [true, 2, null] })).toEqual({
					nested: [true, 2, null],
				});
				yield* Effect.flip(Schema.decodeEffect(jsonValueSchema)(Number.NaN));
				yield* Effect.flip(Schema.decodeEffect(jsonValueSchema)(Number.POSITIVE_INFINITY));
				const cyclic: Record<string, unknown> = {};
				cyclic["self"] = cyclic;
				yield* Effect.flip(Schema.decodeUnknownEffect(jsonValueSchema)(cyclic));
				yield* Effect.flip(Schema.decodeEffect(jsonValueSchema)(Array(1)));
			}),
		testTimeout,
	);

	it.effect(
		"preserves core host result variants",
		() =>
			Effect.gen(function* () {
				expect(
					yield* Schema.decodeEffect(httpCallArgsSchema)([
						"GET",
						"https://example.com",
						{ allowInsecureConnections: true },
					]),
				).toEqual(["GET", "https://example.com", { allowInsecureConnections: true }]);
				expect(
					yield* Schema.decodeEffect(httpCallResultSchema)({
						success: false,
						error: "HTTP 429",
						data: { status: 429, body: "rate limited", headers: { "retry-after": "10" } },
					}),
				).toEqual({
					success: false,
					error: "HTTP 429",
					data: { status: 429, body: "rate limited", headers: { "retry-after": "10" } },
				});
				expect(
					yield* Schema.decodeEffect(claimPersistentValueResultSchema)({
						success: true,
						data: { claimed: false, value: { owner: "other" } },
					}),
				).toEqual({ success: true, data: { claimed: false, value: { owner: "other" } } });
			}),
		testTimeout,
	);

	it.effect(
		"accepts valid log and span batches",
		() =>
			Effect.gen(function* () {
				expect(
					yield* Schema.decodeEffect(logArgsSchema)([
						[
							{
								level: "info",
								message: "Imported entities",
								attributes: { count: 2, context: { source: "provider" } },
							},
						],
					]),
				).toEqual([
					[
						{
							level: "info",
							message: "Imported entities",
							attributes: { count: 2, context: { source: "provider" } },
						},
					],
				]);
				expect(yield* Schema.decodeEffect(spanArgsSchema)([[{ name: "provider.import" }]])).toEqual(
					[[{ name: "provider.import" }]],
				);
			}),
		testTimeout,
	);

	it.effect(
		"rejects malformed or excess log and span entries",
		() =>
			Effect.gen(function* () {
				yield* Effect.flip(
					Schema.decodeUnknownEffect(logArgsSchema)([[{ level: "notice", message: "message" }]]),
				);
				yield* Effect.flip(Schema.decodeEffect(logArgsSchema)([[{ message: "", level: "error" }]]));
				yield* Effect.flip(
					Schema.decodeUnknownEffect(logArgsSchema)([
						[{ extra: true, level: "debug", message: "message" }],
					]),
				);
				yield* Effect.flip(Schema.decodeEffect(spanArgsSchema)([[{ name: "", attributes: {} }]]));
				yield* Effect.flip(
					Schema.decodeUnknownEffect(spanArgsSchema)([[{ extra: true, name: "span" }]]),
				);
			}),
		testTimeout,
	);
});

describe("sandbox test hosts", () => {
	test("invokes a script with partial host stubs", () => {
		const manifest = defineManifest({ kind: "script", name: "Cache reader", slug: "cache-reader" });
		const definition = defineScript({
			manifest,
			output: Schema.NullOr(Schema.Finite),
			input: Schema.Struct({ key: Schema.String }),
			run: (input, host) =>
				host
					.getCachedValue(input.key)
					.pipe(Effect.map((value) => (typeof value === "number" ? value : null))),
		});
		const host = defineSandboxTestHost(manifest, { getCachedValue: () => Effect.succeed(42) });

		return Effect.runPromise(
			runSandboxTestScript(definition, { key: "answer" }, host, {
				metadata: {},
				sandboxScriptId: "script-1",
			}).pipe(Effect.map((value) => expect(value).toBe(42))),
		);
	});
});

describe("domain host contracts", () => {
	test("invokes domain host stubs and keeps RyotQL output unparsed", () => {
		const manifest = defineManifest({
			kind: "script",
			name: "Domain reader",
			slug: "domain-reader",
		});
		const definition = defineScript({
			manifest,
			input: Schema.Struct({}),
			output: Schema.Struct({ rows: Schema.Finite }),
			run: (_input, host) =>
				host
					.executeRyotql({ source: { kind: "inline", document: { queries: {} } } })
					.pipe(Effect.map((result) => ({ rows: Array.isArray(result) ? result.length : 0 }))),
		});
		const host = defineSandboxTestHost(manifest, {
			executeRyotql: () => Effect.succeed([{ id: "a" }, { id: "b" }]),
		});

		return Effect.runPromise(
			runSandboxTestScript(definition, {}, host, {
				metadata: {},
				sandboxScriptId: "script-1",
			}).pipe(Effect.map((value) => expect(value).toEqual({ rows: 2 }))),
		);
	});
});

describe("asRecord", () => {
	test("returns plain objects unchanged", () => {
		const value = { a: 1 };
		expect(asRecord(value)).toBe(value);
	});

	test.each([null, undefined, [], [1], "text", 3, true].map((value) => ({ value })))(
		"rejects $value",
		({ value }) => {
			expect(asRecord(value)).toBeNull();
		},
	);
});
