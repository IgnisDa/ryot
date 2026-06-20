import { describe, expect, it } from "bun:test";

import {
	countAutomationEffectsByKey,
	createAuthenticatedClient,
	createSandboxScript,
	enqueueSandboxScript,
	pollSandboxResult,
} from "../fixtures";
import type { ContractPayload } from "../fixtures/contract-client";
import { assertCompleted, assertTaggedError } from "../test-support/assertions";

const mainDriver = (body: string) => `driver("main", async function() {\n\t${body}\n});`;

type EnqueueBody = ContractPayload<"sandbox", "enqueue">;

describe("sandbox capability discipline", () => {
	it("allows scripts to allowlist signal-emitting host functions (inert outside subscriptions)", async () => {
		const { client } = await createAuthenticatedClient();

		const scripts = await Promise.all(
			["emitSignal", "sendNotification"].map((hostFunction) =>
				createSandboxScript(client, {
					code: mainDriver("return {};"),
					name: `capability-${hostFunction}`,
					metadata: { allowedHostFunctions: [hostFunction] },
					slug: `capability-${hostFunction}-${crypto.randomUUID()}`,
				}),
			),
		);
		for (const script of scripts) {
			expect(script.id).toBeTruthy();
		}
	});

	it("rejects scripts requesting unknown host functions", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.sandbox.createScript({
				payload: {
					name: "capability-unknown",
					code: mainDriver("return {};"),
					metadata: { allowedHostFunctions: ["totallyMadeUp"] },
					slug: `capability-unknown-${crypto.randomUUID()}`,
				},
			}),
		);
		assertTaggedError(error, "BadRequest");
	});

	for (const testCase of [
		{
			name: "emitSignal",
			effectPrefix: "emit",
			call: (effectKey: string) =>
				`emitSignal({ signalSchemaId: "x", effectKey: ${JSON.stringify(effectKey)}, properties: {} })`,
		},
		{
			name: "sendNotification",
			effectPrefix: "notify",
			call: (effectKey: string) =>
				`sendNotification({ message: "hi", effectKey: ${JSON.stringify(effectKey)} })`,
		},
	]) {
		it(`cannot call ${testCase.name} from a direct run or record an effect`, async () => {
			const { client } = await createAuthenticatedClient();
			const effectKey = `${testCase.effectPrefix}-${crypto.randomUUID()}`;
			const { id: scriptId } = await createSandboxScript(client, {
				metadata: {},
				name: `direct-${testCase.name}`,
				slug: `direct-${testCase.name}-${crypto.randomUUID()}`,
				code: mainDriver(`return await ${testCase.call(effectKey)};`),
			});

			const { jobId } = await enqueueSandboxScript(client, { scriptId, driverName: "main" });
			const result = await pollSandboxResult(client, jobId);

			assertCompleted(result, `direct ${testCase.name} job`);
			expect(result.error).toContain(`${testCase.name} is not defined`);
			expect(await countAutomationEffectsByKey(effectKey)).toBe(0);
		});
	}

	it("ignores an execution-kind override in the enqueue payload", async () => {
		const { client } = await createAuthenticatedClient();
		const effectKey = `override-${crypto.randomUUID()}`;
		const { id: scriptId } = await createSandboxScript(client, {
			metadata: {},
			name: "direct-kind-override",
			slug: `direct-kind-override-${crypto.randomUUID()}`,
			code: mainDriver(
				`return await emitSignal({ signalSchemaId: "x", effectKey: ${JSON.stringify(effectKey)}, properties: {} });`,
			),
		});

		const payload: EnqueueBody & { executionKind: string } = {
			scriptId,
			driverName: "main",
			executionKind: "subscription",
		};
		const { jobId } = await enqueueSandboxScript(client, payload);
		const result = await pollSandboxResult(client, jobId);

		assertCompleted(result, "override enqueue job");
		expect(result.error).toContain("emitSignal is not defined");
		expect(await countAutomationEffectsByKey(effectKey)).toBe(0);
	});
});
