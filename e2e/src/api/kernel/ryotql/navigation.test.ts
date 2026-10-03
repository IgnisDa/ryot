import { navigationRecipe } from "@ryot-app/ryotql-recipes/navigation";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	createSavedView,
	executeRyotQLRecipe,
	findSavedViewById,
	reorderSavedViews,
	updateSavedView,
} from "~/fixtures/kernel";
import { findMediaEntitySchema } from "~/fixtures/plugins/media";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("RyotQL navigation", () => {
	it.live("returns focused navigation data with user-scoped state and rows", () =>
		Effect.gen(function* () {
			const first = yield* createAuthenticatedClient();
			const second = yield* createAuthenticatedClient();
			const firstViewName = `First Navigation View ${crypto.randomUUID()}`;
			const orderedViewName = `Ordered Navigation View ${crypto.randomUUID()}`;
			const secondViewName = `Second Navigation View ${crypto.randomUUID()}`;
			const { builtinPlugin: selectedMediaWorkspace } = yield* findMediaEntitySchema(
				first.client,
				"book",
			);
			assertPresent(selectedMediaWorkspace, "System media workspace installation missing");

			const firstCreated = yield* createSavedView(first.client, {
				name: firstViewName,
				workspaceInstallationId: selectedMediaWorkspace.installationId,
			});
			const orderedCreated = yield* createSavedView(first.client, {
				name: orderedViewName,
				workspaceInstallationId: selectedMediaWorkspace.installationId,
			});
			const firstView = yield* findSavedViewById(first.client, firstCreated.id);
			const orderedView = yield* findSavedViewById(first.client, orderedCreated.id);
			yield* updateSavedView(first.client, firstView.reference, {
				isHidden: true,
				name: firstViewName,
				workspaceInstallationId: selectedMediaWorkspace.installationId,
			});
			yield* reorderSavedViews(first.client, {
				installationId: selectedMediaWorkspace.installationId,
				references: [orderedView.reference, firstView.reference],
			});
			yield* createSavedView(second.client, { name: secondViewName });
			const firstCollection = yield* createCollection(first.client, {
				name: `First Navigation Collection ${crypto.randomUUID()}`,
			});
			const secondCollection = yield* createCollection(second.client, {
				name: `Second Navigation Collection ${crypto.randomUUID()}`,
			});

			const data = yield* executeRyotQLRecipe(first.client, navigationRecipe());
			const viewNames = data.savedViews.map((item) => item.name);
			expect(viewNames).toContain(firstViewName);
			expect(viewNames).toContain(orderedViewName);
			expect(viewNames).not.toContain(secondViewName);
			const firstViewRow = data.savedViews.find((item) => item.name === firstViewName);
			if (!firstViewRow) {
				throw new Error("Expected first user's saved view");
			}
			expect(firstViewRow.isHidden).toBe(true);
			const workspaceRows = data.savedViews.filter(
				(item) => item.slug === orderedView.slug || item.slug === firstView.slug,
			);
			expect(workspaceRows.map((item) => item.slug)).toEqual([orderedView.slug, firstView.slug]);

			const collectionIds = data.collections.map((item) => item.slug);
			expect(collectionIds).toContain(firstCollection.id);
			expect(collectionIds).not.toContain(secondCollection.id);
		}),
	);
});
