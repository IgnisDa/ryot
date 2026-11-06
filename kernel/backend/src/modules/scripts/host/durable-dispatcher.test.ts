import { expect } from "bun:test";

import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { sandboxHostContracts } from "@ryot-app/plugin-backend-sdk/core";
import {
	SANDBOX_HOST_EXECUTION_POLICY,
	sandboxDurableHostDispatchStrategy,
} from "@ryot-app/sandbox/host/host-execution-policy";
import { assert } from "@ryot-app/testing/assert";
import { anyOf, objectContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { makeUserPrincipal } from "../authorization/principal.test-support";
import {
	prepareSandboxCreateEvents,
	prepareSandboxDurableHttpHop,
	prepareSandboxSendNotification,
} from "./durable-dispatcher";

it("classifies every bridge host capability exactly once", () => {
	expect(Object.keys(SANDBOX_HOST_EXECUTION_POLICY).sort()).toEqual(
		Object.keys(sandboxHostContracts).sort(),
	);
	expect(SANDBOX_HOST_EXECUTION_POLICY).toEqual<unknown>(
		objectContaining({
			log: objectContaining({ dispatch: "diagnostic" }),
			span: objectContaining({ dispatch: "diagnostic" }),
			emitSignal: objectContaining({ dispatch: "service" }),
			createEvents: objectContaining({ dispatch: "events" }),
			requestFolds: objectContaining({ dispatch: "service" }),
			deleteEvents: objectContaining({ dispatch: "lifecycle" }),
			updateEvents: objectContaining({ dispatch: "lifecycle" }),
			getUserSettings: objectContaining({ dispatch: "activity" }),
			createUserEntity: objectContaining({ dispatch: "service" }),
			ensureUserEntities: objectContaining({ dispatch: "service" }),
			sendNotification: objectContaining({ dispatch: "notification" }),
			requestFoldsForAllUsers: objectContaining({ dispatch: "service" }),
			invalidateOAuthAccessToken: objectContaining({ dispatch: "activity" }),
			updateUserSettings: objectContaining({ dispatch: "activity", resultBytes: anyOf(Number) }),
		}),
	);
	expect(SANDBOX_HOST_EXECUTION_POLICY.getProAvailability).toEqual<unknown>(
		objectContaining({ dispatch: "activity", resultBytes: anyOf(Number) }),
	);
	expect(SANDBOX_HOST_EXECUTION_POLICY.verifyManagedAssets).toEqual<unknown>(
		objectContaining({
			dispatch: "activity",
			wireBytes: anyOf(Number),
			resultBytes: anyOf(Number),
		}),
	);
	expect(sandboxDurableHostDispatchStrategy("scratch")).toBeNull();
});

it.effect(
	"applies centralized capability authorization before durable host dispatch",
	() =>
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
							accountGeneration: {
								userId: UserId.make("user-1"),
								token: "test-account-generation",
							},
						},
					},
				},
			).pipe(Effect.flip);
			expect(error.message).toBe(
				"Sandbox durable host denied: sendNotification is available only to user automation runs",
			);
		}),
	testTimeout,
);

it.effect(
	"derives event root identity from the trusted workflow and host index",
	() =>
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
							accountGeneration: {
								userId: UserId.make("user-1"),
								token: "test-account-generation",
							},
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
	testTimeout,
);

it.effect(
	"prepares one normalized durable HTTP hop when options are null",
	() =>
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
	testTimeout,
);
