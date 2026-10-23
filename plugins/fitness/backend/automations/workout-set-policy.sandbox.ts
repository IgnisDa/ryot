import {
	type AutomationPolicyInput,
	type AutomationPolicyResult,
	defineAutomationPolicy,
} from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { IsoDateString } from "@ryot-app/plugin-backend-sdk/ryotql";

import { exerciseKindSchema } from "../../shared/exercise-kinds";
import { WorkoutSetMeasurementsSchema } from "../../shared/workout-records";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "policy",
	slug: "policy.workout-set",
	name: "Validate workout sets",
	inputProjection: {
		event: {
			entityProperties: ["kind"],
			sessionEntityProperties: ["startedAt"],
			properties: ["confirmedAt", "distance", "duration", "exerciseKind", "reps", "weight"],
		},
	},
});

const validate = ({ automation }: AutomationPolicyInput): AutomationPolicyResult => {
	const payload = automation.payload;
	if (
		payload.resource !== "event" ||
		payload.operation === "delete" ||
		payload.draft.entitySchemaSlug !== "exercise" ||
		payload.draft.eventSchemaSlug !== "workout-set"
	) {
		return { action: "allow" };
	}
	const draft = payload.draft;
	const workout =
		draft.sessionEntityId === null ? undefined : automation.references?.[draft.sessionEntityId];
	const exercise = automation.references?.[draft.entityId];
	if (
		exercise?.entitySchemaSlug !== "exercise" ||
		exercise.entitySchemaPluginId !== draft.eventSchemaPluginId ||
		workout?.entitySchemaSlug !== "workout" ||
		workout.entitySchemaPluginId !== draft.eventSchemaPluginId ||
		Schema.decodeUnknownResult(IsoDateString)(workout.properties["startedAt"])._tag === "Failure"
	) {
		return { action: "reject", reason: "workout_set_context_missing" };
	}
	const kind = draft.properties["exerciseKind"] ?? exercise.properties["kind"];
	const decodedKind = Schema.decodeUnknownResult(exerciseKindSchema)(kind);
	if (decodedKind._tag === "Failure") {
		return {
			action: "reject",
			reason:
				kind === undefined ? "workout_set_context_missing" : "workout_set_exercise_kind_invalid",
		};
	}
	const measurements = Schema.decodeUnknownResult(WorkoutSetMeasurementsSchema)({
		reps: draft.properties["reps"],
		weight: draft.properties["weight"],
		distance: draft.properties["distance"],
		duration: draft.properties["duration"],
	});
	if (measurements._tag === "Failure") {
		return { action: "reject", reason: "workout_set_measurements_invalid" };
	}
	const confirmedAt = draft.properties["confirmedAt"];
	const confirmed =
		confirmedAt === undefined || confirmedAt === null
			? undefined
			: Schema.decodeUnknownResult(IsoDateString)(confirmedAt);
	if (confirmed?._tag === "Failure") {
		return { action: "reject", reason: "workout_set_confirmed_at_invalid" };
	}
	const occurredAt = confirmed?.success;
	const properties =
		draft.properties["exerciseKind"] === decodedKind.success
			? undefined
			: { remove: [], set: { exerciseKind: decodedKind.success } };
	if (!properties && (occurredAt === undefined || occurredAt === draft.occurredAt)) {
		return { action: "allow" };
	}
	return {
		action: "transform",
		patch: {
			resource: "event",
			draft: {
				...(properties ? { properties } : {}),
				...(occurredAt === undefined || occurredAt === draft.occurredAt ? {} : { occurredAt }),
			},
		},
	};
};

export default defineAutomationPolicy({
	manifest,
	run: ({ items, automation }) =>
		Effect.succeed({
			items: items.map(({ payload, itemIdentity }) => ({
				itemIdentity,
				decision: validate({ automation: { ...automation, payload } }),
			})),
		}),
});
