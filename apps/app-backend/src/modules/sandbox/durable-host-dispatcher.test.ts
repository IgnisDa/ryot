import { expect, it } from "@effect/vitest";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { sandboxHostContracts } from "@ryot/sandbox-sdk/core";

import {
	SANDBOX_DURABLE_HOST_DISPATCH,
	sandboxDurableHostDispatchStrategy,
	SandboxDurableHostServiceWorkflow,
} from "./durable-host-dispatcher";

it("classifies every bridge host capability exactly once", () => {
	expect(Object.keys(SANDBOX_DURABLE_HOST_DISPATCH).sort()).toEqual(
		Object.keys(sandboxHostContracts).sort(),
	);
	expect(SANDBOX_DURABLE_HOST_DISPATCH).toMatchObject({
		log: "diagnostic",
		span: "diagnostic",
		createEvents: "event-workflow",
		emitSignal: "service-workflow",
		ensureUserEntities: "service-workflow",
		sendNotification: "notification-workflow",
	});
	expect(sandboxDurableHostDispatchStrategy("scratch")).toBeNull();
});

it("derives service workflow identity from the parent and call index", () => {
	const request = {
		index: 3,
		name: "emitSignal",
		kind: "host" as const,
		args: { capability: "emitSignal" as const, args: [] },
	};
	expect(
		SandboxDurableHostServiceWorkflow.idempotencyKey({
			request,
			startedAt: "2026-08-06T00:00:00.000Z",
			parentExecutionId: "sandbox-parent",
			sandbox: {
				input: {},
				resolutionMode: "exact",
				authority: { type: "system" },
				executionId: "sandbox-parent",
				scriptId: SandboxScriptId.make("script-1"),
			},
		}),
	).toBe("sandbox-parent-host-service-3");
});
