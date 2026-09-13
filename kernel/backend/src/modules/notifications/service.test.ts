import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref, Schema } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { databaseLayer, makeWorkflowEngine } from "#lib/test-utils/effect";

import { NotificationDeliveryWorkflowPayload } from "./notification-delivery-workflow";
import { NotificationsRepository } from "./repository";
import { NotificationsService } from "./service";

const user = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { language: null, disableIntegrations: false },
	accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
} satisfies CurrentUserValue;

const repositoryLayer = Layer.succeed(
	NotificationsRepository,
	Object.assign(Object.create(null), {}),
);

type ExecuteOptions = Parameters<WorkflowEngine["Service"]["execute"]>[1];

class RecordedWorkflowExecutions extends Context.Service<
	RecordedWorkflowExecutions,
	{ readonly options: Effect.Effect<ReadonlyArray<ExecuteOptions>> }
>()("test/RecordedWorkflowExecutions") {}

const recordingWorkflowEngineLayer = Layer.effectContext(
	Effect.gen(function* () {
		const options = yield* Ref.make<ReadonlyArray<ExecuteOptions>>([]);
		return Context.make(
			WorkflowEngine,
			makeWorkflowEngine({
				execute: (_workflow, executeOptions) =>
					Ref.update(options, (all) => [...all, executeOptions]).pipe(
						Effect.as(executeOptions.executionId),
					),
			}),
		).pipe(Context.add(RecordedWorkflowExecutions, { options: Ref.get(options) }));
	}),
);

const serviceLayer = NotificationsService.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(databaseLayer, repositoryLayer, recordingWorkflowEngineLayer)),
);

const lastExecuteOptions = Effect.gen(function* () {
	return (yield* (yield* RecordedWorkflowExecutions).options).at(-1);
});

layer(serviceLayer)((test) => {
	test.effect("enqueues a fire-and-forget test delivery without delivering synchronously", () =>
		Effect.gen(function* () {
			const service = yield* NotificationsService;
			yield* service.test(user);

			const capturedOptions = yield* lastExecuteOptions;
			expect(capturedOptions).toMatchObject({
				discard: true,
				payload: { userId: user.id, request: { kind: "test" } },
			});
			expect(
				Schema.is(NotificationDeliveryWorkflowPayload)(capturedOptions?.payload) &&
					typeof capturedOptions.payload.executionId,
			).toBe("string");
		}),
	);
});

layer(serviceLayer)((test) => {
	test.effect("enqueues a message delivery with a caller-supplied execution ID", () =>
		Effect.gen(function* () {
			const service = yield* NotificationsService;
			yield* service.sendMessage({
				userId: user.id,
				message: "Subscription run completed",
				executionId: "subscription-run-1-notification",
			});

			expect(yield* lastExecuteOptions).toMatchObject({
				discard: true,
				payload: {
					userId: user.id,
					executionId: "subscription-run-1-notification",
					request: { kind: "message", message: "Subscription run completed" },
				},
			});
		}),
	);
});
