import { ListedIntegration } from "@ryot-app/contract/modules/integrations/schemas";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Cause, DateTime, Effect, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";

import { markImportRunStarted } from "#modules/imports/runtime/import-run-status";
import { IntegrationProviderCatalog } from "#modules/plugins/integration-provider-catalog";
import { SandboxExecutionService } from "#modules/sandbox/service";
import { SignalEmissionService } from "#modules/signals/service";

import { failRun, toIntegrationWorkflowError } from "./failure-workflow";
import { ProcessIntegrationRunWorkflow } from "./integration-workflow";
import { IntegrationRunError, type IntegrationRunJobData } from "./jobs";
import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import { finalizeIntegrationRun } from "./worker";

const IntegrationRecordSchema = Schema.Struct({
	...ListedIntegration.fields,
	userId: UserId,
	pluginInstallationId: Schema.String,
});

const runIntegrationImport = Effect.fn("runIntegrationImport")(function* (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
) {
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
	const input: JsonValue = {
		runId: payload.runId,
		source: integration.provider,
		sourcePayload: {
			integrationContext,
			integrationId: integration.id,
			integrationScriptSlug: provider.scriptSlug,
		},
	};
	return yield* sandbox
		.executeWorkflow({
			input,
			scriptId,
			executionId: `${executionId}-import`,
			subject: { type: "user", userId: integration.userId, integrationId: integration.id },
		})
		.pipe(Effect.mapError(toIntegrationWorkflowError));
});

const runIntegrationRun = Effect.fn("runIntegrationRun")(function* (
	integration: IntegrationRecord,
	payload: IntegrationRunJobData,
	executionId: string,
) {
	const markStartedEffect = markImportRunStarted(payload.runId).pipe(
		Effect.mapError(toIntegrationWorkflowError),
	);
	yield* Activity.make({
		error: IntegrationRunError,
		execute: markStartedEffect,
		name: "mark-integration-run-started",
	});

	yield* runIntegrationImport(integration, payload, executionId).pipe(
		Effect.catchCauseIf(
			(cause) => !Cause.hasInterruptsOnly(cause),
			(cause) =>
				Effect.logError("integration import failed", cause).pipe(
					Effect.andThen(
						failRun("fail-integration-run-unexpected", payload.runId, {
							code: "unexpected-failure",
							operation: "integration-import",
						}),
					),
				),
		),
	);

	const finalizationEffect = finalizeIntegrationRun(integration, payload.runId).pipe(
		Effect.mapError(toIntegrationWorkflowError),
	);
	const wasDisabled = yield* Activity.make({
		success: Schema.Boolean,
		error: IntegrationRunError,
		execute: finalizationEffect,
		name: "finalize-integration-run",
	});

	if (wasDisabled) {
		const signals = yield* SignalEmissionService;
		const emitDisabledSignal = signals
			.emit({
				executionId,
				discriminator: integration.id,
				schemaSlug: "integration.disabled",
				occurredAt: yield* DateTime.nowAsDate,
				principal: { kind: "user", userId: integration.userId },
				properties: { integrationId: integration.id, providerName: integration.provider },
				origin: { kind: "integration", importRunId: payload.runId, integrationId: integration.id },
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
		const integration = yield* Activity.make({
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

		yield* runIntegrationRun(integration, payload, executionId);
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "ProcessIntegrationRunWorkflow" }),
);

const ProcessIntegrationRunWorkflowLive =
	ProcessIntegrationRunWorkflow.toLayer(runIntegrationRunWorkflow);

export const IntegrationWorkflowDefinitionsLive = ProcessIntegrationRunWorkflowLive;
