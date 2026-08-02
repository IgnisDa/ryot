import { PluginSlug } from "@ryot/contract/schema/brands";
import { buildNavigationDocument } from "@ryot/ryotql-recipes/navigation";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createCollection,
	createSavedView,
	executeRyotQL,
	requireRyotQLFieldValue,
	requireRyotQLTextField,
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

			const workspaces = result.data["workspaces"];
			const savedViews = result.data["savedViews"];
			const collections = result.data["collections"];
			if (
				workspaces?.type !== "rows" ||
				savedViews?.type !== "rows" ||
				collections?.type !== "rows"
			) {
				throw new Error("Expected navigation row results");
			}

			const media = workspaces.items.find(
				(item) => requireRyotQLTextField(item, "slug") === "media",
			);
			const fitness = workspaces.items.find(
				(item) => requireRyotQLTextField(item, "slug") === "fitness",
			);
			if (!media || !fitness) {
				throw new Error("Expected built-in workspaces");
			}
			expect(requireRyotQLFieldValue(media, "sortOrder")).toEqual({ kind: "number", value: 7 });
			expect(requireRyotQLFieldValue(media, "isDisabled")).toEqual({
				value: true,
				kind: "boolean",
			});
			expect(requireRyotQLFieldValue(fitness, "sortOrder").kind).toBe("null");
			expect(requireRyotQLFieldValue(fitness, "isDisabled").kind).toBe("null");

			const viewNames = savedViews.items.map((item) => requireRyotQLTextField(item, "name"));
			expect(viewNames).toContain(firstViewName);
			expect(viewNames).not.toContain(secondViewName);
			const firstViewRow = savedViews.items.find(
				(item) => requireRyotQLTextField(item, "name") === firstViewName,
			);
			if (!firstViewRow) {
				throw new Error("Expected first user's saved view");
			}
			expect(requireRyotQLFieldValue(firstViewRow, "isDisabled")).toEqual({
				value: true,
				kind: "boolean",
			});

			const collectionIds = collections.items.map((item) => requireRyotQLTextField(item, "id"));
			expect(collectionIds).toContain(firstCollection.id);
			expect(collectionIds).not.toContain(secondCollection.id);
		}),
	);
});
