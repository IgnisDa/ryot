import { IsoDateString } from "@ryot-app/plugin-kit/ryotql";
import {
	automationPolicyResultSchema,
	defineAutomationPolicy,
	type AutomationPolicyInput,
} from "@ryot-app/sandbox-sdk/automation";
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";

import { exerciseKinds } from "../../shared/exercise-kinds";
import { workoutSetContextRecipe } from "../../shared/workout-record-recipes";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "policy",
	slug: "policy.workout-context",
	name: "Workout set context policy",
	inputProjection: {
		event: { properties: ["confirmedAt"] },
		entity: { properties: ["kind", "startedAt"] },
	},
});

type AutomationHost = Pick<ScriptHost, "executeRyotql">;
type EventPayload = Extract<AutomationPolicyInput["automation"]["payload"], { resource: "event" }>;
type EntityUpdatePayload = Extract<
	AutomationPolicyInput["automation"]["payload"],
	{ operation: "update"; resource: "entity" }
>;

const allow = () => Schema.decodeSync(automationPolicyResultSchema)({ action: "allow" });

const reject = (reason: string) =>
	Schema.decodeSync(automationPolicyResultSchema)({ reason, action: "reject" });

const patchOccurredAt = (occurredAt: string) =>
	Schema.decodeSync(automationPolicyResultSchema)({
		action: "transform",
		patch: { resource: "event", draft: { occurredAt } },
	});

const eventContextPolicy = (host: AutomationHost, payload: EventPayload) =>
	Effect.gen(function* () {
		if (
			(payload.operation !== "create" && payload.operation !== "update") ||
			payload.draft.entitySchemaSlug !== "exercise" ||
			payload.draft.eventSchemaSlug !== "workout-set"
		) {
			return allow();
		}
		const workoutId = payload.draft.sessionEntityId;
		if (workoutId === null) {
			return reject("workout_set_context_missing");
		}
		const context = yield* executeRyotqlRecipe(
			host.executeRyotql,
			workoutSetContextRecipe({ workoutId, exerciseId: payload.draft.entityId }),
		);
		const startedAt = context.workout?.startedAt;
		const exerciseKind = context.exercise?.kind;
		if (
			exerciseKind === undefined ||
			exerciseKind === null ||
			startedAt === null ||
			startedAt === undefined
		) {
			return reject("workout_set_context_missing");
		}

		const confirmedAt = payload.draft.properties["confirmedAt"];
		let occurredAt = startedAt;
		if (confirmedAt !== undefined && confirmedAt !== null) {
			if (typeof confirmedAt !== "string") {
				return reject("workout_set_confirmed_at_invalid");
			}
			const decoded = Schema.decodeResult(IsoDateString)(confirmedAt);
			if (decoded._tag === "Failure") {
				return reject("workout_set_confirmed_at_invalid");
			}
			occurredAt = decoded.success;
		}
		return payload.draft.occurredAt === occurredAt ? allow() : patchOccurredAt(occurredAt);
	});

const hasInvalidRequiredContext = (payload: EntityUpdatePayload) => {
	const property = payload.draft.entitySchemaSlug === "exercise" ? "kind" : "startedAt";
	if (!payload.changedProperties.includes(property)) {
		return false;
	}
	const value = payload.draft.properties[property];
	return property === "kind"
		? typeof value !== "string" || !exerciseKinds.some((kind) => kind === value)
		: typeof value !== "string" || Schema.decodeResult(IsoDateString)(value)._tag === "Failure";
};

const entityReferencePolicy = (payload: EntityUpdatePayload) => {
	const entitySchemaSlug = payload.draft.entitySchemaSlug;
	if (
		(entitySchemaSlug !== "exercise" && entitySchemaSlug !== "workout") ||
		!hasInvalidRequiredContext(payload)
	) {
		return Effect.succeed(allow());
	}
	const role = entitySchemaSlug === "exercise" ? "entity" : "session";
	const hasWorkoutSets = payload.dependentEvents.some(
		(dependency) => dependency.eventSchemaSlug === "workout-set" && dependency.role === role,
	);
	return Effect.succeed(
		hasWorkoutSets
			? reject(
					entitySchemaSlug === "exercise"
						? "exercise_kind_has_workout_sets"
						: "workout_start_has_workout_sets",
				)
			: allow(),
	);
};

export default defineAutomationPolicy({
	manifest,
	run: ({ automation }, host) => {
		const payload = automation.payload;
		if (payload.resource === "event") {
			return eventContextPolicy(host, payload);
		}
		if (payload.resource === "entity" && payload.operation === "update") {
			return entityReferencePolicy(payload);
		}
		return Effect.succeed(allow());
	},
});
