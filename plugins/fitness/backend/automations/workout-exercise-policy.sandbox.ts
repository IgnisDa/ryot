import {
	type AutomationPolicyResult,
	defineAutomationPolicy,
} from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { executeRyotqlRecipe, IsoDateString } from "@ryot-app/plugin-backend-sdk/ryotql";

import { exerciseKindSchema } from "../../shared/exercise-kinds";
import { exerciseEquipmentRecipe, exerciseTargetsRecipe } from "../../shared/taxonomy-recipes";
import { WORKOUT_TAXONOMY_LIMIT } from "../../shared/workout-taxonomy";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "policy",
	slug: "policy.workout-exercise",
	name: "Freeze workout taxonomy",
	inputProjection: {
		event: { properties: [], entityProperties: ["kind"], sessionEntityProperties: ["startedAt"] },
	},
});

export default defineAutomationPolicy({
	manifest,
	run: ({ items, automation }, host) =>
		Effect.gen(function* () {
			const results: { itemIdentity: string; decision: AutomationPolicyResult }[] = [];
			for (const { payload, itemIdentity } of items) {
				if (
					payload.resource !== "event" ||
					payload.operation !== "create" ||
					payload.draft.eventSchemaSlug !== "workout-exercise"
				) {
					results.push({ itemIdentity, decision: { action: "allow" } });
					continue;
				}
				const draft = payload.draft;
				const workout =
					draft.sessionEntityId === null
						? undefined
						: automation.references?.[draft.sessionEntityId];
				const exercise = automation.references?.[draft.entityId];
				if (
					workout?.entitySchemaSlug !== "workout" ||
					exercise?.entitySchemaSlug !== "exercise" ||
					workout.entitySchemaPluginId !== draft.eventSchemaPluginId ||
					exercise.entitySchemaPluginId !== draft.eventSchemaPluginId ||
					Schema.decodeUnknownResult(IsoDateString)(workout.properties["startedAt"])._tag ===
						"Failure"
				) {
					results.push({
						itemIdentity,
						decision: { action: "reject", reason: "workout_exercise_context_missing" },
					});
					continue;
				}
				const input = {
					exerciseId: draft.entityId,
					reference: { kind: "self" },
					limit: WORKOUT_TAXONOMY_LIMIT,
				} as const;
				const exerciseKind = Schema.decodeUnknownResult(exerciseKindSchema)(
					exercise.properties["kind"],
				);
				if (exerciseKind._tag === "Failure") {
					results.push({
						itemIdentity,
						decision: { action: "reject", reason: "workout_exercise_context_missing" },
					});
					continue;
				}
				const targets = yield* executeRyotqlRecipe(
					host.executeRyotql,
					exerciseTargetsRecipe(input),
				);
				const equipment = yield* executeRyotqlRecipe(
					host.executeRyotql,
					exerciseEquipmentRecipe(input),
				);
				if (targets.pageInfo.hasMore || equipment.pageInfo.hasMore) {
					results.push({
						itemIdentity,
						decision: { action: "reject", reason: "workout_taxonomy_capacity" },
					});
					continue;
				}
				results.push({
					itemIdentity,
					decision: {
						action: "transform",
						patch: {
							resource: "event",
							draft: {
								properties: {
									remove: [],
									set: {
										exerciseKind: exerciseKind.success,
										equipment: equipment.items.map(({ id }) => id),
										targets: targets.items.map(({ id, role }) => ({ role, entityId: id })),
									},
								},
							},
						},
					},
				});
			}
			return { items: results };
		}),
});
