import { expect, it } from "@effect/vitest";
import {
	SignalId,
	SignalSchemaSlug,
	SubscriptionRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { selectSandboxHostFunctions } from "#lib/infrastructure/sandbox-runtime/service";
import type { SandboxRunInput } from "#lib/infrastructure/sandbox-runtime/shared";
import { dbRunnerLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { NotificationsRepository } from "#modules/notifications/repository";
import { NotificationsService } from "#modules/notifications/service";
import { SignalEmissionService, type EmitSignalInput } from "#modules/signals/service";

import { makeAutomationSandboxApiFunctions } from "./automation-sandbox-host-functions";

const userId = UserId.make("user-1");
const occurredAt = "2026-07-20T10:00:00.000Z";
const upsertGlobalEntities = () => Effect.void;
const runId = SubscriptionRunId.make("run-1");
const emitSignal = () => Effect.succeed(null);
const sendNotification = () => Effect.succeed(null);
const executeQueryEngine = () => Effect.succeed(null);
const changeUserRelationships = () => Effect.succeed([]);
const ensureUserEntities = () => Effect.succeed([]);
const getUserPreferences = () => Effect.succeed(null);

const runInput = {
	context: {},
	metadata: {},
	contentHash: "",
	providerId: null,
	compiledCode: "",
	compiledFormat: 1,
	scriptId: "script-1",
	executionId: `${runId}-sandbox`,
	allowedHostFunctions: ["emitSignal", "sendNotification"],
	authority: {
		userId,
		type: "subscription",
		subscriptionRun: { id: runId, occurredAt, origin: { kind: "api" } },
	},
} as const satisfies SandboxRunInput;

it.effect("derives signal authority and identity from the subscription run", () => {
	let captured: EmitSignalInput | undefined;
	const signals = Layer.mock(SignalEmissionService, {
		emit: (input) => {
			captured = input;
			return Effect.succeed({
				wasCreated: true,
				recipientUserIds: [userId],
				signal: {
					actorUserId: userId,
					origin: input.origin,
					subjectEntityId: null,
					schemaSlug: input.schemaSlug,
					properties: { message: "trace" },
					id: SignalId.make("signal-1"),
					createdAt: "2026-07-20T10:00:01.000Z",
					occurredAt: input.occurredAt.toISOString(),
					signalSchemaSlug: SignalSchemaSlug.make("signal-schema-1"),
				},
			});
		},
	});
	const notifications = Layer.mock(NotificationsService, {});

	return Effect.gen(function* () {
		const host = yield* makeAutomationSandboxApiFunctions;
		const result = yield* host.emitSignal(runInput, {
			discriminator: "episode-1",
			schemaSlug: "review.created",
			properties: { message: "trace" },
		});

		expect(result).toEqual({ wasCreated: true, signalId: "signal-1" });
		expect(captured).toMatchObject({
			executionId: runId,
			origin: { kind: "api" },
			discriminator: "episode-1",
			schemaSlug: "review.created",
			properties: { message: "trace" },
			principal: { kind: "user", userId },
		});
		expect(captured?.occurredAt.toISOString()).toBe(occurredAt);
	}).pipe(Effect.provide(Layer.mergeAll(signals, notifications)));
});

it.effect("uses one run-derived message delivery identity across replay", () => {
	const deliveries: Parameters<WorkflowEngine["Service"]["execute"]>[1][] = [];
	const workflowEngine = makeWorkflowEngine({
		execute: (_workflow, options) => {
			deliveries.push(options);
			return Effect.succeed(options.executionId);
		},
	});
	const signals = Layer.mock(SignalEmissionService, {});
	const notificationsRepository = Layer.succeed(
		NotificationsRepository,
		Object.assign(Object.create(null), {}),
	);
	const notifications = NotificationsService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				notificationsRepository,
				Layer.succeed(WorkflowEngine, workflowEngine),
			),
		),
	);

	return Effect.gen(function* () {
		const host = yield* makeAutomationSandboxApiFunctions;
		const runNotifier = () => host.sendNotification(runInput, "Review posted for Dune");
		expect(yield* runNotifier()).toBeNull();
		expect(yield* runNotifier()).toBeNull();
		expect(deliveries).toHaveLength(2);
		for (const delivery of deliveries) {
			expect(delivery).toMatchObject({
				discard: true,
				payload: {
					userId,
					executionId: "run-1-notification",
					request: { kind: "message", message: "Review posted for Dune" },
				},
			});
		}
	}).pipe(Effect.provide(Layer.mergeAll(signals, notifications)));
});

it.effect("returns context failures through the Effect error channel", () => {
	const signals = Layer.mock(SignalEmissionService, {});
	const notifications = Layer.mock(NotificationsService, {});

	return Effect.gen(function* () {
		const host = yield* makeAutomationSandboxApiFunctions;
		const error = yield* Effect.flip(
			host.sendNotification(
				{ ...runInput, authority: { type: "system" } },
				"Review posted for Dune",
			),
		);

		expect(error).toEqual({
			message: "sendNotification is available only to subscription executions",
		});
	}).pipe(Effect.provide(Layer.mergeAll(signals, notifications)));
});

it("exposes automation capabilities only to trusted automation executions", () => {
	const bound = { emitSignal, executeQueryEngine, sendNotification };
	const direct = selectSandboxHostFunctions(bound, {
		metadata: { kind: "script" },
		authority: { type: "user", userId },
		allowedHostFunctions: ["emitSignal", "executeQueryEngine", "sendNotification"],
	});
	const subscription = selectSandboxHostFunctions(bound, runInput);
	const system = selectSandboxHostFunctions(bound, {
		authority: { type: "system" },
		metadata: { kind: "automation" },
		allowedHostFunctions: ["emitSignal", "executeQueryEngine", "sendNotification"],
	});

	expect(direct).toEqual({ executeQueryEngine });
	expect(system).toEqual({ emitSignal });
	expect(subscription).toEqual({ emitSignal, sendNotification });
});

it("exposes global writes only to system runs with explicit capabilities", () => {
	const bound = { executeQueryEngine, upsertGlobalEntities };
	const user = selectSandboxHostFunctions(bound, {
		metadata: { kind: "script" },
		authority: { type: "user", userId },
		allowedHostFunctions: ["executeQueryEngine", "upsertGlobalEntities"],
	});
	const subscription = selectSandboxHostFunctions(bound, {
		authority: runInput.authority,
		metadata: { kind: "automation" },
		allowedHostFunctions: ["upsertGlobalEntities"],
	});
	const system = selectSandboxHostFunctions(bound, {
		metadata: { kind: "script" },
		authority: { type: "system" },
		allowedHostFunctions: ["upsertGlobalEntities"],
	});
	const providerSystem = selectSandboxHostFunctions(bound, {
		authority: { type: "system" },
		metadata: { kind: "provider" },
		allowedHostFunctions: ["upsertGlobalEntities"],
	});

	expect(user).toEqual({ executeQueryEngine });
	expect(subscription).toEqual({});
	expect(system).toEqual({ upsertGlobalEntities });
	expect(providerSystem).toEqual({});
});

it("filters user-context and user-only capabilities by authority", () => {
	const bound = { ensureUserEntities, executeQueryEngine, getUserPreferences };
	const user = selectSandboxHostFunctions(bound, {
		metadata: { kind: "operation" },
		authority: { type: "user", userId },
		allowedHostFunctions: ["ensureUserEntities", "executeQueryEngine", "getUserPreferences"],
	});
	const subscription = selectSandboxHostFunctions(bound, {
		metadata: { kind: "automation" },
		authority: runInput.authority,
		allowedHostFunctions: ["ensureUserEntities", "executeQueryEngine", "getUserPreferences"],
	});
	const system = selectSandboxHostFunctions(bound, {
		metadata: { kind: "script" },
		authority: { type: "system" },
		allowedHostFunctions: ["ensureUserEntities", "executeQueryEngine", "getUserPreferences"],
	});

	expect(user).toEqual({ ensureUserEntities, executeQueryEngine, getUserPreferences });
	expect(subscription).toEqual({ executeQueryEngine, getUserPreferences });
	expect(system).toEqual({ executeQueryEngine });
});

it("exposes declared user relationship changes only to user-bound authority", () => {
	const bound = { changeUserRelationships };
	const user = selectSandboxHostFunctions(bound, {
		metadata: { kind: "operation" },
		authority: { type: "user", userId },
		allowedHostFunctions: ["changeUserRelationships"],
	});
	const subscription = selectSandboxHostFunctions(bound, {
		authority: runInput.authority,
		metadata: { kind: "automation" },
		allowedHostFunctions: ["changeUserRelationships"],
	});
	const undeclared = selectSandboxHostFunctions(bound, {
		allowedHostFunctions: [],
		authority: runInput.authority,
		metadata: { kind: "automation" },
	});
	const system = selectSandboxHostFunctions(bound, {
		metadata: { kind: "script" },
		authority: { type: "system" },
		allowedHostFunctions: ["changeUserRelationships"],
	});

	expect(user).toEqual({ changeUserRelationships });
	expect(subscription).toEqual({ changeUserRelationships });
	expect(undeclared).toEqual({});
	expect(system).toEqual({});
});
