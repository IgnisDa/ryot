import { Activity } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Schema } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { DbRunner } from "#lib/db";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";

import type { ImportRunJobData } from "../jobs";
import { sanitizeErrorMessage } from "../runtime/failures";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-helpers";
import { adaptOpenScaleCsv } from "../sources/open-scale/adapter";
import {
	type NonMediaItemOutcome,
	type NonMediaPrepareResult,
	loadNonMediaImportText,
} from "../workflows-non-media";

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

export const loadOpenScaleAdapterResult = (payload: ImportRunJobData) =>
	Effect.gen(function* () {
		const { text, cleanupPaths } = yield* loadNonMediaImportText(payload);
		const result = yield* Effect.try({
			try: () => adaptOpenScaleCsv(text),
			catch: (error) => ({
				cleanupPaths,
				message: sanitizeErrorMessage(error, "Could not parse OpenScale CSV"),
			}),
		});
		return { cleanupPaths, items: result.items, failures: result.failures };
	});

export const prepareOpenScaleWrites = (
	payload: ImportRunJobData,
): Effect.Effect<
	NonMediaPrepareResult<OpenScaleImportItem, EntitiesService | WorkflowEngine | WorkflowInstance>,
	ImportRunError,
	DbRunner | EntitiesService | EntitySchemasRepository | WorkflowEngine | WorkflowInstance
> =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const entities = yield* EntitiesService;
		const entitySchemas = yield* EntitySchemasRepository;
		const user: CurrentUserValue = { id: payload.userId, name: "", email: "" };

		const measurementSchemaId = yield* Activity.make({
			error: ImportRunError,
			success: Schema.NullOr(Schema.String),
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
					name: `import-measurement-${index}`,
					execute: entities
						.create(user, {
							properties: item.properties,
							entitySchemaId: measurementSchemaId,
							name: `Measurement - ${item.sourceLabel}`,
						})
						.pipe(Effect.asVoid, Effect.mapError(toWorkflowError)),
				}).pipe(
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
