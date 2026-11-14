import { expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import { CompilerWorkerUnavailable } from "@ryot-app/compiler-worker/pool";
import { BadRequest } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { arrayContaining, objectContaining, stringContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";

import { realSandboxLayer, realSandboxUserId } from "../executions/real-sandbox.test-support";
import { SandboxCompiler } from "../registry/compiler";
import { AgentScriptRepository } from "./repository";
import {
	type AgentCapabilityCall,
	AgentRunSuspended,
	type AgentScriptRun,
	AgentScriptService,
} from "./service";

const source = (body: string, sdk = "agent", output = "Schema.Unknown", imports = "") => `
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/${sdk}";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
${imports}
export const manifest = defineManifest({ kind: "script", name: "Agent test", slug: "agent.test" });
export default defineScript({ manifest, input: Schema.Struct({}), output: ${output},
run: (_input, host) => Effect.gen(function* () { ${body} }) });
`;

const options = (script: string, invokeCapability: AgentCapabilityCall) => ({
	source: script,
	invokeCapability,
	userId: realSandboxUserId,
	accessClass: "standard" as const,
});
const unexpected: AgentCapabilityCall = () => Effect.die("Unexpected capability call");
const completed = (run: AgentScriptRun) => {
	assert(run.state === "completed");
	return run.result;
};

const agentLayer = AgentScriptService.layer.pipe(
	Layer.provideMerge(AgentScriptRepository.layer),
	Layer.provideMerge(realSandboxLayer({ perUserSidecars: true })),
	Layer.provide(BunCrypto.layerSecureRandom),
);

layer(agentLayer)((test) => {
	test.effect(
		"reads through capability calls with logs, retaining owned history and replaying completed runs",
		() =>
			Effect.gen(function* () {
				const scripts = yield* AgentScriptService;
				const repository = yield* AgentScriptRepository;
				const requests: unknown[] = [];
				const input = {
					...options(
						source(`
 console.log("before query");
 const response = yield* host.invokeCapability({ id: "kernel:query", input: { rows: 3 } });
 yield* host.log([{ level: "info", message: "aggregated history" }]);
 return { response };
 `),
						(request, call) =>
							Effect.sync(() => {
								requests.push([request, call.index]);
								return { values: [2, 3, 5] };
							}),
					),
					idempotencyKey: "history",
				};
				const result = completed(yield* scripts.run(input));
				expect(result).toMatchObject({
					truncated: false,
					value: { error: null, value: { response: { values: [2, 3, 5] } } },
				});
				expect(requests).toEqual([[{ id: "kernel:query", input: { rows: 3 } }, 0]]);
				assert(!result.truncated && isObjectRecord(result.value));
				const id = result.value["executionId"];
				const logs = result.value["logs"];
				assert(typeof id === "string" && Array.isArray(logs));
				expect(logs[0]).toBe("before query");
				expect(logs[1]).toContain("aggregated history");
				const stored = yield* repository.find(realSandboxUserId, id);
				expect(stored?.principal?.pluginRevision).toBeNull();
				expect(stored?.completedAt).not.toBeNull();
				expect(stored?.result).toEqual(result);
				expect(yield* repository.find(UserId.make("another-user"), id)).toBeNull();
				expect(completed(yield* scripts.run(input))).toEqual(result);
				expect(requests).toHaveLength(1);
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
		"rejects HTTP, raw writes and direct queries before dispatch",
		() =>
			Effect.gen(function* () {
				const scripts = yield* AgentScriptService;
				for (const body of [
					'yield* host.httpCall("GET", "https://example.com"); return null;',
					"yield* host.createEvents([]); return null;",
					"yield* host.executeRyotql(undefined as never); return null;",
				]) {
					const result = completed(yield* scripts.run(options(source(body, "driver"), unexpected)));
					expect(result).toMatchObject({
						truncated: false,
						value: { value: null, error: { message: stringContaining("Agent") } },
					});
				}
			}),
		testTimeout,
	);

	test.effect(
		"suspends at a capability call, persists its journal and resumes without repeating settled calls",
		() =>
			Effect.gen(function* () {
				const scripts = yield* AgentScriptService;
				const calls: string[] = [];
				let approved = false;
				const input = {
					...options(
						source(`
 const first = yield* host.invokeCapability({ id: "kernel:pages.list", input: {} });
 const second = yield* host.invokeCapability({ id: "kernel:pages.delete", input: { pageId: "p" } });
 return { first, second };
 `),
						(request, call) =>
							Effect.gen(function* () {
								if (request.id === "kernel:pages.delete" && !approved) {
									return yield* new AgentRunSuspended();
								}
								calls.push(`${request.id}@${call.key.split(":").at(-1)}`);
								return { id: request.id };
							}),
					),
					idempotencyKey: "suspended",
				};
				expect(yield* scripts.run(input)).toEqual({ state: "suspended" });
				expect(calls).toEqual(["kernel:pages.list@0"]);
				approved = true;
				const result = completed(yield* scripts.run(input));
				expect(result).toMatchObject({
					truncated: false,
					value: {
						error: null,
						value: { first: { id: "kernel:pages.list" }, second: { id: "kernel:pages.delete" } },
					},
				});
				expect(calls).toEqual(["kernel:pages.list@0", "kernel:pages.delete@1"]);
				expect(completed(yield* scripts.run(input))).toEqual(result);
				expect(calls).toHaveLength(2);
			}),
		testTimeout,
	);

	test.effect(
		"returns capability failures to the script and records compiler diagnostics and bounded outputs",
		() =>
			Effect.gen(function* () {
				const scripts = yield* AgentScriptService;
				const refused = completed(
					yield* scripts.run(
						options(
							source(
								'return yield* host.invokeCapability({ id: "kernel:pages.delete", input: {} }).pipe(Effect.catch((error) => Effect.succeed(error.message)));',
							),
							() => Effect.fail({ message: "The user declined this write" }),
						),
					),
				);
				expect(refused).toMatchObject({
					truncated: false,
					value: { error: null, value: "The user declined this write" },
				});
				const invalid = completed(
					yield* scripts.run(
						options(source('return "wrong";', "agent", "Schema.Number"), unexpected),
					),
				);
				expect(invalid).toMatchObject({
					truncated: false,
					value: {
						value: null,
						diagnostics: arrayContaining([objectContaining({ severity: "error" })]),
					},
				});
				const large = completed(
					yield* scripts.run(
						options(
							source(
								'for (let i = 0; i < 700; i += 1) { console.log("x".repeat(1000)); } return "y".repeat(100000);',
							),
							unexpected,
						),
					),
				);
				expect(new TextEncoder().encode(stableStringify(large)).length).toBeLessThanOrEqual(65_536);
				expect(large).toMatchObject({ truncated: true });
			}),
		testTimeout,
	);
});

const unavailableCompilerLayer = AgentScriptService.layer.pipe(
	Layer.provide(
		Layer.succeed(
			SandboxCompiler,
			SandboxCompiler.of({
				compile: () =>
					Effect.fail(new CompilerWorkerUnavailable({ message: "Compiler worker exited" })),
			}),
		),
	),
	Layer.provideMerge(AgentScriptRepository.layer),
	Layer.provideMerge(realSandboxLayer()),
	Layer.provide(BunCrypto.layerSecureRandom),
);

layer(unavailableCompilerLayer)((test) => {
	test.effect(
		"reports an unavailable compiler as retryable without completing the execution",
		() =>
			Effect.gen(function* () {
				const scripts = yield* AgentScriptService;
				const repository = yield* AgentScriptRepository;
				const input = { ...options(source("return null;"), unexpected), idempotencyKey: "offline" };

				expect(yield* scripts.run(input).pipe(Effect.flip)).toMatchObject({
					_tag: "SandboxRunError",
					kind: "resource-unavailable",
				});
				const stored = yield* repository.find(
					realSandboxUserId,
					`agent-${sha256Hex(stableStringify([realSandboxUserId, "offline"]))}`,
				);
				expect(stored).toMatchObject({ result: null, completedAt: null });
			}),
		testTimeout,
	);
});
