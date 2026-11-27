import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { executeRyotqlRecipe, userMediaLibraryRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import { mediaCopyRelationship } from "../../../shared/media-copy";
import { mediaCopiesRecipe, mediaCopyBatchSize } from "../../../shared/media-copy-recipes";
import { inventoryReconcileInput, inventoryReconcileOutput } from "./reconciliation";

export const manifest = defineManifest({
	kind: "script",
	slug: "integration.reconcile-inventory",
	name: "Reconcile a completed media inventory",
});

const reference = { kind: "self" } as const;

export default defineScript({
	manifest,
	input: inventoryReconcileInput,
	output: inventoryReconcileOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			const integration = yield* host.getCurrentIntegration();
			const inventory =
				integration.provider === "jellyfin_inventory" || integration.provider === "emby_inventory";
			if (!inventory && integration.providerSpecifics["syncCopies"] !== true) {
				return { done: true };
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
			if (copies.items.length) {
				yield* host.changeUserRelationships([
					{
						creates: [],
						deletes: copies.items.map((copy) => ({
							key: copy.id,
							targetEntityId: copy.entityId,
							sourceEntityId: library.entityId,
							relationshipSchemaSlug: mediaCopyRelationship,
						})),
					},
				]);
			}
			return { done: !copies.pageInfo.hasMore };
		}),
});
