import { expect } from "bun:test";

import { PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Schema } from "effect";

import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { makeUserPluginRevision } from "#modules/scripts/authorization/principal.test-support";

import { SandboxExecutionQueue } from "./queues";
import { sandboxSchedulingKey } from "./scheduling-key";

const userPlugin = makeUserPluginRevision({
	slug: "plugin-1",
	ownerId: UserId.make("user-1"),
	compiledHashes: { script: "hash-1" },
});
const systemPlugin = {
	...userPlugin,
	ownerId: null,
	scope: "system",
	id: PluginId.make("system-plugin"),
};
const accountGeneration = { userId: UserId.make("user-1"), token: "test-account-generation" };
const userSubject = { type: "user", userId: "user-1", accountGeneration };
const automationSubject = (
	executionUserId: null | string,
	plugin: null | Pick<typeof userPlugin, "id" | "revisionId" | "configRevisionId">,
	delivery: "async" | "policy" | "required" = "async",
) => ({
	delivery,
	runId: "run-1",
	stage: "after",
	executionUserId,
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
	lane: "background" | "interactive",
	kernelScript?: true,
	progress: { readonly journalLength?: number; readonly recoveryAttempt?: number } = {},
) =>
	Effect.gen(function* () {
		const principal = yield* Schema.decodeUnknownEffect(ScriptExecutionPrincipal)({
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
			journalLength: progress.journalLength ?? 0,
			...(progress.recoveryAttempt === undefined
				? {}
				: { recoveryAttempt: progress.recoveryAttempt }),
			executionId: "execution-1",
			workflowExecutionId: "workflow-1",
			startedAt: "2026-01-01T00:00:00.000Z",
		});
		return { payload, token: "token", spanId: "span", sampled: false, traceId: "trace" };
	});

const keyOf = (...input: Parameters<typeof encodeQueueElement>) =>
	encodeQueueElement(...input).pipe(Effect.flatMap(sandboxSchedulingKey));

it.effect(
	"scheduling_identity_uses_execution_user_and_pinned_plugin",
	() =>
		Effect.gen(function* () {
			expect(yield* keyOf(userSubject, userPlugin, "interactive")).toEqual({
				urgency: "fresh",
				plugin: "plugin-1",
				lane: "interactive",
				tenant: "user:user-1",
			});
			expect(
				yield* keyOf(automationSubject("user-1", userPlugin), userPlugin, "background"),
			).toEqual({
				urgency: "fresh",
				lane: "background",
				plugin: "plugin-1",
				tenant: "user:user-1",
			});
			expect(
				yield* keyOf(automationSubject("user-1", systemPlugin), systemPlugin, "background"),
			).toEqual({
				urgency: "fresh",
				lane: "background",
				tenant: "user:user-1",
				plugin: "system-plugin",
			});
			expect(
				yield* keyOf(automationSubject(null, systemPlugin), systemPlugin, "background"),
			).toEqual({
				urgency: "fresh",
				tenant: "system",
				lane: "background",
				plugin: "system-plugin",
			});
			expect(yield* keyOf({ type: "system" }, systemPlugin, "background")).toEqual({
				urgency: "fresh",
				tenant: "system",
				lane: "background",
				plugin: "system-plugin",
			});
			expect(yield* keyOf(userSubject, null, "interactive")).toEqual({
				urgency: "fresh",
				plugin: "kernel",
				lane: "interactive",
				tenant: "user:user-1",
			});
			expect(yield* keyOf({ type: "system" }, null, "background", true)).toEqual({
				urgency: "fresh",
				tenant: "system",
				plugin: "kernel",
				lane: "background",
			});
		}),
	testTimeout,
);

const urgency = (...input: Parameters<typeof encodeQueueElement>) =>
	Effect.map(keyOf(...input), (key) => key.urgency);
const awaitedSubject = (delivery: "policy" | "required") =>
	automationSubject("user-1", userPlugin, delivery);

it.effect("awaited hooks schedule before continuing runs, and both before fresh runs", () =>
	Effect.gen(function* () {
		expect(yield* urgency(awaitedSubject("policy"), userPlugin, "background")).toBe("awaited");
		expect(
			yield* urgency(awaitedSubject("required"), userPlugin, "background", undefined, {
				journalLength: 2,
			}),
		).toBe("awaited");
		expect(
			yield* urgency(userSubject, userPlugin, "interactive", undefined, { journalLength: 1 }),
		).toBe("continuation");
		expect(
			yield* urgency(automationSubject("user-1", userPlugin), userPlugin, "background", undefined, {
				recoveryAttempt: 1,
			}),
		).toBe("continuation");
	}),
);
