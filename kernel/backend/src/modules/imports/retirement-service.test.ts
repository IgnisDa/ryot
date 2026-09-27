import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { makeWorkflowEngine } from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";
import { AdmittedWorkflowCatalogue } from "#modules/mutations/workflow-catalogue";

import { IngestionCaptures } from "./capture-service";
import { IngestionExecution } from "./execution-service";
import { ingestionTestScope } from "./ingestion.test-support";
import { ImportsRepository } from "./repository";
import { IngestionRetirement } from "./retirement-service";

it.effect(
	"waits for root interruption and reconciles cancellation before releasing captured bytes and pins",
	() =>
		Effect.gen(function* () {
			const interrupted = yield* Deferred.make<void>();
			const finish = yield* Deferred.make<void>();
			const events: string[] = [];
			const root = Workflow.make("ProcessIntegrationRunWorkflow", {
				success: Schema.Void,
				error: Schema.Unknown,
				payload: Schema.Struct({}),
				idempotencyKey: () => ingestionTestScope.runId,
			});
			const dependencies = Layer.mergeAll(
				mutationAdmissionTestLayer,
				Layer.succeed(AdmittedWorkflowCatalogue, [root]),
				Layer.mock(IngestionCaptures)({}),
				Layer.mock(ImportsRepository)({
					retireRuns: () =>
						Effect.sync(() => {
							events.push("cancel-owners");
							return [
								{
									id: ingestionTestScope.runId,
									integrationId: "integration-1",
									pluginInstallationId: "installation-1",
									accountGeneration: ingestionTestScope.accountGeneration.token,
								},
							];
						}),
				}),
				Layer.succeed(
					WorkflowEngine,
					makeWorkflowEngine({
						poll: () => Effect.succeedNone,
						interrupt: (_workflow, id) =>
							Effect.gen(function* () {
								events.push(`interrupt:${id}`);
								yield* Deferred.succeed(interrupted, undefined);
								yield* Deferred.await(finish);
							}),
					}),
				),
				Layer.mock(IngestionExecution)({
					retire: (scope) =>
						Effect.sync(() => {
							events.push(`cleanup:${scope.runId}`);
						}),
					settle: (input) =>
						Effect.sync(() => {
							events.push(`settle:${input.status}`);
							return true;
						}),
				}),
			);
			const context = yield* Layer.build(
				IngestionRetirement.layer.pipe(Layer.provideMerge(dependencies)),
			);
			const fiber = yield* Effect.flatMap(IngestionRetirement, (service) =>
				service.retire({
					userId: ingestionTestScope.userId,
					pluginInstallationId: "installation-1",
				}),
			).pipe(Effect.provideContext(context), Effect.forkChild);
			yield* Deferred.await(interrupted);
			expect(events).toEqual(["cancel-owners", "interrupt:run-1"]);
			yield* Deferred.succeed(finish, undefined);
			yield* Fiber.join(fiber);
			expect(events).toEqual([
				"cancel-owners",
				"interrupt:run-1",
				"settle:cancelled",
				"cleanup:run-1",
			]);
		}),
);
