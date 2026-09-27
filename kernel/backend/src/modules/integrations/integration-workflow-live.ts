import {
	ImportRunStatus,
	ImportRunFailureReason,
} from "@ryot-app/contract/modules/imports/schemas";
import { IntegrationSnapshot } from "@ryot-app/contract/modules/integrations/schemas";
import { AutomationExecutionId, UserId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import {
	genericImportWorkflowInputSchema,
	genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Cause, DateTime, Effect, FileSystem, Layer, Schema } from "effect";
import { DurableClock, Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { AppConfig } from "#lib/infrastructure/config/service";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import { SignalEmissionService } from "#modules/automations/signal-service";
import { ProcessDataImportWorkflow } from "#modules/imports/data-workflow";
import { IngestionExecution } from "#modules/imports/execution-service";
import { IngestionExecutionLive } from "#modules/imports/layer";
import { ImportsRepository } from "#modules/imports/repository";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow, dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { toIntegrationWorkflowError } from "./failure-workflow";
import { IntegrationIngestion } from "./ingestion";
import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import { IntegrationRunError, type IntegrationRunJobData } from "./jobs";
import { IntegrationIngestionLive } from "./layer";
import { IntegrationsRepository } from "./repository";
import { finalizeIntegrationRun } from "./worker";

const IntegrationRecordSchema = Schema.Struct({
	...IntegrationSnapshot.fields,
	userId: UserId,
	pluginInstallationId: Schema.NullOr(Schema.String),
});

export const runIntegrationRunWorkflow = Effect.fn("ProcessIntegrationRunWorkflow")(
	function* (payload: IntegrationRunJobData, executionId: string) {
		const scope = {
			runId: payload.runId,
			userId: payload.userId,
			accountGeneration: payload.accountGeneration,
		};
		const receipts = yield* MutationReceipts.make;
		yield* admitWorkflow(
			receipts,
			ProcessIntegrationRunWorkflow,
			payload.accountGeneration,
			executionId,
		);
		const repository = yield* ImportsRepository;
		const ingestion = yield* IntegrationIngestion;
		const execution = yield* IngestionExecution;
		const integrations = yield* IntegrationsRepository;
		const owner = `${executionId}-import`;
		const reference = `${executionId}-integration-orchestrator`;
		const artifacts = yield* SandboxArtifactStore;
		const release = () => artifacts.release(owner, reference);
		const initial = yield* repository.getIngestionRun(scope);
		if (!initial || ["cancelled", "expired"].includes(initial.status)) {
			yield* execution.cleanup(scope);
			yield* release();
			return;
		}
		if (["completed", "failed"].includes(initial.status)) {
			yield* execution.cleanup(scope);
			yield* release();
		}
		if (initial.status === "blocked") {
			return;
		}
		const settle = Effect.fnUntraced(function* (
			status: "completed" | "failed" | "cancelled",
			failureReason?: ImportRunFailureReason,
		) {
			for (let attempt = 0; ; attempt++) {
				const settled = yield* ingestion.settle(scope, status, failureReason).pipe(
					Effect.map((value) => ({ value })),
					Effect.catchTag("IntegrationConfirmationError", () => Effect.succeed(null)),
					Effect.mapError(toIntegrationWorkflowError),
				);
				if (settled) {
					return settled.value;
				}
				yield* DurableClock.sleep({
					duration: "1 second",
					name: `await-source-confirmation:${status}:${attempt}`,
				});
			}
		});
		yield* Workflow.addFinalizer(() =>
			Effect.flatMap(WorkflowInstance, (instance) =>
				instance.interrupted
					? settle("cancelled").pipe(Effect.andThen(release()), Effect.catchCause(Effect.logError))
					: Effect.void,
			),
		);
		if (initial.status === "cancelling") {
			yield* settle("cancelled");
			return;
		}
		const integration = yield* makeActivity({
			name: "load-integration",
			error: IntegrationRunError,
			success: Schema.NullOr(IntegrationRecordSchema),
			execute: integrations
				.getForUser({ userId: payload.userId, integrationId: payload.integrationId })
				.pipe(Effect.mapError(toIntegrationWorkflowError)),
		});
		if (!integration) {
			yield* repository.cancelIngestion(scope);
			yield* settle("cancelled");
			return;
		}
		const command = rootLifecycleCommand({
			source: "integration",
			importRunId: payload.runId,
			integrationId: integration.id,
			accountGeneration: payload.accountGeneration,
			occurredAt: IsoUtcString.make(initial.acceptedAt),
			executionId: AutomationExecutionId.make(executionId),
			initiator: { id: integration.id, kind: "integration" },
			itemIdentity: stableStringify(["integration-run", payload.runId]),
		});
		const process = Effect.gen(function* () {
			for (let attempt = 0; ; attempt++) {
				const started = yield* makeActivity({
					success: Schema.Boolean,
					error: IntegrationRunError,
					name: `start-integration-ingestion:${attempt}`,
					execute: repository
						.startIntegrationIngestion({
							scope,
							integrationId: integration.id,
							startedAt: yield* DateTime.nowAsDate,
						})
						.pipe(Effect.mapError(toIntegrationWorkflowError)),
				});
				if (started) {
					break;
				}
				const waiting = yield* repository.getIngestionRun(scope);
				if (waiting?.status !== "pending") {
					if (waiting?.status === "cancelling") {
						yield* settle("cancelled");
					}
					return yield* Effect.void;
				}
				yield* DurableClock.sleep({
					duration: "1 second",
					name: `await-integration-application:${attempt}`,
				});
			}
			const run = yield* repository.getIngestionRun(scope);
			if (run?.status !== "running") {
				if (run?.status === "cancelling") {
					yield* settle("cancelled");
				}
				return yield* Effect.void;
			}
			if (integration.pluginInstallationId === null) {
				const engine = yield* WorkflowEngine;
				yield* dispatchAdmittedWorkflow(
					receipts,
					engine,
					ProcessDataImportWorkflow,
					payload.accountGeneration,
					{
						executionId: `${payload.runId}-data`,
						payload: { command, runId: payload.runId, userId: payload.userId },
					},
					(admission) => admission,
					(dispatch) => dispatch,
				);
			} else {
				const sandbox = yield* SandboxExecutionService;
				const state = yield* ingestion.recoverInput(scope);
				const fs = yield* FileSystem.FileSystem;
				const config = yield* AppConfig;
				const path = yield* fs.makeTempFileScoped({
					directory: yield* fs.realPath(config.fileStorage.localTempDir),
				});
				yield* fs.writeFileString(path, stableStringify(state.sourcePayload));
				yield* artifacts.retain(owner, reference);
				const [sourcePayloadHandle] = yield* artifacts.materializeOutputs(owner, [path]);
				if (!sourcePayloadHandle) {
					return yield* new IntegrationRunError({
						message: "Integration admitted input is unavailable",
					});
				}
				const input = yield* Schema.encodeUnknownEffect(genericImportWorkflowInputSchema)({
					command,
					plan: run.plan,
					source: run.source,
					sourcePayloadHandle,
					runId: payload.runId,
				}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(jsonValueSchema)));
				const result = yield* sandbox
					.executeWorkflow({
						input,
						executionId: owner,
						scriptId: state.workflowScriptId,
						pluginRevision: state.pluginRevision,
						subject: {
							type: "user",
							userId: payload.userId,
							integrationId: integration.id,
							integrationRunId: payload.runId,
							accountGeneration: payload.accountGeneration,
						},
					})
					.pipe(Effect.flatMap(Schema.decodeUnknownEffect(genericImportWorkflowResultSchema)));
				const sourceIssue = result.issues.find(
					(issue) => issue.severity === "error" && issue.attribution === null,
				);
				if (sourceIssue) {
					const reason = yield* Schema.decodeUnknownEffect(ImportRunFailureReason)({
						code: sourceIssue.reason.code,
					});
					const database = yield* DatabaseSession;
					yield* database.transaction(repository.recordIssue(scope, sourceIssue));
					yield* settle("failed", reason);
					yield* release();
					return yield* Effect.void;
				}
			}
			yield* settle("completed");
			yield* release();
			return yield* Effect.void;
		});
		if (!["completed", "failed"].includes(initial.status)) {
			yield* process.pipe(
				Effect.catchCause((cause) =>
					Effect.flatMap(WorkflowInstance, (instance) =>
						instance.suspended && Cause.hasInterruptsOnly(cause)
							? Effect.failCause(cause)
							: Effect.logError("integration ingestion failed", cause).pipe(
									Effect.andThen(settle("failed")),
									Effect.andThen(release()),
								),
					),
				),
			);
		}
		const status = yield* makeActivity({
			error: IntegrationRunError,
			name: "integration-terminal-status",
			success: Schema.NullOr(ImportRunStatus),
			execute: repository.getIngestionRun(scope).pipe(
				Effect.map((run) => run?.status ?? null),
				Effect.mapError(toIntegrationWorkflowError),
			),
		});
		if (status !== "completed" && status !== "failed") {
			return;
		}
		const disabled = yield* makeActivity({
			success: Schema.Boolean,
			error: IntegrationRunError,
			name: "finalize-integration-run",
			execute: finalizeIntegrationRun(integration, payload.runId).pipe(
				Effect.mapError(toIntegrationWorkflowError),
			),
		});
		if (disabled) {
			const signals = yield* SignalEmissionService;
			yield* signals.emitSignal({
				schemaSlug: "integration.disabled",
				principal: { kind: "user", userId: payload.userId },
				properties: { integrationId: integration.id, providerName: integration.provider },
				command: {
					...command,
					occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
					itemIdentity: stableStringify([command.itemIdentity, "signal", "integration.disabled"]),
				},
			});
		}
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "ProcessIntegrationRunWorkflow" }).pipe(
			Effect.mapError(toIntegrationWorkflowError),
		),
);

export const IntegrationWorkflowDefinitionsLive = implementWorkflow(
	ProcessIntegrationRunWorkflow,
	runIntegrationRunWorkflow,
).pipe(
	Layer.provide(
		Layer.mergeAll(IntegrationIngestionLive, IngestionExecutionLive, ImportsRepository.layer),
	),
);
