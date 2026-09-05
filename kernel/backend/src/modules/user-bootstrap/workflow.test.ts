import { expect, layer } from "@effect/vitest";
import { internalError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Fiber, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { makeWorkflowActivityEngine } from "#lib/test-utils/effect";

import {
	runUserBootstrapWorkflow,
	UserBootstrapWorkflow,
	UserBootstrapWorkflowOperations,
} from "./workflow";

const userId = UserId.make("user-1");
const executionId = "user-bootstrap-6-user-1";

class RecordedBootstrapWorkflow extends Context.Service<
	RecordedBootstrapWorkflow,
	{ readonly attempts: Effect.Effect<number> }
>()("test/RecordedBootstrapWorkflow") {}

const retryingWorkflowLayer = Layer.unwrap(
	Effect.gen(function* () {
		const attempts = yield* Ref.make(0);
		const instance = WorkflowInstance.initial(UserBootstrapWorkflow, executionId);
		const engine = makeWorkflowActivityEngine(instance);
		return Layer.mergeAll(
			Layer.succeed(WorkflowInstance, instance),
			Layer.succeed(WorkflowEngine, engine),
			Layer.mock(UserBootstrapWorkflowOperations, {
				perform: () =>
					Ref.updateAndGet(attempts, (count) => count + 1).pipe(
						Effect.flatMap((attempt) =>
							attempt === 1
								? Effect.fail(internalError("temporary bootstrap failure"))
								: Effect.void,
						),
					),
			}),
			Layer.succeed(RecordedBootstrapWorkflow, { attempts: Ref.get(attempts) }),
		);
	}),
);

layer(retryingWorkflowLayer)((test) => {
	test.effect("retries a failed bootstrap attempt and then succeeds", () =>
		Effect.gen(function* () {
			const workflow = yield* Effect.forkChild(runUserBootstrapWorkflow({ userId }, executionId));
			yield* TestClock.adjust("1 second");
			yield* Fiber.join(workflow);
			const recorded = yield* RecordedBootstrapWorkflow;

			expect(yield* recorded.attempts).toBe(2);
		}),
	);
});
