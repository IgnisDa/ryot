import { PluginSlug } from "@ryot/contract/schema/brands";
import { buildNavigationDocument, decodeNavigationResponse } from "@ryot/ryotql-recipes/navigation";
import { Effect, Result } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	createSavedView,
	executeRyotQL,
	updatePluginState,
	updateSavedView,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

describe("RyotQL navigation", () => {
	it.live("returns focused navigation data with user-scoped state and rows", () =>
		Effect.gen(function* () {
			const first = yield* createAuthenticatedClient();
			const second = yield* createAuthenticatedClient();
			const firstViewName = `First Navigation View ${crypto.randomUUID()}`;
			const secondViewName = `Second Navigation View ${crypto.randomUUID()}`;

			yield* updatePluginState(first.client, "media", { isDisabled: true, sortOrder: 7 });
			yield* updatePluginState(second.client, "media", { isDisabled: false, sortOrder: 1 });
			const firstView = yield* createSavedView(first.client, {
				name: firstViewName,
				pluginSlug: PluginSlug.make("media"),
			});
			yield* updateSavedView(first.client, firstView.slug, {
				isDisabled: true,
				name: firstViewName,
				pluginSlug: PluginSlug.make("media"),
			});
			yield* createSavedView(second.client, { name: secondViewName });
			const firstCollection = yield* createCollection(first.client, {
				name: `First Navigation Collection ${crypto.randomUUID()}`,
			});
			const secondCollection = yield* createCollection(second.client, {
				name: `Second Navigation Collection ${crypto.randomUUID()}`,
			});

			const result = yield* executeRyotQL(first.client, buildNavigationDocument());
			expect(Object.keys(result.data)).toEqual(["workspaces", "savedViews", "collections"]);
			const data = Result.getOrThrow(decodeNavigationResponse(result));
			const media = data.workspaces.find((item) => item.slug === "media");
			const fitness = data.workspaces.find((item) => item.slug === "fitness");
			if (!media || !fitness) {
				throw new Error("Expected built-in workspaces");
			}
			expect(media).toMatchObject({ sortOrder: 7, isDisabled: true });
			expect(fitness).toMatchObject({ sortOrder: expect.any(Number), isDisabled: false });

			const viewNames = data.savedViews.map((item) => item.name);
			expect(viewNames).toContain(firstViewName);
			expect(viewNames).not.toContain(secondViewName);
			const firstViewRow = data.savedViews.find((item) => item.name === firstViewName);
			if (!firstViewRow) {
				throw new Error("Expected first user's saved view");
			}
			expect(firstViewRow.isDisabled).toBe(true);

			const collectionIds = data.collections.map((item) => item.slug);
			expect(collectionIds).toContain(firstCollection.id);
			expect(collectionIds).not.toContain(secondCollection.id);
		}),
	);
});
