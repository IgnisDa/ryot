import { Path } from "@effect/platform";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import type { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import { ImportRunId, type IntegrationId, type UserId } from "@ryot/contract/schema/brands";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Effect, Layer, Schema } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import {
	SANDBOX_HARVEST_DIRECTORY_PREFIX,
	sanitizeSandboxExecutionSegment,
} from "#lib/infrastructure/sandbox-runtime/filesystem-grants";
import { ServerRun } from "#lib/infrastructure/server-run";
import { EntityImportPayload } from "#modules/entity-import/entity-import-workflow";
import {
	EventCreateWorkflow,
	EventCreateWorkflowPayload,
} from "#modules/events/event-create-workflow";
import {
	ProcessGenericImportChunksPayload,
	ProcessGenericImportChunksWorkflow,
} from "#modules/imports/generic-import-workflow";
import { ImportsRepository } from "#modules/imports/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { LibraryEntityImportWorkflow } from "#modules/library-membership/library-entity-import-workflow";
import {
	KERNEL_EVENT_CREATE_WORKFLOW,
	KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW,
	KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW,
	KernelWorkflowReferences,
} from "#modules/sandbox/kernel-workflow-references";

const attributionIds = (origin: AutomationOrigin | undefined) => ({
	integrationIds: origin?.kind === "integration" ? [origin.integrationId] : [],
	importRunIds:
		(origin?.kind === "import" || origin?.kind === "integration") && origin.importRunId
			? [origin.importRunId]
			: [],
});

const requireOwned = <A, E>(lookup: Effect.Effect<A | null, E>, message: string) =>
	lookup.pipe(
		Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
		Effect.flatMap((owned) =>
			owned ? Effect.void : Effect.fail(new SandboxRunError({ message })),
		),
	);

export const KernelWorkflowReferencesLive = Layer.effect(
	KernelWorkflowReferences,
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const config = yield* AppConfig;
		const runWithDb = yield* DbRunner;
		const serverRun = yield* ServerRun;
		const imports = yield* ImportsRepository;
		const integrations = yield* IntegrationsRepository;

		const validateAttribution = (input: {
			userId: UserId;
			importRunIds: ReadonlyArray<ImportRunId>;
			integrationIds: ReadonlyArray<IntegrationId>;
		}) =>
			Effect.all([
				Effect.forEach(input.importRunIds, (runId) =>
					requireOwned(
						runWithDb(imports.getRunById({ runId, userId: input.userId })),
						`Kernel workflow import run '${runId}' does not belong to the executing user`,
					),
				),
				Effect.forEach(input.integrationIds, (integrationId) =>
					requireOwned(
						runWithDb(integrations.getForUser({ integrationId, userId: input.userId })),
						`Kernel workflow integration '${integrationId}' does not belong to the executing user`,
					),
				),
			]);

		return {
			execute: (workflowSlug, input, authority, executionId, parentExecutionId) =>
				Effect.gen(function* () {
					if (
						workflowSlug !== KERNEL_EVENT_CREATE_WORKFLOW &&
						workflowSlug !== KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW &&
						workflowSlug !== KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW
					) {
						return yield* new SandboxRunError({
							message: `Unknown kernel workflow reference '${workflowSlug}'`,
						});
					}
					if (!("userId" in authority)) {
						return yield* new SandboxRunError({
							message: `Kernel workflow '${workflowSlug}' is not available for system executions`,
						});
					}
					const engine = yield* WorkflowEngine;
					if (workflowSlug === KERNEL_PROCESS_IMPORT_CHUNKS_WORKFLOW) {
						const payload = yield* Schema.decodeUnknown(ProcessGenericImportChunksPayload)({
							...(isObjectRecord(input) ? input : {}),
							executionId,
							userId: authority.userId,
							expectedHarvestDirectoryPrefix: path.join(
								config.tmpDir,
								`${SANDBOX_HARVEST_DIRECTORY_PREFIX}${serverRun.id}`,
								`${sanitizeSandboxExecutionSegment(parentExecutionId)}-activity-`,
							),
						}).pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({
										message: `Invalid kernel workflow input: ${unknownToMessage(error)}`,
									}),
							),
						);
						yield* validateAttribution({
							integrationIds: [],
							userId: authority.userId,
							importRunIds: [ImportRunId.make(payload.runId)],
						});
						const result = yield* engine
							.execute(ProcessGenericImportChunksWorkflow, { executionId, payload })
							.pipe(
								Effect.mapError(
									(error) => new SandboxRunError({ message: unknownToMessage(error) }),
								),
							);
						return yield* Schema.decodeUnknown(jsonValueSchema)(result).pipe(
							Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
						);
					}
					if (workflowSlug === KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW) {
						const payload = yield* Schema.decodeUnknown(EntityImportPayload)({
							...(isObjectRecord(input) ? input : {}),
							executionId,
							userId: authority.userId,
						}).pipe(
							Effect.mapError(
								(error) =>
									new SandboxRunError({
										message: `Invalid kernel workflow input: ${unknownToMessage(error)}`,
									}),
							),
						);
						yield* validateAttribution({
							userId: authority.userId,
							...attributionIds(payload.origin),
						});
						const result = yield* engine
							.execute(LibraryEntityImportWorkflow, { executionId, payload })
							.pipe(
								Effect.match({
									onFailure: (error) => ({
										stage: error.stage,
										message: error.message,
										status: "failed" as const,
									}),
									onSuccess: (entity) => ({ status: "completed" as const, entity }),
								}),
							);
						return yield* Schema.decodeUnknown(jsonValueSchema)(result).pipe(
							Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
						);
					}
					const payload = yield* Schema.decodeUnknown(EventCreateWorkflowPayload)({
						...(isObjectRecord(input) ? input : {}),
						executionId,
						userId: authority.userId,
					}).pipe(
						Effect.mapError(
							(error) =>
								new SandboxRunError({
									message: `Invalid kernel workflow input: ${unknownToMessage(error)}`,
								}),
						),
					);
					const lifecycle = attributionIds(payload.lifecycleOrigin);
					yield* validateAttribution({
						userId: authority.userId,
						importRunIds: [
							...lifecycle.importRunIds,
							...(payload.importRunId ? [payload.importRunId] : []),
						],
						integrationIds: [
							...lifecycle.integrationIds,
							...(payload.integrationId ? [payload.integrationId] : []),
						],
					});
					const result = yield* engine
						.execute(EventCreateWorkflow, { executionId, payload })
						.pipe(
							Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
						);
					return yield* Schema.decodeUnknown(jsonValueSchema)(result).pipe(
						Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
					);
				}),
		};
	}),
);
