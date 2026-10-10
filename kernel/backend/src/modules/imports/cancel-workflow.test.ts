import { expect, layer } from "@effect/vitest";
import { ImportRunId, IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { makeWorkflowEngine } from "#lib/test-utils/effect";

import { CancelImportRunWorkflow, runCancelImportRunWorkflow } from "./cancel-workflow";
import { ImportRunExecutionController } from "./execution-controller";
import { ingestionTestRun } from "./ingestion.test-support";
import { ImportsRepository, type ImportRunExecutionKind } from "./repository";

const runId = ImportRunId.make("run-1");
const userId = UserId.make("user-1");

class FakeCancelWorkflow extends Context.Service<
	FakeCancelWorkflow,
	{
		readonly events: Effect.Effect<ReadonlyArray<string>>;
		readonly interrupts: Effect.Effect<
			ReadonlyArray<{ runId: ImportRunId; executionKind: ImportRunExecutionKind }>
		>;
	}
>()("test/FakeCancelWorkflow") {}

const makeLayer = (executionKind: ImportRunExecutionKind, cancellable = true) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const events = yield* Ref.make<ReadonlyArray<string>>([]);
			const interrupts = yield* Ref.make<
				ReadonlyArray<{ runId: ImportRunId; executionKind: ImportRunExecutionKind }>
			>([]);
			const appendEvent = (event: string) => Ref.update(events, (all) => [...all, event]);
			const control = {
				id: runId,
				status: cancellable ? ("cancelling" as const) : ("completed" as const),
				integrationId: executionKind === "source" ? null : IntegrationId.make("integration-1"),
			};
			const repository = Layer.mock(ImportsRepository)({
				cancelIngestion: () => appendEvent("request").pipe(Effect.as(cancellable)),
				getIngestionRun: () => Effect.succeed({ ...ingestionTestRun(), ...control, executionKind }),
			});
			return Layer.mergeAll(
				repository,
				Layer.succeed(FakeCancelWorkflow, {
					events: Ref.get(events),
					interrupts: Ref.get(interrupts),
				}),
				Layer.succeed(
					WorkflowEngine,
					makeWorkflowEngine({
						activityExecute: (activity) =>
							Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
					}),
				),
				Layer.succeed(
					WorkflowInstance,
					WorkflowInstance.initial(CancelImportRunWorkflow, "run-1-cancellation"),
				),
				Layer.succeed(ImportRunExecutionController, {
					interrupt: (input) =>
						Ref.update(interrupts, (all) => [...all, input]).pipe(
							Effect.andThen(appendEvent("interrupt")),
						),
				}),
			);
		}),
	);

for (const executionKind of ["source", "integration"] as const) {
	layer(makeLayer(executionKind))((test) => {
		test.effect(`persists cancellation before interrupting the ${executionKind} execution`, () =>
			Effect.gen(function* () {
				yield* runCancelImportRunWorkflow({
					runId,
					userId,
					accountGeneration: { userId, token: "generation" },
				});
				const fake = yield* FakeCancelWorkflow;
				expect(yield* fake.events).toEqual(["request", "interrupt"]);
				expect(yield* fake.interrupts).toEqual([{ runId, executionKind }]);
			}),
		);
	});
}

layer(makeLayer("source", false))((test) => {
	test.effect("does not interrupt when the cancellation request is not cancellable", () =>
		Effect.gen(function* () {
			yield* runCancelImportRunWorkflow({
				runId,
				userId,
				accountGeneration: { userId, token: "generation" },
			});
			const fake = yield* FakeCancelWorkflow;
			expect(yield* fake.events).toEqual(["request"]);
			expect(yield* fake.interrupts).toEqual([]);
		}),
	);
});
