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

import { workoutSetContextRecipe } from "../../shared/workout-record-recipes";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "policy",
	slug: "policy.workout-context",
	name: "Workout set context policy",
	inputProjection: { event: { properties: ["confirmedAt"] } },
});

type AutomationHost = Pick<ScriptHost, "executeRyotql">;
type EventPayload = Extract<AutomationPolicyInput["automation"]["payload"], { resource: "event" }>;

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
		if (startedAt === null || startedAt === undefined) {
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

export default defineAutomationPolicy({
	manifest,
	run: ({ automation }, host) => {
		const payload = automation.payload;
		if (payload.resource === "event") {
			return eventContextPolicy(host, payload);
		}
		return Effect.succeed(allow());
	},
});
