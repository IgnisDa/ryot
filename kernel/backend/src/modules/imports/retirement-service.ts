import { ImportRunId, type UserId, type IntegrationId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { AdmittedWorkflowCatalogue } from "#modules/mutations/workflow-catalogue";
import type { PluginIngestionRetirementPolicy } from "#modules/plugins/packages/ingestion-retirement";
import { DatabaseSession } from "#platform/db/session";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import { interruptWorkflowAndWait } from "#platform/workflow/interruption";

import { reconcileGenericIngestionBatch } from "./batch-results";
import { IngestionCaptures } from "./capture-service";
import { reconcileDataIngestionBatch } from "./data-workflow";
import { IngestionExecution } from "./execution-service";
import { ImportsRepository } from "./repository";
import { ImportRunError } from "./runtime/workflow-errors";

export class IngestionRetirement extends Context.Service<IngestionRetirement>()(
	"IngestionRetirement",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const repository = yield* ImportsRepository;
			const execution = yield* IngestionExecution;
			const captures = yield* IngestionCaptures;
			const catalogue = yield* AdmittedWorkflowCatalogue;
			const engine = yield* WorkflowEngine;
			const notifications = yield* WorkflowExecutionNotifications;
			const retire = Effect.fn("IngestionRetirement.retire")(function* (input: {
				userId: UserId;
				integrationId?: IntegrationId;
				pluginInstallationId?: string;
				policy: PluginIngestionRetirementPolicy;
			}) {
				if (
					input.policy.kind === "quarantine" &&
					input.pluginInstallationId !== input.policy.reason.installationId
				) {
					return yield* new ImportRunError({
						message: "Quarantine requires its exact installation",
					});
				}
				for (const run of yield* database.transaction(repository.retireRuns(input))) {
					if (input.policy.kind === "quarantine" && run.status !== "cancelling") {
						continue;
					}
					const scope = {
						userId: input.userId,
						runId: ImportRunId.make(run.id),
						accountGeneration: { userId: input.userId, token: run.accountGeneration },
					};
					const name =
						run.integrationId === null
							? "ProcessImportRunWorkflow"
							: "ProcessIntegrationRunWorkflow";
					const root = catalogue.find((workflow) => workflow._tag === name);
					if (!root) {
						return yield* new ImportRunError({
							message: "Ingestion retirement root is not registered",
						});
					}
					yield* input.policy.kind === "quarantine"
						? engine.interrupt(root, scope.runId)
						: interruptWorkflowAndWait(root, scope.runId).pipe(
								Effect.provideService(WorkflowEngine, engine),
								Effect.provideService(WorkflowExecutionNotifications, notifications),
							);
					yield* execution
						.settle({
							scope,
							status: "cancelled",
							retirementPolicy: input.policy,
							reconcile: (batch) =>
								run.pluginInstallationId === null
									? reconcileDataIngestionBatch(scope, batch)
									: reconcileGenericIngestionBatch(scope, batch),
						})
						.pipe(
							Effect.provideService(DatabaseSession, database),
							Effect.provideService(ImportsRepository, repository),
							Effect.provideService(IngestionCaptures, captures),
						);
					if (input.policy.kind === "removal") {
						yield* execution.retire(scope);
					}
				}
				return yield* Effect.void;
			});
			return { retire };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
