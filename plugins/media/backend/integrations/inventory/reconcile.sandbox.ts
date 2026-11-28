import { existingEntity } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { executeRyotqlRecipe, userMediaLibraryRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { mediaCopyRelationship } from "../../../shared/media-copy";
import { mediaCopiesRecipe, mediaCopyBatchSize } from "../../../shared/media-copy-recipes";
import { inventoryReconcileInput, inventoryReconcileOutput } from "./reconciliation";

export const manifest = defineManifest({
	kind: "script",
	activity: true,
	slug: "integration.reconcile-inventory",
	name: "Reconcile a completed media inventory",
});

const reference = { kind: "self" } as const;

export default defineActivity({
	manifest,
	input: inventoryReconcileInput,
	output: inventoryReconcileOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			const integration = yield* host.getCurrentIntegration();
			const inventory =
				integration.provider === "jellyfin_inventory" || integration.provider === "emby_inventory";
			if (!inventory && integration.providerSpecifics["syncCopies"] !== true) {
				return { output: { done: true } };
			}
			const [copies, library] = yield* Effect.all([
				executeRyotqlRecipe(
					host.executeRyotql,
					mediaCopiesRecipe(reference),
					{ notSeenInRun: input.runId, integrationSourceKey: integration.sourceKey },
					{ pages: { copies: { limit: mediaCopyBatchSize } } },
				),
				executeRyotqlRecipe(host.executeRyotql, userMediaLibraryRecipe(reference), {}),
			]);
			const output = { done: !copies.pageInfo.hasMore };
			if (copies.items.length === 0) {
				return { output };
			}
			const source = existingEntity(EntityId.make(library.entityId));
			return {
				output,
				changes: {
					relationships: {
						deletes: copies.items.map((copy) => ({
							source,
							key: copy.id,
							relationshipSchemaSlug: mediaCopyRelationship,
							target: existingEntity(EntityId.make(copy.entityId)),
						})),
					},
				},
			};
		}),
});
