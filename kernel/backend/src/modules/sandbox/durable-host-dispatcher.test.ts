import { expect, it } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { sandboxHostContracts } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "effect";

import {
	SANDBOX_HOST_EXECUTION_POLICY,
	sandboxDurableHostDispatchStrategy,
} from "#lib/infrastructure/sandbox-runtime/host-execution-policy";

import {
	sandboxDurableHttpRequestUrl,
	prepareSandboxCreateEvents,
	prepareSandboxSendNotification,
	SandboxDurableHostServiceWorkflow,
} from "./durable-host-dispatcher";

it("classifies every bridge host capability exactly once", () => {
	expect(Object.keys(SANDBOX_HOST_EXECUTION_POLICY).sort()).toEqual(
		Object.keys(sandboxHostContracts).sort(),
	);
	expect(SANDBOX_HOST_EXECUTION_POLICY).toMatchObject({
		log: { dispatch: "diagnostic" },
		span: { dispatch: "diagnostic" },
		getUserSettings: { dispatch: "activity" },
		createEvents: { dispatch: "event-workflow" },
		emitSignal: { dispatch: "service-workflow" },
		deleteEvents: { dispatch: "lifecycle-workflow" },
		updateEvents: { dispatch: "lifecycle-workflow" },
		invalidateOAuthAccessToken: { dispatch: "activity" },
		ensureUserEntities: { dispatch: "service-workflow" },
		sendNotification: { dispatch: "notification-workflow" },
	});
	expect(sandboxDurableHostDispatchStrategy("scratch")).toBeNull();
});

it.effect("applies centralized capability authorization before durable host dispatch", () =>
	Effect.gen(function* () {
		const error = yield* prepareSandboxSendNotification(
			{
				index: 0,
				kind: "host",
				name: "sendNotification",
				args: { args: ["Ready"], capability: "sendNotification" },
			},
			{
				context: {},
				lane: "interactive",
				executionId: "sandbox-parent",
				startedAt: "2026-08-06T00:00:00.000Z",
				principal: {
					providerId: null,
					contentHash: "hash",
					pluginRevision: null,
					scriptSlug: "script",
					scriptId: SandboxScriptId.make("script-1"),
					metadata: { runtimeImports: [], capabilities: ["sendNotification"] },
					subject: {
						type: "user",
						userId: UserId.make("user-1"),
						accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
					},
				},
			},
		).pipe(Effect.flip);
		expect(error.message).toBe(
			"Sandbox durable host denied: sendNotification is available only to user automation runs",
		);
	}),
);

it.effect("derives event root identity from the trusted workflow and host index", () =>
	Effect.gen(function* () {
		const prepared = yield* prepareSandboxCreateEvents(
			{
				index: 3,
				kind: "host",
				name: "createEvents",
				args: { args: [[]], capability: "createEvents" },
			},
			{
				context: {},
				lane: "interactive",
				executionId: "sandbox-parent",
				startedAt: "2026-08-06T00:00:00.000Z",
				principal: {
					providerId: null,
					contentHash: "hash",
					pluginRevision: null,
					scriptSlug: "script",
					scriptId: SandboxScriptId.make("script-1"),
					metadata: { runtimeImports: [], capabilities: ["createEvents"] },
					subject: {
						type: "user",
						userId: UserId.make("user-1"),
						accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
					},
				},
			},
		);
		expect(prepared).toMatchObject({
			payload: [],
			userId: "user-1",
			command: {
				itemIdentity: "createEvents",
				occurredAt: "2026-08-06T00:00:00.000Z",
				causation: {
					depth: 0,
					source: "api",
					executionId: "sandbox-parent-host-3",
					rootExecutionId: "sandbox-parent-host-3",
					initiator: { kind: "user", id: "user-1" },
				},
			},
		});
	}),
);

it("extracts the durable HTTP request URL when options are null", () => {
	expect(
		sandboxDurableHttpRequestUrl({
			index: 0,
			kind: "host",
			name: "httpCall",
			args: { capability: "httpCall", args: ["GET", "https://provider.test/path", null] },
		}),
	).toBe("https://provider.test/path");
});

it("derives service workflow identity from the parent and call index", () => {
	const request = {
		index: 3,
		name: "emitSignal",
		kind: "host" as const,
		args: { args: [], capability: "emitSignal" as const },
	};
	expect(
		SandboxDurableHostServiceWorkflow.idempotencyKey({
			request,
			parentExecutionId: "sandbox-parent",
			startedAt: "2026-08-06T00:00:00.000Z",
			sandbox: {
				input: {},
				lane: "interactive",
				resolutionMode: "exact",
				subject: { type: "system" },
				executionId: "sandbox-parent",
				scriptId: SandboxScriptId.make("script-1"),
			},
			principal: {
				providerId: null,
				contentHash: "hash",
				pluginRevision: null,
				scriptSlug: "script",
				subject: { type: "system" },
				metadata: { runtimeImports: [] },
				scriptId: SandboxScriptId.make("script-1"),
			},
		}),
	).toBe("sandbox-parent-host-service-3");
});
