import { it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";
import { expect } from "vitest";

import { SandboxExecutionPrincipal } from "#lib/infrastructure/sandbox-runtime/execution-principal";

import { SandboxExecutionQueue } from "./durable-queues";
import { sandboxSchedulingKey } from "./scheduling-key";

const userPlugin = {
	scope: "user",
	id: "plugin-1",
	slug: "plugin",
	ownerId: "user-1",
	workflowScripts: {},
	revisionId: "revision-1",
	configRevisionId: "config-1",
	userBootstrapScriptSlugs: [],
	compiledHashes: { script: "hash-1" },
	configSchema: { fields: {}, unknownKeys: "strict" },
	schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
};
const systemPlugin = { ...userPlugin, ownerId: null, scope: "system", id: "system-plugin" };
const accountGeneration = { userId: UserId.make("user-1"), token: "test-account-generation" };
const userSubject = { type: "user", userId: "user-1", accountGeneration };
const automationSubject = (
	executionUserId: string | null,
	plugin: Pick<typeof userPlugin, "id" | "revisionId" | "configRevisionId"> | null,
) => ({
	runId: "run-1",
	stage: "after",
	executionUserId,
	delivery: "required",
	type: "automation-run",
	triggerId: "trigger-1",
	pluginId: plugin?.id ?? null,
	pluginRevisionId: plugin?.revisionId ?? null,
	pluginConfigRevisionId: plugin?.configRevisionId ?? null,
	accountGeneration: executionUserId === null ? null : accountGeneration,
	causation: {
		depth: 0,
		source: "api",
		parentRunId: null,
		lane: "background",
		parentTriggerId: null,
		executionId: "execution-1",
		rootExecutionId: "execution-1",
		initiator: { id: null, kind: "system" },
	},
});

const encodeQueueElement = (
	subject: unknown,
	pluginRevision: unknown,
	lane: "interactive" | "background",
	kernelScript?: true,
) =>
	Effect.gen(function* () {
		const principal = yield* Schema.decodeUnknownEffect(SandboxExecutionPrincipal)({
			subject,
			pluginRevision,
			providerId: null,
			scriptId: "script-1",
			scriptSlug: "script",
			contentHash: "hash-1",
			metadata: { kind: "automation", runtimeImports: [] },
			...(kernelScript === undefined ? {} : { kernelScript }),
		});
		const payload = yield* Schema.encodeUnknownEffect(
			Schema.toCodecJson(SandboxExecutionQueue.payloadSchema),
		)({
			lane,
			principal,
			context: {},
			journalLength: 0,
			executionId: "execution-1",
			workflowExecutionId: "workflow-1",
			startedAt: "2026-01-01T00:00:00.000Z",
		});
		return { payload, token: "token", spanId: "span", sampled: false, traceId: "trace" };
	});

const keyOf = (...input: Parameters<typeof encodeQueueElement>) =>
	encodeQueueElement(...input).pipe(Effect.flatMap(sandboxSchedulingKey));

it.effect("scheduling_identity_uses_execution_user_and_pinned_plugin", () =>
	Effect.gen(function* () {
		expect(yield* keyOf(userSubject, userPlugin, "interactive")).toEqual({
			plugin: "plugin-1",
			lane: "interactive",
			tenant: "user:user-1",
		});
		expect(yield* keyOf(automationSubject("user-1", userPlugin), userPlugin, "background")).toEqual(
			{ lane: "background", plugin: "plugin-1", tenant: "user:user-1" },
		);
		expect(
			yield* keyOf(automationSubject("user-1", systemPlugin), systemPlugin, "background"),
		).toEqual({ lane: "background", tenant: "user:user-1", plugin: "system-plugin" });
		expect(yield* keyOf(automationSubject(null, systemPlugin), systemPlugin, "background")).toEqual(
			{ tenant: "system", lane: "background", plugin: "system-plugin" },
		);
		expect(yield* keyOf({ type: "system" }, systemPlugin, "background")).toEqual({
			tenant: "system",
			lane: "background",
			plugin: "system-plugin",
		});
		expect(yield* keyOf(userSubject, null, "interactive")).toEqual({
			plugin: "kernel",
			lane: "interactive",
			tenant: "user:user-1",
		});
		expect(yield* keyOf({ type: "system" }, null, "background", true)).toEqual({
			tenant: "system",
			plugin: "kernel",
			lane: "background",
		});
	}),
);
