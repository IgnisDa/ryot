import { Activity } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { CreateEventItem } from "@ryot/contract/modules/events/schemas";
import { Effect, Schema } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import type { DbRunner } from "#lib/infrastructure/db/service";
import type { AutomationsRepository } from "#modules/automations/repository";
import { defaultUserPreferences } from "#modules/builtins/bootstrap";
import type { EntitiesRepository } from "#modules/entities/repository";
import type { EntitiesService } from "#modules/entities/service";
import type { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import type { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsService } from "#modules/events/service";

import type { ImportRunJobData } from "../jobs";
import type { NonMediaItemOutcome, NonMediaPrepareWritesEffect } from "../non-media-types";
import { loadNonMediaImportText } from "../non-media-workflow";
import { dispatchImportEntityCreateOccurrence } from "../runtime/import-entity-lifecycle-workflow";
import { sanitizeErrorMessage } from "../runtime/import-run-status";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-helpers";
import { adaptHevyCsv } from "../sources/hevy/adapter";
import { adaptStrongAppCsv } from "../sources/strong-app/adapter";
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

const CommitWorkoutItemResultSchema = Schema.Struct({
	events: Schema.Array(CreateEventItem),
	entityMutations: Schema.Array(
		Schema.Struct({
			entity: ListedEntity,
			entitySchemaSlug: Schema.Literal("exercise", "workout"),
		}),
	),
});

export const prepareWorkoutWrites = (
	payload: ImportRunJobData,
): NonMediaPrepareWritesEffect<
	WorkoutImportItem,
	| DbRunner
	| EventsService
	| WorkflowEngine
	| EntitiesService
	| WorkflowInstance
	| AutomationsRepository,
	DbRunner | EntitiesRepository | EventSchemasRepository | EntitySchemasRepository | EventsService
> =>
	Effect.gen(function* () {
		const events = yield* EventsService;
		const user: CurrentUserValue = {
			name: "",
			email: "",
			id: payload.userId,
			preferences: defaultUserPreferences,
		};

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
					success: CommitWorkoutItemResultSchema,
					execute: commitWorkoutItem({
						user,
						schemas,
						candidates,
						workout: item,
						exerciseCache,
					}).pipe(Effect.mapError(toWorkflowError)),
				}).pipe(
					Effect.flatMap((result) =>
						Effect.gen(function* () {
							for (const mutation of result.entityMutations) {
								yield* dispatchImportEntityCreateOccurrence({
									userId: user.id,
									entity: mutation.entity,
									importRunId: payload.runId,
									entitySchemaSlug: mutation.entitySchemaSlug,
								});
							}
							yield* events.create({
								userId: user.id,
								source: "import",
								payload: [...result.events],
								executionId: `${payload.runId}-workout-${index}`,
								metadata: { importRunId: payload.runId },
							});
						}),
					),
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
