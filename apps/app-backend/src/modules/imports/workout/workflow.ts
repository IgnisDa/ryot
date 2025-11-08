import { Activity } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { AppConfig } from "#lib/config";
import type { DbRunner } from "#lib/db";
import type { EntitiesRepository } from "#modules/entities/repository";
import type { ListedEntity } from "#modules/entities/schemas";
import { EntitiesService } from "#modules/entities/service";
import type { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import type { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsService } from "#modules/events/service";

import type { ImportRunJobData } from "../jobs";
import { sanitizeErrorMessage } from "../runtime/failures";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-helpers";
import {
	type NonMediaItemOutcome,
	type NonMediaPrepareResult,
	loadNonMediaImportText,
} from "../workflows-non-media";
import type { WorkoutAdapterResult, WorkoutImportItem } from "./domain";
import { commitWorkoutItem, loadWorkoutImportContext } from "./processor";

export const loadWorkoutAdapterResult =
	(input: {
		sourceName: string;
		adapt: (csvText: string, timezone: string) => WorkoutAdapterResult;
	}) =>
	(payload: ImportRunJobData) =>
		Effect.gen(function* () {
			const config = yield* AppConfig;
			const { text, cleanupPaths } = yield* loadNonMediaImportText(payload);
			const result = yield* Effect.try({
				try: () => input.adapt(text, config.timezone),
				catch: (error) => ({
					cleanupPaths,
					message: sanitizeErrorMessage(error, `Could not parse ${input.sourceName} CSV`),
				}),
			});
			return { cleanupPaths, items: result.items, failures: result.failures };
		});

export const prepareWorkoutWrites = (
	payload: ImportRunJobData,
): Effect.Effect<
	NonMediaPrepareResult<
		WorkoutImportItem,
		EntitiesService | EventsService | WorkflowEngine | WorkflowInstance
	>,
	ImportRunError,
	| DbRunner
	| EventsService
	| EntitiesService
	| EntitiesRepository
	| EventSchemasRepository
	| EntitySchemasRepository
> =>
	Effect.gen(function* () {
		const events = yield* EventsService;
		const entities = yield* EntitiesService;
		const user: CurrentUserValue = { id: payload.userId, name: "", email: "" };

		const context = yield* loadWorkoutImportContext(payload.userId).pipe(
			Effect.mapError(toWorkflowError),
		);
		if (!context) {
			return { _tag: "failed", message: "Workout import schemas are missing" };
		}

		const { schemas, candidates } = context;
		const exerciseCache = new Map<string, ListedEntity>();

		return {
			_tag: "ready",
			writeItem: ({ item, index }) =>
				Activity.make({
					error: ImportRunError,
					name: `import-workout-item-${index}`,
					execute: commitWorkoutItem({
						user,
						events,
						schemas,
						entities,
						candidates,
						workout: item,
						exerciseCache,
						runId: payload.runId,
					}).pipe(Effect.asVoid, Effect.mapError(toWorkflowError)),
				}).pipe(
					Effect.as({ _tag: "imported" } satisfies NonMediaItemOutcome),
					Effect.catchAll((error) =>
						Effect.succeed({
							_tag: "failed",
							message: error.message,
							stage: "database_commit",
							entitySchemaSlug: "workout",
						} satisfies NonMediaItemOutcome),
					),
				),
		};
	});
