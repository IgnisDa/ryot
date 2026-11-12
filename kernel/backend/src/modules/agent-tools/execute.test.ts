import { expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import { type Capability, CapabilityId } from "@ryot-app/contract/schema/capability";
import { assert } from "@ryot-app/testing/assert";
import { arrayContaining, objectContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";

import { AgentScriptRepository } from "#modules/scripts/agent/repository";
import {
	type AgentCapabilityCall,
	AgentRunSuspended,
	type AgentScriptRun,
	AgentScriptService,
} from "#modules/scripts/agent/service";
import {
	realSandboxLayer,
	realSandboxUserId,
} from "#modules/scripts/executions/real-sandbox.test-support";

import { executeSource, referencedCapabilities } from "./execute";

const capability = (id: string, readOnly: boolean, input: Capability["input"]): Capability => ({
	input,
	id: CapabilityId.make(id),
	source: { kind: "kernel" },
	description: `Capability ${id}`,
	hints: { readOnly, destructive: false, idempotent: readOnly },
	output: {
		type: "object",
		required: ["items"],
		properties: { items: { type: "array", items: { type: "string" } } },
	},
});
const capabilities = [
	capability("kernel:pages.list", true, { type: "object", properties: {} }),
	capability("testing/fixture:operations/write", false, {
		type: "object",
		required: ["value"],
		properties: { value: { type: "string" } },
	}),
];
const run = (code: string, invokeCapability: AgentCapabilityCall, idempotencyKey?: string) =>
	Effect.flatMap(AgentScriptService, (scripts) =>
		scripts.run({
			invokeCapability,
			accessClass: "standard",
			userId: realSandboxUserId,
			source: executeSource(code, referencedCapabilities(code, capabilities)),
			...(idempotencyKey === undefined ? {} : { idempotencyKey }),
		}),
	);
const completed = (outcome: AgentScriptRun) => {
	assert(outcome.state === "completed" && !outcome.result.truncated);
	return outcome.result.value;
};
const unexpected: AgentCapabilityCall = () => Effect.die("Unexpected capability call");

const agentLayer = AgentScriptService.layer.pipe(
	Layer.provideMerge(AgentScriptRepository.layer),
	Layer.provideMerge(realSandboxLayer({ perUserSidecars: true })),
	Layer.provide(BunCrypto.layerSecureRandom),
);

layer(agentLayer)((test) => {
	test.effect(
		"runs typed capability calls, surfaces refusals as errors and suspends until a write is approved",
		() =>
			Effect.gen(function* () {
				const code = `
const pages = await ryot.call("kernel:pages.list", {});
let refused = null;
try {
	await ryot.call("testing/fixture:operations/write", { value: "refused" });
} catch (error) {
	refused = error instanceof Error ? error.message : "not an error";
}
const written = await ryot.call("testing/fixture:operations/write", { value: "approved" });
return { pages: pages.items, refused, written: written.items };
`;
				let approved = false;
				const requests: unknown[] = [];
				const invoke: AgentCapabilityCall = (request, call) =>
					Effect.gen(function* () {
						if (request.id === "kernel:pages.list") {
							requests.push(call.index);
							return { items: ["page"] };
						}
						if (call.index === 1) {
							return yield* Effect.fail({ message: "The user declined this write" });
						}
						if (!approved) {
							return yield* new AgentRunSuspended();
						}
						requests.push(call.index);
						return { items: ["written"] };
					});
				expect(yield* run(code, invoke, "typed")).toEqual({ state: "suspended" });
				approved = true;
				expect(completed(yield* run(code, invoke, "typed"))).toMatchObject({
					error: null,
					value: { pages: ["page"], written: ["written"], refused: "The user declined this write" },
				});
				expect(requests).toEqual([0, 2]);
			}),
		testTimeout,
	);

	test.effect(
		"reports unknown capability IDs and invalid inputs as type errors before running",
		() =>
			Effect.gen(function* () {
				for (const code of [
					'return await ryot.call("kernel:missing", {});',
					'return await ryot.call("testing/fixture:operations/write", { value: 7 });',
				]) {
					expect(completed(yield* run(code, unexpected))).toMatchObject({
						value: null,
						diagnostics: arrayContaining([objectContaining({ line: 1, severity: "error" })]),
					});
				}
			}),
		testTimeout,
	);
});
