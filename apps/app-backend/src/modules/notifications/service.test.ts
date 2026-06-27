import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { dbRunnerLayer, makeWorkflowEngine } from "#lib/test-support/effect";

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

const makeServiceLayer = (workflowEngine: WorkflowEngine["Type"]) =>
	NotificationsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(dbRunnerLayer, repositoryLayer, Layer.succeed(WorkflowEngine, workflowEngine)),
		),
	);

it.effect("enqueues a fire-and-forget test delivery without delivering synchronously", () => {
	let capturedOptions: Parameters<WorkflowEngine["Type"]["execute"]>[1] | undefined;

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
		expect(typeof capturedOptions?.payload.executionId).toBe("string");
	}).pipe(Effect.provide(makeServiceLayer(workflowEngine)));
});
