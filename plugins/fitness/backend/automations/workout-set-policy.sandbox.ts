import {
	type AutomationPolicyInput,
	type AutomationPolicyResult,
	defineAutomationPolicy,
} from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { IsoDateString } from "@ryot-app/plugin-backend-sdk/ryotql";

import { exerciseKindSchema } from "../../shared/exercise-kinds";
import { catalogMessage } from "../../shared/messages.generated";
import { WorkoutSetMeasurementsSchema } from "../../shared/workout-records";
import { workoutEventExercise } from "./workout-event-exercise";

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
	const exercise = workoutEventExercise(automation, draft);
	if (exercise === undefined) {
		return { action: "reject", reason: catalogMessage("rejection.workout-set.context-missing") };
	}
	const kind = draft.properties["exerciseKind"] ?? exercise.properties["kind"];
	const decodedKind = Schema.decodeUnknownResult(exerciseKindSchema)(kind);
	if (decodedKind._tag === "Failure") {
		return {
			action: "reject",
			reason:
				kind === undefined
					? catalogMessage("rejection.workout-set.context-missing")
					: catalogMessage("rejection.workout-set.exercise-kind-invalid"),
		};
	}
	const measurements = Schema.decodeUnknownResult(WorkoutSetMeasurementsSchema)({
		reps: draft.properties["reps"],
		weight: draft.properties["weight"],
		distance: draft.properties["distance"],
		duration: draft.properties["duration"],
	});
	if (measurements._tag === "Failure") {
		return {
			action: "reject",
			reason: catalogMessage("rejection.workout-set.measurements-invalid"),
		};
	}
	const confirmedAt = draft.properties["confirmedAt"];
	const confirmed =
		confirmedAt === undefined || confirmedAt === null
			? undefined
			: Schema.decodeUnknownResult(IsoDateString)(confirmedAt);
	if (confirmed?._tag === "Failure") {
		return {
			action: "reject",
			reason: catalogMessage("rejection.workout-set.confirmed-at-invalid"),
		};
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
