import { expect } from "bun:test";

import { internalError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Fiber, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { makeWorkflowActivityEngine } from "#testing/effect";

import {
	runUserBootstrapWorkflow,
	UserBootstrapWorkflow,
	UserBootstrapWorkflowOperations,
} from "./workflow";

const userId = UserId.make("user-1");
const executionId = "user-bootstrap-6-user-1";

class RecordedBootstrapWorkflow extends Context.Service<
	RecordedBootstrapWorkflow,
	{
		readonly attempts: Effect.Effect<number>;
		readonly dispatched: Effect.Effect<ReadonlyArray<ReadonlyArray<unknown>>>;
	}
>()(
	"@ryot-app/kernel-backend/modules/accounts/provisioning/workflow.test/RecordedBootstrapWorkflow",
) {}

const retryingWorkflowLayer = Layer.unwrap(
	Effect.gen(function* () {
		const attempts = yield* Ref.make(0);
		const dispatched = yield* Ref.make<ReadonlyArray<ReadonlyArray<unknown>>>([]);
		const instance = WorkflowInstance.initial(UserBootstrapWorkflow, executionId);
		const engine = makeWorkflowActivityEngine(instance);
		return Layer.mergeAll(
			Layer.succeed(WorkflowInstance, instance),
			Layer.succeed(WorkflowEngine, engine),
			Layer.mock(UserBootstrapWorkflowOperations, {
				dispatch: (plans) => Ref.update(dispatched, (all) => [...all, plans]),
				perform: () =>
					Ref.updateAndGet(attempts, (count) => count + 1).pipe(
						Effect.flatMap((attempt) =>
							attempt === 1
								? Effect.fail(internalError("temporary bootstrap failure"))
								: Effect.succeed([`plan-${attempt}`]),
						),
					),
			}),
			Layer.succeed(RecordedBootstrapWorkflow, {
				attempts: Ref.get(attempts),
				dispatched: Ref.get(dispatched),
			}),
		);
	}),
);

layer(retryingWorkflowLayer)((test) => {
	test.effect(
		"retries a failed bootstrap attempt, then dispatches its plans from the body",
		() =>
			Effect.gen(function* () {
				const workflow = yield* Effect.forkChild(
					runUserBootstrapWorkflow(
						{ userId, accountGeneration: { userId, token: "test-account-generation" } },
						executionId,
					),
				);
				yield* TestClock.adjust("1 second");
				yield* Fiber.join(workflow);
				const recorded = yield* RecordedBootstrapWorkflow;

				expect(yield* recorded.attempts).toBe(2);
				expect(yield* recorded.dispatched).toEqual([["plan-2"]]);
			}),
		testTimeout,
	);
});
