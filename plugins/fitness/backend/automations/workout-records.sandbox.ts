import { defineAutomation, type AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import {
	EventStreamStepInput,
	EventStreamStepOutput,
	kernelDispatch,
} from "@ryot-app/sandbox-sdk/event-streams";
import { executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";
import { defineScriptReference } from "@ryot-app/sandbox-sdk/workflow";

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
				{ equality: "json", property: "oneRm" },
				{ property: "pace", equality: "json" },
				{ equality: "json", property: "personalBests" },
				{ property: "reps", equality: "json" },
				{ equality: "json", property: "setOrder" },
				{ equality: "json", property: "volume" },
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

const outputProperties = ["personalBests", "oneRm", "volume", "pace"] as const;
const outputPropertySet = new Set<string>(outputProperties);
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

const isOwnDerivedOutputUpdate = (item: EventBatchItem, eventStreamWorkId: string | undefined) =>
	item.operation === "update" &&
	eventStreamWorkId !== undefined &&
	item.changedProperties.length > 0 &&
	item.changedProperties.every((property) => outputPropertySet.has(property)) &&
	item.before.id === item.after.id &&
	item.before.entityId === item.after.entityId &&
	item.before.entitySchemaSlug === item.after.entitySchemaSlug &&
	item.before.eventSchemaSlug === item.after.eventSchemaSlug &&
	item.before.sessionEntityId === item.after.sessionEntityId &&
	item.before.occurredAt === item.after.occurredAt;

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
				workoutSetExerciseIdsRecipe({ after, workoutId: workout.after.id }),
			);
			const exerciseIds = new Set(page.items.map(({ entityId }) => entityId));
			for (const entityId of exerciseIds) {
				if (!("executeWorkflow" in host)) {
					return yield* Effect.fail(
						new WorkoutRecordAutomationError("Workout record stream requires workflow dispatch"),
					);
				}
				const work = yield* host.requestEventStreamWork(
					{ entityId, outputProperties, eventSchemaSlug: workoutSetSchemaSlug },
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
			if (
				automation.causation.eventStreamWorkId !== undefined &&
				items.every((item) =>
					isOwnDerivedOutputUpdate(item, automation.causation.eventStreamWorkId),
				)
			) {
				return null;
			}

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
				existingExerciseIdsRecipe({ exerciseIds: [...streams.keys()] }),
			);
			const existingExerciseIds = new Set(existingExercises);

			for (const [entityId, eventSchemaSlug] of streams) {
				if (!existingExerciseIds.has(entityId)) {
					continue;
				}
				const work = yield* host.requestEventStreamWork(
					{ entityId, eventSchemaSlug, outputProperties },
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
