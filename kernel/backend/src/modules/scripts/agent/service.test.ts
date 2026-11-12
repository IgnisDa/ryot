import { expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import { BadRequest } from "@ryot-app/contract/errors";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { sandboxHostEffect } from "@ryot-app/sandbox/host/invocation";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { arrayContaining, objectContaining, stringContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer, Schema } from "effect";

import {
	realSandboxLayer,
	RealSandboxScripts,
	realSandboxUserId,
} from "../executions/real-sandbox.test-support";
import { ScriptExecutionService } from "../executions/service";
import { AgentScriptRepository } from "./repository";
import { AgentScriptService } from "./service";

const source = (body: string, sdk = "agent", output = "Schema.Unknown", imports = "") => `
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/${sdk}";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
${imports}
export const manifest = defineManifest({ kind: "script", name: "Agent test", slug: "agent.test" });
export default defineScript({ manifest, input: Schema.Struct({}), output: ${output},
run: (_input, host) => Effect.gen(function* () { ${body} }) });
`;

const options = (script: string) => ({
	source: script,
	allowWrites: false,
	userId: realSandboxUserId,
	accessClass: "standard" as const,
	invokeOperation: () => Effect.die("Unexpected operation"),
	executeRyotql: (_request: JsonValue) => Effect.succeed<JsonValue>({ rows: [2, 3, 5] }),
});

const agentLayer = AgentScriptService.layer.pipe(
	Layer.provideMerge(AgentScriptRepository.layer),
	Layer.provideMerge(realSandboxLayer({ perUserSidecars: true })),
	Layer.provide(BunCrypto.layerSecureRandom),
);

layer(agentLayer)((test) => {
	test.effect(
		"reads and aggregates JSON with logs, retaining owned history and replaying completed runs",
		() =>
			Effect.gen(function* () {
				const scripts = yield* AgentScriptService;
				const repository = yield* AgentScriptRepository;
				let reads = 0;
				const input = {
					...options(
						source(
							`
 const event = table("event", "event");
 const historyRecipe = defineRecipe({ parameters: { fields: {} }, queries: { history: selectedRows(event, { limit: 100, selection: { value: selectedField(literal(0), Schema.Number) } }) } });
 console.log("before query");
 console.log("before query");
 const response = yield* executeRyotqlRecipe(host.executeRyotql, historyRecipe, {});
 yield* host.log([{ level: "info", message: "aggregated history" }]);
 return { total: response.history.items.reduce((sum, item) => sum + item.value, 0) };
 `,
							"agent",
							"Schema.Unknown",
							'import { defineRecipe, selectedRows, selectedField, literal, table, executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";',
						),
					),
					idempotencyKey: "history",
					executeRyotql: () =>
						Effect.sync(() => {
							reads += 1;
							return {
								data: {
									history: {
										type: "rows",
										items: [{ value: 2 }, { value: 3 }, { value: 5 }],
										pageInfo: { limit: 100, hasMore: false, nextCursor: null },
									},
								},
							};
						}),
				};
				const result = yield* scripts.run(input);
				expect(result).toMatchObject({
					truncated: false,
					value: { error: null, value: { total: 10 } },
				});
				assert(!result.truncated);
				const complete = result["value"];
				assert(isObjectRecord(complete));
				const id = complete["executionId"];
				assert(typeof id === "string");
				const logs = complete["logs"];
				assert(Array.isArray(logs));
				expect(logs).toHaveLength(3);
				expect(logs.slice(0, 2)).toEqual(["before query", "before query"]);
				expect(logs[2]).toContain("aggregated history");
				const stored = yield* repository.find(realSandboxUserId, id);
				expect(stored?.principal?.pluginRevision).toBeNull();
				expect(stored?.completedAt).not.toBeNull();
				expect(stored?.result).toEqual(result);
				expect(yield* repository.find(UserId.make("another-user"), id)).toBeNull();
				expect(yield* scripts.run(input)).toEqual(result);
				expect(reads).toBe(1);
			}),
		testTimeout,
	);

	test.effect(
		"rejects raw writes, HTTP, and unapproved operation calls before dispatch",
		() =>
			Effect.gen(function* () {
				const scripts = yield* AgentScriptService;
				for (const body of [
					'yield* host.httpCall("GET", "https://example.com"); return null;',
					"yield* host.createEvents([]); return null;",
					'return yield* host.invokeOperation({ name: "testing.fixture.write", arguments: {} });',
				]) {
					const result = yield* scripts.run(options(source(body, "driver")));
					expect(result).toMatchObject({
						truncated: false,
						value: { value: null, error: { message: stringContaining("Agent") } },
					});
				}
			}),
		testTimeout,
	);

	test.effect(
		"resumes multiple operation calls without repeating earlier writes and reuses completed results",
		() =>
			Effect.gen(function* () {
				const scripts = yield* AgentScriptService;
				const operation = yield* (yield* RealSandboxScripts).install(`
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
export const manifest = defineManifest({ kind: "operation", name: "Echo operation", slug: "agent.echo" });
export default defineOperation({ manifest, input: Schema.Struct({ item: Schema.Number }), output: Schema.Struct({ item: Schema.Number }), run: input => Effect.succeed(input) });
`);
				const operations = yield* ScriptExecutionService;
				const keys: string[] = [];
				const input = {
					...options(
						source(`
 const first = yield* host.invokeOperation({ name: "testing.fixture.write", arguments: { item: 1 } });
 const second = yield* host.invokeOperation({ name: "testing.fixture.write", arguments: { item: 2 } });
 return { first, second };
 `),
					),
					allowWrites: true,
					idempotencyKey: "writes",
					invokeOperation: (request: { readonly arguments: JsonValue }, key: string) =>
						sandboxHostEffect(
							Effect.gen(function* () {
								keys.push(key);
								const result = yield* operations.executeScript({
									executionId: key,
									lane: "interactive",
									input: request.arguments,
									scriptId: operation.scriptId,
									pluginRevision: operation.pluginRevision,
									subject: { type: "user", userId: realSandboxUserId },
								});
								if (result.error !== null) {
									return yield* Effect.fail({ message: result.error.message });
								}
								return yield* Schema.decodeUnknownEffect(JsonValue)(result.value);
							}),
						),
				};
				const result = yield* scripts.run(input);
				expect(result).toMatchObject({
					truncated: false,
					value: { error: null, value: { first: { item: 1 }, second: { item: 2 } } },
				});
				expect(keys).toHaveLength(2);
				expect(keys[0]).toEndWith(":0");
				expect(keys[1]).toEndWith(":1");
				expect(yield* scripts.run(input)).toEqual(result);
				expect(keys).toHaveLength(2);
				assertExitFails(
					yield* Effect.exit(scripts.run({ ...input, source: source("return null;") })),
					new BadRequest({
						message: "Agent execution key was reused with different input or authority",
					}),
				);
			}),
		testTimeout,
	);

	test.effect(
		"returns compiler diagnostics and bounds outputs and logs before history persistence",
		() =>
			Effect.gen(function* () {
				const scripts = yield* AgentScriptService;
				const invalid = yield* scripts.run(
					options(source('return "wrong";', "agent", "Schema.Number")),
				);
				expect(invalid).toMatchObject({
					truncated: false,
					value: {
						value: null,
						diagnostics: arrayContaining([objectContaining({ severity: "error" })]),
					},
				});
				const large = yield* scripts.run(
					options(
						source(
							'for (let i = 0; i < 700; i += 1) { console.log("x".repeat(1000)); } return "y".repeat(100000);',
						),
					),
				);
				expect(new TextEncoder().encode(stableStringify(large)).length).toBeLessThanOrEqual(65_536);
				expect(large).toMatchObject({ truncated: true });
			}),
		testTimeout,
	);

	test.effect(
		"refuses demo write approval and refuses restarting an unfinished execution",
		() =>
			Effect.gen(function* () {
				const scripts = yield* AgentScriptService;
				const input = options(source("return null;"));
				assertExitFails(
					yield* Effect.exit(scripts.run({ ...input, allowWrites: true, accessClass: "demo" })),
					new BadRequest({ message: "Demo sessions cannot approve agent writes" }),
				);
				const repository = yield* AgentScriptRepository;
				const id = SandboxScriptId.make(
					`agent-${sha256Hex(stableStringify([realSandboxUserId, "unfinished"]))}`,
				);
				yield* repository.create({
					id,
					allowWrites: false,
					source: input.source,
					userId: realSandboxUserId,
				});
				assertExitFails(
					yield* Effect.exit(scripts.run({ ...input, idempotencyKey: "unfinished" })),
					new BadRequest({
						message:
							"Agent execution is already running or was interrupted; it cannot be restarted",
					}),
				);
			}),
		testTimeout,
	);
});
