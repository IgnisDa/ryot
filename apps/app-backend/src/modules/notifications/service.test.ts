import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { dbRunnerLayer, makeWorkflowEngine } from "#lib/test-utils/effect";

import { NotificationDeliveryWorkflowPayload } from "./notification-delivery-workflow";
import { NotificationsRepository } from "./repository";
import { NotificationsService } from "./service";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const repositoryLayer = Layer.succeed(
	NotificationsRepository,
	Object.assign(Object.create(null), {}),
);

const makeServiceLayer = (workflowEngine: WorkflowEngine["Service"]) =>
	NotificationsService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(dbRunnerLayer, repositoryLayer, Layer.succeed(WorkflowEngine, workflowEngine)),
		),
	);

it.effect("enqueues a fire-and-forget test delivery without delivering synchronously", () => {
	let capturedOptions: Parameters<WorkflowEngine["Service"]["execute"]>[1] | undefined;

	const workflowEngine = makeWorkflowEngine({
		execute: (_workflow, options) => {
			capturedOptions = options;
			return Effect.succeed(options.executionId);
		},
	});

	return Effect.gen(function* () {
		const service = yield* NotificationsService;
		yield* service.test(user);

		expect(capturedOptions).toMatchObject({
			discard: true,
			payload: { userId: user.id, request: { kind: "test" } },
		});
		expect(
			Schema.is(NotificationDeliveryWorkflowPayload)(capturedOptions?.payload) &&
				typeof capturedOptions.payload.executionId,
		).toBe("string");
	}).pipe(Effect.provide(makeServiceLayer(workflowEngine)));
});

it.effect("enqueues a message delivery with a caller-supplied execution ID", () => {
	let capturedOptions: Parameters<WorkflowEngine["Service"]["execute"]>[1] | undefined;

	const workflowEngine = makeWorkflowEngine({
		execute: (_workflow, options) => {
			capturedOptions = options;
			return Effect.succeed(options.executionId);
		},
	});

	return Effect.gen(function* () {
		const service = yield* NotificationsService;
		yield* service.sendMessage({
			userId: user.id,
			message: "Subscription run completed",
			executionId: "subscription-run-1-notification",
		});

		expect(capturedOptions).toMatchObject({
			discard: true,
			payload: {
				userId: user.id,
				executionId: "subscription-run-1-notification",
				request: { kind: "message", message: "Subscription run completed" },
			},
		});
	}).pipe(Effect.provide(makeServiceLayer(workflowEngine)));
});
