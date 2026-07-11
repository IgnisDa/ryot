import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import {
	SignalId,
	SignalSchemaSlug,
	SubscriptionRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { dbRunnerLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { NotificationsRepository } from "#modules/notifications/repository";
import { NotificationsService } from "#modules/notifications/service";
import { SignalEmissionService, type EmitSignalInput } from "#modules/signals/service";

import { makeAutomationSandboxApiFunctions } from "./automation-host-functions";
import { selectSandboxHostFunctions } from "./service";
import type { SandboxRunInput } from "./shared";

const userId = UserId.make("user-1");
const occurredAt = "2026-07-20T10:00:00.000Z";
const runId = SubscriptionRunId.make("run-1");
const getEntity = () => Effect.succeed(null);
const emitSignal = () => Effect.succeed(null);
const sendNotification = () => Effect.succeed(null);

const runInput = {
	userId,
	context: {},
	metadata: {},
	compiledCode: "",
	compiledFormat: 1,
	scriptId: "script-1",
	scriptIsBuiltin: true,
	driverName: "automation",
	executionId: `${runId}-sandbox`,
	allowedHostFunctions: ["emitSignal", "sendNotification"],
	subscriptionRun: { id: runId, occurredAt, origin: { kind: "api" } },
} as const satisfies SandboxRunInput;

it.effect("derives signal authority and identity from the subscription run", () => {
	let captured: EmitSignalInput | undefined;
	const signals = Layer.mock(SignalEmissionService, {
		_tag: "SignalEmissionService",
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
					id: SignalId.make("signal-1"),
					properties: { message: "trace" },
					createdAt: "2026-07-20T10:00:01.000Z",
					occurredAt: input.occurredAt.toISOString(),
					signalSchemaSlug: SignalSchemaSlug.make("signal-schema-1"),
				},
			});
		},
	});
	const notifications = Layer.mock(NotificationsService, { _tag: "NotificationsService" });

	return Effect.gen(function* () {
		const host = yield* makeAutomationSandboxApiFunctions();
		const result = yield* host.emitSignal(runInput, {
			discriminator: "episode-1",
			schemaSlug: "review.created",
			properties: { message: "trace" },
		});

		expect(result).toEqual({
			signalId: "signal-1",
			wasCreated: true,
		});
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
	const deliveries: Parameters<WorkflowEngine["Type"]["execute"]>[1][] = [];
	const workflowEngine = makeWorkflowEngine({
		execute: (_workflow, options) => {
			deliveries.push(options);
			return Effect.succeed(options.executionId);
		},
	});
	const signals = Layer.mock(SignalEmissionService, { _tag: "SignalEmissionService" });
	const notificationsRepository = Layer.succeed(
		NotificationsRepository,
		Object.assign(Object.create(null), {}),
	);
	const notifications = NotificationsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				notificationsRepository,
				Layer.succeed(WorkflowEngine, workflowEngine),
			),
		),
	);

	return Effect.gen(function* () {
		const host = yield* makeAutomationSandboxApiFunctions();
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
	const signals = Layer.mock(SignalEmissionService, { _tag: "SignalEmissionService" });
	const notifications = Layer.mock(NotificationsService, { _tag: "NotificationsService" });

	return Effect.gen(function* () {
		const host = yield* makeAutomationSandboxApiFunctions();
		const error = yield* Effect.flip(
			host.sendNotification({ ...runInput, userId: null }, "Review posted for Dune"),
		);

		expect(error).toEqual({ message: "sendNotification is not available for system executions" });
	}).pipe(Effect.provide(Layer.mergeAll(signals, notifications)));
});

it("exposes automation capabilities only to trusted subscription runs", () => {
	const bound = { emitSignal, getEntity, sendNotification };
	const direct = selectSandboxHostFunctions(bound, {
		allowedHostFunctions: ["emitSignal", "getEntity", "sendNotification"],
	});
	const subscription = selectSandboxHostFunctions(bound, runInput);

	expect(direct).toEqual({ getEntity });
	expect(subscription).toEqual({ emitSignal, sendNotification });
});
