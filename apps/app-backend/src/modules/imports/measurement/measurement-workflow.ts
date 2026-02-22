import { Activity } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { EntitySchemaId } from "@ryot/contract/schema/brands";
import { Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import type { AutomationsRepository } from "#modules/automations/repository";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";

import type { ImportRunJobData } from "../jobs";
import type { NonMediaItemOutcome, NonMediaPrepareWritesEffect } from "../non-media-types";
import { loadNonMediaImportText } from "../non-media-workflow";
import { dispatchImportEntityCreateOccurrence } from "../runtime/import-entity-lifecycle-workflow";
import { sanitizeErrorMessage } from "../runtime/import-run-status";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-helpers";
import { adaptOpenScaleCsv } from "../sources/open-scale/adapter";

export const OpenScaleImportItemSchema = Schema.Struct({
	itemIndex: Schema.Number,
	sourceLabel: Schema.String,
	sourceIdentifier: Schema.String,
	properties: Schema.Struct({
		recordedAt: Schema.String,
		comment: Schema.optional(Schema.NullOr(Schema.String)),
		statistics: Schema.Array(
			Schema.Struct({ key: Schema.String, label: Schema.String, value: Schema.Number }),
		),
	}),
});

export type OpenScaleImportItem = typeof OpenScaleImportItemSchema.Type;

export const loadOpenScaleAdapterResult = Effect.fn("imports.loadOpenScaleAdapterResult")(
	function* (payload: ImportRunJobData) {
		const { text, cleanupPaths } = yield* loadNonMediaImportText(payload);
		const result = yield* Effect.try({
			try: () => adaptOpenScaleCsv(text),
			catch: (error) => ({
				cleanupPaths,
				message: sanitizeErrorMessage(error, "Could not parse OpenScale CSV"),
			}),
		});
		return { cleanupPaths, items: result.items, failures: result.failures };
	},
);

const MeasurementWriteResult = Schema.Struct({
	entity: ListedEntity,
	entitySchemaSlug: Schema.String,
	operation: Schema.Literal("create", "update", "noop"),
});

export const prepareOpenScaleWrites = (
	payload: ImportRunJobData,
): NonMediaPrepareWritesEffect<
	OpenScaleImportItem,
	DbRunner | WorkflowEngine | EntitiesService | WorkflowInstance | AutomationsRepository,
	DbRunner | EntitiesService | EntitySchemasRepository | WorkflowEngine | WorkflowInstance
> =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const entities = yield* EntitiesService;
		const entitySchemas = yield* EntitySchemasRepository;

		const measurementSchemaId = yield* Activity.make({
			error: ImportRunError,
			success: Schema.NullOr(EntitySchemaId),
			name: "load-measurement-entity-schema",
			execute: runWithDb(entitySchemas.getBuiltinBySlug("measurement")).pipe(
				Effect.map((schema) => schema?.id ?? null),
				Effect.mapError(toWorkflowError),
			),
		});

		if (!measurementSchemaId) {
			return { _tag: "failed", message: "Measurement entity schema not found" };
		}

		return {
			_tag: "ready",
			writeItem: ({ item, index }) =>
				Activity.make({
					error: ImportRunError,
					success: MeasurementWriteResult,
					name: `import-measurement-${index}`,
					execute: entities
						.create(payload.userId, {
							properties: item.properties,
							entitySchemaId: measurementSchemaId,
							name: `Measurement - ${item.sourceLabel}`,
						})
						.pipe(Effect.mapError(toWorkflowError)),
				}).pipe(
					Effect.flatMap((result) =>
						result.operation === "create"
							? dispatchImportEntityCreateOccurrence({
									entity: result.entity,
									userId: payload.userId,
									importRunId: payload.runId,
									entitySchemaSlug: result.entitySchemaSlug,
								})
							: Effect.void,
					),
					Effect.as({ _tag: "imported" } satisfies NonMediaItemOutcome),
					Effect.catchAll((error) =>
						Effect.succeed({
							_tag: "failed",
							message: error.message,
							stage: "database_commit",
							entitySchemaSlug: "measurement",
						} satisfies NonMediaItemOutcome),
					),
				),
		};
	});
