import { ImportRunStatus } from "@ryot-app/contract/modules/imports/schemas";
import { IntegrationSnapshot } from "@ryot-app/contract/modules/integrations/schemas";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import { AutomationExecutionId, UserId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Cause, DateTime, Effect, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { rootLifecycleCommand, type LifecycleCommand } from "#lib/domain/lifecycle-command";
import { implementWorkflow, makeActivity } from "#lib/infrastructure/workflow-scope";
import { SignalEmissionService } from "#modules/automations/signal-service";
import { ProcessDataImportWorkflow } from "#modules/imports/data-workflow";
import { markImportRunStarted } from "#modules/imports/runtime/import-run-status";
import { ImportsService } from "#modules/imports/service";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { failRun, toIntegrationWorkflowError } from "./failure-workflow";
import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import { IntegrationRunError, type IntegrationRunJobData } from "./jobs";
import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import { finalizeIntegrationRun } from "./worker";

const IntegrationRecordSchema = Schema.Struct({
	...IntegrationSnapshot.fields,
	userId: UserId,
	pluginInstallationId: Schema.NullOr(Schema.String),
});

const runIntegrationImport = Effect.fn("runIntegrationImport")(function* (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
	command: LifecycleCommand,
) {
	if (integration.pluginInstallationId === null) {
		const engine = yield* WorkflowEngine;
		return yield* engine
			.execute(ProcessDataImportWorkflow, {
				executionId: `${payload.runId}-data`,
				payload: { command, runId: payload.runId, userId: integration.userId },
			})
			.pipe(Effect.mapError(toIntegrationWorkflowError));
	}
	const catalog = yield* IntegrationProviderCatalog;
	const sandbox = yield* SandboxExecutionService;
	const provider = yield* catalog
		.findOwnedForUser(integration.userId, integration.provider, integration.pluginInstallationId)
		.pipe(Effect.mapError(toIntegrationWorkflowError));
	if (!provider?.scriptSlug) {
		return yield* new IntegrationRunError({
			message: `Integration provider '${integration.provider}' is unavailable`,
		});
	}
	const scriptId = yield* sandbox
		.resolveWorkflowScript({
			executionId,
			workflowSlug: "import",
			userId: integration.userId,
			pluginId: provider.pluginId,
			pluginInstallationId: integration.pluginInstallationId,
		})
		.pipe(Effect.mapError(toIntegrationWorkflowError));
	const integrationContext: JsonValue = payload.webhook ?? {};
	const input: JsonValue = yield* Schema.decodeUnknownEffect(jsonValueSchema)({
		command,
		runId: payload.runId,
		source: integration.provider,
		sourcePayload: {
			integrationContext,
			integrationId: integration.id,
			integrationScriptSlug: provider.scriptSlug,
		},
	}).pipe(Effect.mapError(toIntegrationWorkflowError));
	return yield* sandbox
		.executeWorkflow({
			input,
			scriptId,
			executionId: `${executionId}-import`,
			subject: {
				type: "user",
				userId: integration.userId,
				integrationId: integration.id,
				integrationRunId: payload.runId,
			},
		})
		.pipe(Effect.mapError(toIntegrationWorkflowError));
});

const runIntegrationRun = Effect.fn("runIntegrationRun")(function* (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
	command: LifecycleCommand,
) {
	const imports = yield* ImportsService;
	const completeCancellation = Effect.fn("completeIntegrationRunCancellation")(function* () {
		yield* makeActivity({
			error: IntegrationRunError,
			name: "finish-integration-run-cancelled",
			execute: Effect.gen(function* () {
				const finishedAt = yield* DateTime.nowAsDate;
				yield* imports.finishCancelled({ finishedAt, runId: payload.runId });
			}).pipe(Effect.mapError(toIntegrationWorkflowError)),
		});
	});
	yield* Workflow.addFinalizer(() =>
		Effect.flatMap(WorkflowInstance, (instance) =>
			instance.interrupted
				? completeCancellation().pipe(
						Effect.catchCause((cause) =>
							Effect.logError("integration cancellation cleanup failed", cause),
						),
					)
				: Effect.void,
		),
	);
	const markStartedEffect = markImportRunStarted(payload.runId).pipe(
		Effect.mapError(toIntegrationWorkflowError),
	);
	const start = yield* makeActivity({
		error: IntegrationRunError,
		execute: markStartedEffect,
		name: "mark-integration-run-started",
		success: Schema.Literals(["started", "cancellation-requested", "preserved"]),
	});
	if (start === "cancellation-requested") {
		yield* completeCancellation();
		return;
	}
	if (start === "preserved") {
		return;
	}

	yield* runIntegrationImport(integration, payload, executionId, command).pipe(
		Effect.catchCause((cause) =>
			Effect.flatMap(WorkflowInstance, (instance) => {
				if (instance.suspended && Cause.hasInterruptsOnly(cause)) {
					return Effect.failCause(cause);
				}
				return Effect.logError("integration import failed", cause).pipe(
					Effect.andThen(
						failRun("fail-integration-run-unexpected", payload.runId, {
							code: "unexpected-failure",
							operation: "integration-import",
						}),
					),
				);
			}),
		),
	);

	const runStatus = yield* makeActivity({
		error: IntegrationRunError,
		success: Schema.NullOr(ImportRunStatus),
		name: "settle-integration-run-after-plugin",
		execute: Effect.gen(function* () {
			const run = yield* imports.getRunControlForUser({
				runId: payload.runId,
				userId: integration.userId,
			});
			if (run?.status === "running") {
				const finishedAt = yield* DateTime.nowAsDate;
				yield* imports.finishFailed({
					finishedAt,
					runId: payload.runId,
					failureReason: { code: "unexpected-failure", operation: "integration-finalization" },
				});
				return "failed" as const;
			}
			return run?.status ?? null;
		}).pipe(Effect.mapError(toIntegrationWorkflowError)),
	});
	if (runStatus === "cancelling") {
		yield* completeCancellation();
		return;
	}
	if (runStatus === "cancelled") {
		return;
	}

	const finalizationEffect = finalizeIntegrationRun(integration, payload.runId).pipe(
		Effect.mapError(toIntegrationWorkflowError),
	);
	const wasDisabled = yield* makeActivity({
		success: Schema.Boolean,
		error: IntegrationRunError,
		execute: finalizationEffect,
		name: "finalize-integration-run",
	});

	if (wasDisabled) {
		const signals = yield* SignalEmissionService;
		const emitDisabledSignal = signals
			.emitSignal({
				schemaSlug: "integration.disabled",
				principal: { kind: "user", userId: integration.userId },
				properties: { integrationId: integration.id, providerName: integration.provider },
				command: {
					...command,
					occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
					itemIdentity: stableStringify([command.itemIdentity, "signal", "integration.disabled"]),
				},
			})
			.pipe(Effect.mapError(toIntegrationWorkflowError));
		yield* emitDisabledSignal;
	}
});

export const runIntegrationRunWorkflow = Effect.fn("ProcessIntegrationRunWorkflow")(
	function* (payload: IntegrationRunJobData, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			runId: payload.runId,
			userId: payload.userId,
			integrationId: payload.integrationId,
		});
		const integrationsRepository = yield* IntegrationsRepository;

		const loadIntegrationEffect = integrationsRepository
			.getByIdAnyUser({ integrationId: payload.integrationId })
			.pipe(Effect.mapError(toIntegrationWorkflowError));
		const integration = yield* makeActivity({
			name: "load-integration",
			error: IntegrationRunError,
			execute: loadIntegrationEffect,
			success: Schema.NullOr(IntegrationRecordSchema),
		});

		if (!integration) {
			yield* failRun("fail-run-integration-not-found", payload.runId, {
				code: "integration-not-found",
			});
			return;
		}

		const command = rootLifecycleCommand({
			source: "integration",
			importRunId: payload.runId,
			integrationId: integration.id,
			executionId: AutomationExecutionId.make(executionId),
			initiator: { id: integration.id, kind: "integration" },
			itemIdentity: stableStringify(["integration-run", payload.runId]),
			occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
		});
		yield* runIntegrationRun(integration, payload, executionId, command);
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "ProcessIntegrationRunWorkflow" }),
);

const ProcessIntegrationRunWorkflowLive = implementWorkflow(
	ProcessIntegrationRunWorkflow,
	runIntegrationRunWorkflow,
);

export const IntegrationWorkflowDefinitionsLive = ProcessIntegrationRunWorkflowLive;
