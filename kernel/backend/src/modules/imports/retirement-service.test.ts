import { expect, it } from "@effect/vitest";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { Deferred, Effect, Fiber, Layer, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import { AdmittedWorkflowCatalogue } from "#modules/mutations/workflow-catalogue";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import { makeWorkflowEngine } from "#testing/effect";

import { IngestionCaptures } from "./capture-service";
import { IngestionExecution } from "./execution-service";
import { ingestionTestScope } from "./ingestion.test-support";
import { ImportsRepository } from "./repository";
import { IngestionRetirement } from "./retirement-service";

for (const mode of ["removal", "quarantine"] as const) {
	it.effect(`${mode} preserves its interruption and cleanup policy`, () =>
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
				WorkflowExecutionNotifications.layer,
				mutationAdmissionTestLayer,
				Layer.succeed(AdmittedWorkflowCatalogue, [root]),
				Layer.mock(IngestionCaptures)({}),
				Layer.mock(ImportsRepository)({
					retireRuns: () =>
						Effect.sync(() => {
							events.push("cancel-owners");
							const runs = [
								{
									id: ingestionTestScope.runId,
									status: "cancelling" as const,
									integrationId: "integration-1",
									pluginInstallationId: "installation-1",
									accountGeneration: ingestionTestScope.accountGeneration.token,
								},
							];
							return mode === "quarantine"
								? [
										...runs,
										{
											...runs[0],
											id: "completed-root",
											status: "completed" as const,
											integrationId: "integration-1",
											pluginInstallationId: "installation-1",
											accountGeneration: ingestionTestScope.accountGeneration.token,
										},
									]
								: runs;
						}),
				}),
				Layer.succeed(
					WorkflowEngine,
					makeWorkflowEngine({
						poll: () => (mode === "quarantine" ? Effect.never : Effect.succeedNone),
						interrupt: (_workflow, id) =>
							Effect.gen(function* () {
								events.push(`interrupt:${id}`);
								yield* Deferred.succeed(interrupted, undefined);
								if (mode === "removal") {
									yield* Deferred.await(finish);
								}
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
					policy:
						mode === "removal"
							? { kind: "removal" }
							: {
									kind: "quarantine",
									reason: {
										installationId: "installation-1",
										code: "package-identity-conflict",
										pluginId: PluginId.make("plugin-1"),
									},
								},
				}),
			).pipe(Effect.provideContext(context), Effect.forkChild);
			yield* Deferred.await(interrupted);
			if (mode === "removal") {
				expect(events).toEqual(["cancel-owners", "interrupt:run-1"]);
				yield* Deferred.succeed(finish, undefined);
				yield* Fiber.join(fiber);
				expect(events).toEqual([
					"cancel-owners",
					"interrupt:run-1",
					"settle:cancelled",
					"cleanup:run-1",
				]);
			} else {
				yield* Fiber.join(fiber);
				expect(events).toEqual(["cancel-owners", "interrupt:run-1", "settle:cancelled"]);
			}
		}),
	);
}
