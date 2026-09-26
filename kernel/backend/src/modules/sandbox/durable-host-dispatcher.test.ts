import { expect, it } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { sandboxHostContracts } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "effect";

import {
	SANDBOX_DURABLE_HOST_DISPATCH,
	sandboxDurableHttpRequestUrl,
	sandboxDurableHostDispatchStrategy,
	prepareSandboxCreateEvents,
	prepareSandboxSendNotification,
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
				input: {},
				resolutionMode: "exact",
				executionId: "sandbox-parent",
				scriptId: SandboxScriptId.make("script-1"),
				subject: { type: "user", userId: UserId.make("user-1") },
			},
			{
				providerId: null,
				contentHash: "hash",
				pluginRevision: null,
				scriptSlug: "script",
				scriptId: SandboxScriptId.make("script-1"),
				metadata: { capabilities: ["sendNotification"] },
				subject: { type: "user", userId: UserId.make("user-1") },
			},
			"sandbox-parent",
			"2026-08-06T00:00:00.000Z",
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
				input: {},
				resolutionMode: "exact",
				executionId: "sandbox-parent",
				scriptId: SandboxScriptId.make("script-1"),
				subject: { type: "user", userId: UserId.make("user-1") },
			},
			{
				providerId: null,
				contentHash: "hash",
				pluginRevision: null,
				scriptSlug: "script",
				scriptId: SandboxScriptId.make("script-1"),
				metadata: { capabilities: ["createEvents"] },
				subject: { type: "user", userId: UserId.make("user-1") },
			},
			"sandbox-parent",
			"2026-08-06T00:00:00.000Z",
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

it("extracts only schema-valid durable HTTP request URLs", () => {
	expect(
		sandboxDurableHttpRequestUrl({
			index: 0,
			kind: "host",
			name: "httpCall",
			args: { capability: "httpCall", args: ["GET", "https://sensitive.test/path"] },
		}),
	).toBe("https://sensitive.test/path");
	expect(
		sandboxDurableHttpRequestUrl({
			index: 0,
			kind: "host",
			name: "httpCall",
			args: { args: ["GET"], capability: "httpCall" },
		}),
	).toBeNull();
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
				resolutionMode: "exact",
				subject: { type: "system" },
				executionId: "sandbox-parent",
				scriptId: SandboxScriptId.make("script-1"),
			},
			principal: {
				metadata: {},
				providerId: null,
				contentHash: "hash",
				pluginRevision: null,
				scriptSlug: "script",
				subject: { type: "system" },
				scriptId: SandboxScriptId.make("script-1"),
			},
		}),
	).toBe("sandbox-parent-host-service-3");
});
