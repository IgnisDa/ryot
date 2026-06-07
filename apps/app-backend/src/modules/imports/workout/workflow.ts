import { Activity } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { AppConfig } from "#lib/config/service";
import type { DbRunner } from "#lib/db/service";
import type { EntitiesRepository } from "#modules/entities/repository";
import type { ListedEntity } from "#modules/entities/schemas";
import type { EntitiesService } from "#modules/entities/service";
import type { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import type { EventSchemasRepository } from "#modules/event-schemas/repository";
import type { EventsService } from "#modules/events/service";

import type { ImportRunJobData } from "../jobs";
import { sanitizeErrorMessage } from "../runtime/import-run-status";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-helpers";
import { adaptHevyCsv } from "../sources/hevy/adapter";
import { adaptStrongAppCsv } from "../sources/strong-app/adapter";
import {
	type NonMediaItemOutcome,
	type NonMediaPrepareWritesEffect,
	loadNonMediaImportText,
} from "../workflows-non-media";
import type { WorkoutImportItem } from "./domain";
import { commitWorkoutItem, loadWorkoutImportContext } from "./processor";

export const loadHevyWorkoutAdapterResult = Effect.fn("imports.loadHevyWorkoutAdapterResult")(
	function* (payload: ImportRunJobData) {
		const config = yield* AppConfig;
		const { text, cleanupPaths } = yield* loadNonMediaImportText(payload);
		const result = yield* Effect.try({
			try: () => adaptHevyCsv(text, config.timezone),
			catch: (error) => ({
				cleanupPaths,
				message: sanitizeErrorMessage(error, "Could not parse Hevy CSV"),
			}),
		});
		return { cleanupPaths, items: result.items, failures: result.failures };
	},
);

export const loadStrongAppWorkoutAdapterResult = Effect.fn(
	"imports.loadStrongAppWorkoutAdapterResult",
)(function* (payload: ImportRunJobData) {
	const config = yield* AppConfig;
	const { text, cleanupPaths } = yield* loadNonMediaImportText(payload);
	const result = yield* Effect.try({
		try: () => adaptStrongAppCsv(text, config.timezone),
		catch: (error) => ({
			cleanupPaths,
			message: sanitizeErrorMessage(error, "Could not parse StrongApp CSV"),
		}),
	});
	return { cleanupPaths, items: result.items, failures: result.failures };
});

export const prepareWorkoutWrites = (
	payload: ImportRunJobData,
): NonMediaPrepareWritesEffect<
	WorkoutImportItem,
	EntitiesService | EventsService | WorkflowEngine | WorkflowInstance,
	DbRunner | EntitiesRepository | EventSchemasRepository | EntitySchemasRepository
> =>
	Effect.gen(function* () {
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
						schemas,
						candidates,
						workout: item,
						exerciseCache,
						runId: payload.runId,
						executionId: `${payload.runId}-workout-${index}`,
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
