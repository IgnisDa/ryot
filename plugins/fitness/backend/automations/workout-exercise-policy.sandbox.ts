import {
	type AutomationPolicyResult,
	defineAutomationPolicy,
} from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import { exerciseKindSchema } from "../../shared/exercise-kinds";
import { catalogMessage } from "../../shared/messages.generated";
import {
	WORKOUT_TAXONOMY_BATCH,
	workoutExerciseTaxonomyRecipe,
} from "../../shared/taxonomy-recipes";
import { workoutEventExercise } from "./workout-event-exercise";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "policy",
	slug: "policy.workout-exercise",
	name: "Freeze workout taxonomy",
	inputProjection: {
		event: { properties: [], entityProperties: ["kind"], sessionEntityProperties: ["startedAt"] },
	},
});

const contextMissing: AutomationPolicyResult = {
	action: "reject",
	reason: catalogMessage("rejection.workout-exercise.context-missing"),
};

export default defineAutomationPolicy({
	manifest,
	run: ({ items, automation }, host) =>
		Effect.gen(function* () {
			const created = items.flatMap(({ payload, itemIdentity }) =>
				payload.resource === "event" &&
				payload.operation === "create" &&
				payload.draft.eventSchemaSlug === "workout-exercise"
					? [{ itemIdentity, draft: payload.draft }]
					: [],
			);
			const exerciseIds = [...new Set(created.map(({ draft }) => draft.entityId))];
			const read = [];
			for (let index = 0; index < exerciseIds.length; index += WORKOUT_TAXONOMY_BATCH) {
				read.push(
					...(yield* executeRyotqlRecipe(
						host.executeRyotql,
						workoutExerciseTaxonomyRecipe({ reference: { kind: "self" } }),
						{ exerciseIds: exerciseIds.slice(index, index + WORKOUT_TAXONOMY_BATCH) },
					)),
				);
			}
			const taxonomy = new Map(read.map((exercise) => [exercise.id, exercise]));
			const decide = (draft: (typeof created)[number]["draft"]): AutomationPolicyResult => {
				const exercise = workoutEventExercise(automation, draft);
				const exerciseKind = Schema.decodeUnknownResult(exerciseKindSchema)(
					exercise?.properties["kind"],
				);
				const links = taxonomy.get(draft.entityId);
				if (exercise === undefined || exerciseKind._tag === "Failure" || links === undefined) {
					return contextMissing;
				}
				if (links.targets.pageInfo.hasMore || links.equipment.pageInfo.hasMore) {
					return {
						action: "reject",
						reason: catalogMessage("rejection.workout-exercise.taxonomy-capacity"),
					};
				}
				return {
					action: "transform",
					patch: {
						resource: "event",
						draft: {
							properties: {
								remove: [],
								set: {
									exerciseKind: exerciseKind.success,
									equipment: links.equipment.items.map(({ id }) => id),
									targets: links.targets.items.map(({ id, role }) => ({ role, entityId: id })),
								},
							},
						},
					},
				};
			};
			const decisions = new Map(
				created.map(({ draft, itemIdentity }) => [itemIdentity, decide(draft)]),
			);
			return {
				items: items.map(({ itemIdentity }) => ({
					itemIdentity,
					decision: decisions.get(itemIdentity) ?? { action: "allow" },
				})),
			};
		}),
});
