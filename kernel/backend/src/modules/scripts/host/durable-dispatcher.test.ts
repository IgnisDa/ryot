import { assert, expect, it } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { sandboxHostContracts } from "@ryot-app/plugin-backend-sdk/core";
import {
	SANDBOX_HOST_EXECUTION_POLICY,
	sandboxDurableHostDispatchStrategy,
} from "@ryot-app/sandbox/host/host-execution-policy";
import { Effect, Layer } from "effect";

import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";

import { makeUserPluginRevision, makeUserPrincipal } from "../authorization/principal.test-support";
import {
	prepareSandboxCreateEvents,
	prepareSandboxDurableHttpHop,
	prepareSandboxSendNotification,
	SandboxDurableHostServiceWorkflow,
} from "./durable-dispatcher";
import { SandboxSubmissionCommands } from "./submission-command";

const submissionCommands = (
	findPluginAvailableToUser?: PluginRuntimeResolver["Service"]["findPluginAvailableToUser"],
) =>
	Layer.build(
		Layer.mock(PluginRuntimeResolver)(
			findPluginAvailableToUser ? { findPluginAvailableToUser } : {},
		),
	).pipe(Effect.flatMap((context) => SandboxSubmissionCommands.make.pipe(Effect.provide(context))));

const availablePlugin = (installationId: string) => () =>
	Effect.succeed({
		id: "plugin",
		installationId,
		isHidden: false,
		clientImports: [],
		ownerUserId: null,
		compiledHashes: {},
		contentHash: "hash",
		scope: "user" as const,
		health: "ready" as const,
		manifest: fixtureManifest(),
		pluginConfigRevisionId: null,
		pluginRevisionId: "plugin-revision",
		packageId: makeUserPluginRevision({ ownerId: null, slug: "plugin", compiledHashes: {} })
			.packageId,
	});

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
		createUserEntity: { dispatch: "service-workflow" },
		invalidateOAuthAccessToken: { dispatch: "activity" },
		ensureUserEntities: { dispatch: "service-workflow" },
		sendNotification: { dispatch: "notification-workflow" },
		updateUserSettings: { dispatch: "activity", resultBytes: expect.any(Number) },
	});
	expect(SANDBOX_HOST_EXECUTION_POLICY.getProAvailability).toMatchObject({
		dispatch: "activity",
		resultBytes: expect.any(Number),
	});
	expect(SANDBOX_HOST_EXECUTION_POLICY.verifyManagedAssets).toMatchObject({
		dispatch: "activity",
		wireBytes: expect.any(Number),
		resultBytes: expect.any(Number),
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
			yield* submissionCommands(),
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

it.effect(
	"scopes stable event writes by authenticated account, installation, and script rather than attempt",
	() =>
		Effect.gen(function* () {
			const userId = UserId.make("submission-user");
			const request = {
				index: 2,
				name: "createEvents",
				kind: "host" as const,
				args: {
					capability: "createEvents" as const,
					args: [
						[
							{
								entityId: "metric",
								properties: { value: 0 },
								eventSchemaSlug: "reading",
								occurredAt: "2026-08-06T00:00:00Z",
							},
						],
						{ idempotencyKey: "submission", submittedAt: "2026-08-06T12:00:00Z" },
					],
				},
			};
			const scope = {
				context: {},
				executionId: "attempt-1",
				lane: "interactive" as const,
				startedAt: "2026-08-06T12:00:00Z",
				principal: makeUserPrincipal({
					metadata: { runtimeImports: [], capabilities: ["createEvents"] },
					subject: {
						userId,
						type: "user" as const,
						accountGeneration: { userId, token: "generation" },
					},
					pluginRevision: makeUserPluginRevision({
						slug: "plugin",
						ownerId: userId,
						compiledHashes: {},
					}),
				}),
			};
			const lookups: Array<readonly [string, string]> = [];
			const unavailable = yield* prepareSandboxCreateEvents(
				request,
				scope,
				yield* submissionCommands((lookupUserId, pluginId) => {
					lookups.push([lookupUserId, pluginId]);
					return Effect.succeed(null);
				}),
			).pipe(Effect.flip);
			expect(unavailable).toMatchObject({
				kind: "invalid-input",
				message: "Write installation is unavailable",
			});
			expect(lookups).toEqual([[userId, "plugin"]]);
			const installation = yield* submissionCommands(availablePlugin("installation"));
			const first = yield* prepareSandboxCreateEvents(request, scope, installation);
			const retried = yield* prepareSandboxCreateEvents(
				{ ...request, index: 9 },
				{ ...scope, executionId: "attempt-2", startedAt: "2026-08-07T00:00:00Z" },
				installation,
			);
			expect(retried.writeCommand).toEqual(first.writeCommand);
			expect(retried.command).not.toEqual(first.command);
			for (const changed of [
				{ scope, installationId: "other-installation" },
				{
					installationId: "installation",
					scope: { ...scope, principal: { ...scope.principal, scriptSlug: "other-operation" } },
				},
				{
					installationId: "installation",
					scope: {
						...scope,
						principal: {
							...scope.principal,
							subject: {
								...scope.principal.subject,
								accountGeneration: { userId, token: "other-generation" },
							},
						},
					},
				},
			]) {
				const other = yield* prepareSandboxCreateEvents(
					request,
					changed.scope,
					yield* submissionCommands(availablePlugin(changed.installationId)),
				);
				expect(other.writeCommand?.causation.executionId).not.toBe(
					first.writeCommand?.causation.executionId,
				);
			}
		}),
);

it.effect("prepares one normalized durable HTTP hop when options are null", () =>
	Effect.gen(function* () {
		const prepared = yield* prepareSandboxDurableHttpHop(
			{
				index: 0,
				kind: "host",
				name: "httpCall",
				args: { capability: "httpCall", args: [" get ", "https://PROVIDER.test:443/path", null] },
			},
			{
				context: {},
				lane: "interactive",
				executionId: "sandbox-parent",
				startedAt: "2026-08-06T00:00:00.000Z",
				principal: makeUserPrincipal({
					metadata: { runtimeImports: [], capabilities: ["httpCall"] },
				}),
			},
		);
		assert(prepared._tag === "prepared");
		expect(prepared.current).toEqual({
			hop: 0,
			method: "GET",
			url: "https://provider.test/path",
			headers: { "User-Agent": "Ryot ( https://github.com/ignisda/ryot )" },
		});
	}),
);

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
