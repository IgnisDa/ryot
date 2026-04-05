import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError, unknownToMessage } from "@ryot/contract/errors";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { Effect, Layer, Schema } from "effect";

import { EntityImportPayload } from "#modules/entity-import/entity-import-workflow";
import {
	EventCreateWorkflow,
	EventCreateWorkflowPayload,
} from "#modules/events/event-create-workflow";
import { LibraryEntityImportWorkflow } from "#modules/library-membership/library-entity-import-workflow";
import {
	KERNEL_EVENT_CREATE_WORKFLOW,
	KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW,
	KernelWorkflowReferences,
} from "#modules/sandbox/kernel-workflow-references";

export const KernelWorkflowReferencesLive = Layer.succeed(KernelWorkflowReferences, {
	execute: (workflowSlug, input, authority, executionId) =>
		Effect.gen(function* () {
			if (
				workflowSlug !== KERNEL_EVENT_CREATE_WORKFLOW &&
				workflowSlug !== KERNEL_LIBRARY_ENTITY_IMPORT_WORKFLOW
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
			const result = yield* engine
				.execute(EventCreateWorkflow, { executionId, payload })
				.pipe(
					Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
				);
			return yield* Schema.decodeUnknown(jsonValueSchema)(result).pipe(
				Effect.mapError((error) => new SandboxRunError({ message: unknownToMessage(error) })),
			);
		}),
});
