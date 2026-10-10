import { defineAutomation, type AutomationInput } from "@ryot-app/plugin-backend-sdk/automation";
import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	EventStreamStepInput,
	EventStreamStepOutput,
	kernelDispatch,
} from "@ryot-app/plugin-backend-sdk/event-streams";
import { executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";
import { defineScriptReference } from "@ryot-app/plugin-backend-sdk/workflow";

import {
	existingExerciseIdsRecipe,
	workoutSetExerciseIdsRecipe,
} from "../../shared/workout-record-recipes";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	name: "Recompute workout records",
	slug: "automation.workout-records",
	inputProjection: {
		entity: {
			properties: [],
			parentEntityProperties: [],
			compareProperties: [{ equality: "json", property: "startedAt" }],
		},
		event: {
			properties: [],
			compareProperties: [
				{ equality: "json", property: "confirmedAt" },
				{ equality: "json", property: "distance" },
				{ equality: "json", property: "duration" },
				{ equality: "json", property: "exerciseKind" },
				{ equality: "json", property: "exerciseOrder" },
				{ property: "reps", equality: "json" },
				{ equality: "json", property: "setOrder" },
				{ equality: "json", property: "weight" },
			],
		},
	},
});

const recordStepReference = defineScriptReference({
	input: EventStreamStepInput,
	output: EventStreamStepOutput,
	scriptSlug: "script.workout-record-step",
});

const workoutSetSchemaSlug = Schema.decodeSync(EventStreamStepInput.fields.eventSchemaSlug)(
	"workout-set",
);

class WorkoutRecordAutomationError extends Error {
	readonly _tag = "WorkoutRecordAutomationError";
}

type EntityUpdate = Extract<
	AutomationInput["automation"]["payload"],
	{ operation: "update"; resource: "entity" }
>;
type AutomationHost = Pick<
	ScriptHost,
	"executeRyotql" | "executeWorkflow" | "requestEventStreamWork"
>;

type EventBatchItem = Extract<
	AutomationInput["automation"]["payload"],
	{ operation: "batch"; resource: "event" }
>["items"][number];
type EventSnapshot = Extract<EventBatchItem, { operation: "create" }>["after"];

const snapshotsOf = (item: EventBatchItem): readonly EventSnapshot[] => {
	if (item.operation === "create") {
		return [item.after];
	}
	if (item.operation === "delete") {
		return [item.before];
	}
	return [item.before, item.after];
};

const runWorkoutStartChange = (workout: EntityUpdate, host: AutomationHost) =>
	Effect.gen(function* () {
		if (
			workout.after.entitySchemaSlug !== "workout" ||
			!workout.changedProperties.includes("startedAt")
		) {
			return null;
		}

		let after: string | undefined;
		let hasMore: boolean;
		do {
			const page = yield* executeRyotqlRecipe(
				host.executeRyotql,
				workoutSetExerciseIdsRecipe({
					after,
					reference: { kind: "self" },
					workoutId: workout.after.id,
				}),
			);
			const exerciseIds = new Set(page.items.map(({ entityId }) => entityId));
			for (const entityId of exerciseIds) {
				if (!("executeWorkflow" in host)) {
					return yield* Effect.fail(
						new WorkoutRecordAutomationError("Workout record stream requires workflow dispatch"),
					);
				}
				const work = yield* host.requestEventStreamWork(
					{ entityId, eventSchemaSlug: workoutSetSchemaSlug },
					recordStepReference,
				);
				const dispatch = host.executeWorkflow?.(
					`workout-start-records:${workout.after.id}:${entityId}`,
					kernelDispatch,
					{ id: work.workId },
				);
				if (dispatch === undefined) {
					return yield* Effect.fail(
						new WorkoutRecordAutomationError("Workout record stream requires workflow dispatch"),
					);
				}
				yield* dispatch;
			}
			hasMore = page.pageInfo.hasMore;
			if (hasMore && page.pageInfo.nextCursor === null) {
				return yield* Effect.fail(
					new WorkoutRecordAutomationError("Workout set exercise page is missing its cursor"),
				);
			}
			after = page.pageInfo.nextCursor ?? undefined;
		} while (hasMore);
		return null;
	});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) =>
		Effect.gen(function* () {
			const payload = automation.payload;
			if (payload.resource === "entity" && payload.operation === "update") {
				return yield* runWorkoutStartChange(payload, host);
			}
			if (payload.resource !== "event" || payload.operation !== "batch") {
				return null;
			}
			const items = payload.items;
			const streams = new Map<EventSnapshot["entityId"], EventSnapshot["eventSchemaSlug"]>();
			for (const item of items) {
				for (const event of snapshotsOf(item)) {
					if (event.entitySchemaSlug !== "exercise" || event.eventSchemaSlug !== "workout-set") {
						continue;
					}
					streams.set(event.entityId, event.eventSchemaSlug);
				}
			}
			if (streams.size === 0) {
				return null;
			}
			if (!("executeWorkflow" in host)) {
				return yield* Effect.fail(
					new WorkoutRecordAutomationError("Workout record stream requires workflow dispatch"),
				);
			}
			const existingExercises = yield* executeRyotqlRecipe(
				host.executeRyotql,
				existingExerciseIdsRecipe({
					reference: { kind: "self" },
					exerciseIds: [...streams.keys()],
				}),
			);
			const existingExerciseIds = new Set(existingExercises);

			for (const [entityId, eventSchemaSlug] of streams) {
				if (!existingExerciseIds.has(entityId)) {
					continue;
				}
				const work = yield* host.requestEventStreamWork(
					{ entityId, eventSchemaSlug },
					recordStepReference,
				);
				const dispatch = host.executeWorkflow?.(`workout-records:${entityId}`, kernelDispatch, {
					id: work.workId,
				});
				if (dispatch === undefined) {
					return yield* Effect.fail(
						new WorkoutRecordAutomationError("Workout record stream requires workflow dispatch"),
					);
				}
				yield* dispatch;
			}
			return null;
		}),
});
