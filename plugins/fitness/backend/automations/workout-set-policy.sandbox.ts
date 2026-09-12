import {
	automationPolicyResultSchema,
	defineAutomationPolicy,
	type AutomationPolicyInput,
} from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";

import type { ExerciseKind } from "../../shared/exercise-kinds";
import { workoutSetContextRecipe } from "../../shared/workout-record-recipes";
import {
	calculateWorkoutSetStatistics,
	normalizeWorkoutMeasurements,
	WorkoutSetMeasurementsSchema,
} from "../../shared/workout-records";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "policy",
	slug: "policy.workout-set",
	name: "Normalize workout sets",
	inputProjection: {
		event: {
			properties: [
				"confirmedAt",
				"distance",
				"duration",
				"oneRm",
				"pace",
				"personalBests",
				"reps",
				"unitSystem",
				"volume",
				"weight",
			],
		},
	},
});

type EventPayload = Extract<AutomationPolicyInput["automation"]["payload"], { resource: "event" }>;

const derivedKeys = ["personalBests", "oneRm", "volume", "pace"] as const;
const derivedKeySet = new Set<string>(derivedKeys);

const allow = () => Schema.decodeSync(automationPolicyResultSchema)({ action: "allow" });

const reject = (reason: string) =>
	Schema.decodeSync(automationPolicyResultSchema)({ reason, action: "reject" });

const sameJsonValue = (left: unknown, right: unknown) =>
	left === right ||
	(Array.isArray(left) &&
		Array.isArray(right) &&
		left.length === right.length &&
		left.every((value, index) => value === right[index]));

const isOwnDerivedOutputUpdate = (eventStreamWorkId: string | undefined, payload: EventPayload) =>
	payload.operation === "update" &&
	eventStreamWorkId !== undefined &&
	payload.changedProperties.length > 0 &&
	payload.changedProperties.every((property) => derivedKeySet.has(property)) &&
	payload.before.entityId === payload.draft.entityId &&
	payload.before.entitySchemaSlug === payload.draft.entitySchemaSlug &&
	payload.before.eventSchemaSlug === payload.draft.eventSchemaSlug &&
	payload.before.sessionEntityId === payload.draft.sessionEntityId &&
	payload.before.occurredAt === payload.draft.occurredAt &&
	payload.before.properties["confirmedAt"] === payload.draft.properties["confirmedAt"];

const finiteMeasurements = (properties: Readonly<Record<string, unknown>>) =>
	Schema.decodeUnknownResult(WorkoutSetMeasurementsSchema)({
		reps: properties["reps"],
		weight: properties["weight"],
		distance: properties["distance"],
		duration: properties["duration"],
	});

const metricMeasurement = (value: number | undefined, unitSystem: unknown, factor: number) => {
	if (value === undefined) {
		return undefined;
	}
	return unitSystem === "imperial" ? value * factor : value;
};

const setProperty = (
	properties: Readonly<Record<string, unknown>>,
	set: Record<string, number | string>,
	key: string,
	value: number | string,
) => {
	if (!sameJsonValue(properties[key], value)) {
		set[key] = value;
	}
};

const transformSet = (properties: Readonly<Record<string, unknown>>, kind: ExerciseKind) => {
	const unitSystem = properties["unitSystem"];
	if (unitSystem !== undefined && unitSystem !== "metric" && unitSystem !== "imperial") {
		return reject("workout_set_unit_system_invalid");
	}
	const measurementsResult = finiteMeasurements(properties);
	if (measurementsResult._tag === "Failure") {
		return reject("workout_set_measurements_invalid");
	}
	const source = measurementsResult.success;
	const metric = normalizeWorkoutMeasurements({
		reps: source.reps,
		duration: source.duration,
		weight: metricMeasurement(source.weight, unitSystem, 0.45359237),
		distance: metricMeasurement(source.distance, unitSystem, 1.609344),
	});
	const statistics = calculateWorkoutSetStatistics(kind, metric);
	const set: Record<string, number | string> = {};
	const remove: string[] = [];
	setProperty(properties, set, "unitSystem", "metric");
	for (const key of ["reps", "weight", "duration", "distance"] as const) {
		const value = metric[key];
		if (value !== undefined) {
			setProperty(properties, set, key, value);
		}
	}
	for (const [key, value] of [
		["oneRm", statistics.oneRm],
		["volume", statistics.volume],
		["pace", statistics.pace],
	] as const) {
		if (value === undefined) {
			if (Object.hasOwn(properties, key)) {
				remove.push(key);
			}
		} else {
			setProperty(properties, set, key, value);
		}
	}
	if (Object.hasOwn(properties, "personalBests")) {
		remove.push("personalBests");
	}
	return Object.keys(set).length === 0 && remove.length === 0
		? allow()
		: Schema.decodeSync(automationPolicyResultSchema)({
				action: "transform",
				patch: { resource: "event", draft: { properties: { set, remove } } },
			});
};

export default defineAutomationPolicy({
	manifest,
	run: ({ automation }, host) => {
		const payload = automation.payload;
		if (
			payload.resource !== "event" ||
			(payload.operation !== "create" && payload.operation !== "update")
		) {
			return Effect.succeed(allow());
		}
		if (
			payload.draft.entitySchemaSlug !== "exercise" ||
			payload.draft.eventSchemaSlug !== "workout-set"
		) {
			return Effect.succeed(allow());
		}
		if (isOwnDerivedOutputUpdate(automation.causation.eventStreamWorkId, payload)) {
			return Effect.succeed(allow());
		}
		const workoutId = payload.draft.sessionEntityId;
		if (workoutId === null) {
			return Effect.succeed(reject("workout_set_context_missing"));
		}
		return Effect.gen(function* () {
			const context = yield* executeRyotqlRecipe(
				host.executeRyotql,
				workoutSetContextRecipe({ workoutId, exerciseId: payload.draft.entityId }),
			);
			const exerciseKind = context.exercise?.kind;
			if (
				exerciseKind === undefined ||
				exerciseKind === null ||
				context.workout === null ||
				context.workout.startedAt === null
			) {
				return reject("workout_set_context_missing");
			}
			return transformSet(payload.draft.properties, exerciseKind);
		});
	},
});
