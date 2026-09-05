import { Effect } from "effect";

import {
	buildSavedViewDataSources,
	cloneSavedView,
	createAuthenticatedClient,
	createPluginEntitySchema,
	createSavedView,
	deleteSavedView,
	findSavedViewById,
	getSavedView,
	listSavedViews,
	reorderSavedViews,
	updateSavedView,
} from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";

describe("saved views management", () => {
	it.live("clones renderer settings and data sources into an independent user view", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const sourceCreated = yield* createSavedView(client, {
				name: `Clone Source ${crypto.randomUUID()}`,
			});
			const source = yield* findSavedViewById(client, sourceCreated.id);
			const cloned = yield* cloneSavedView(client, source.slug);
			const clone = yield* findSavedViewById(client, cloned.id);

			expect(clone.id).not.toBe(source.id);
			expect(clone.name).toBe(`${source.name} (Copy)`);
			expect(clone.renderer).toEqual(source.renderer);
			expect(clone.settings).toEqual(source.settings);
			expect(clone.dataSources).toEqual(source.dataSources);

			yield* updateSavedView(client, clone.slug, {
				name: `${clone.name} Updated`,
				settings: { ...clone.settings, pageSize: 5 },
			});
			const unchangedSource = yield* getSavedView(client, source.slug);
			expect(unchangedSource.name).toBe(source.name);
			expect(unchangedSource.settings).toEqual(source.settings);
		}),
	);

	it.live("deletes a saved view clone without deleting its built-in source", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const builtin = (yield* listSavedViews(client)).find((view) => view.name === "All Movies");
			if (!builtin) {
				throw new Error("All Movies saved view not found");
			}
			const cloned = yield* cloneSavedView(client, builtin.slug);
			const clone = yield* findSavedViewById(client, cloned.id);
			yield* deleteSavedView(client, clone.slug);

			expect((yield* getSavedView(client, builtin.slug)).id).toBe(builtin.id);
			expect((yield* listSavedViews(client)).map((view) => view.id)).not.toContain(clone.id);
		}),
	);

	it.live("filters and reorders canonical views within a workspace", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, pluginSlug } = yield* createPluginEntitySchema(client, {
				schemaName: `Saved View Workspace ${crypto.randomUUID()}`,
			});
			const dataSources = buildSavedViewDataSources([schemaId]);
			const firstCreated = yield* createSavedView(client, {
				dataSources,
				workspacePluginSlug: pluginSlug,
				name: `Workspace A ${crypto.randomUUID()}`,
			});
			const secondCreated = yield* createSavedView(client, {
				dataSources,
				workspacePluginSlug: pluginSlug,
				name: `Workspace B ${crypto.randomUUID()}`,
			});
			const first = yield* findSavedViewById(client, firstCreated.id);
			const second = yield* findSavedViewById(client, secondCreated.id);

			const reordered = yield* reorderSavedViews(client, {
				pluginSlug,
				viewSlugs: [second.slug, first.slug],
			});
			const workspaceViews = yield* listSavedViews(client, { pluginSlug });

			expect(reordered.viewSlugs.slice(0, 2)).toEqual([second.slug, first.slug]);
			expect(workspaceViews.map((view) => view.slug).slice(0, 2)).toEqual([
				second.slug,
				first.slug,
			]);
			expect(workspaceViews.every((view) => view.pluginSlug === pluginSlug)).toBe(true);
		}),
	);

	it.live("disables a view without changing its renderer definition", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const created = yield* createSavedView(client, {
				name: `Disable Definition ${crypto.randomUUID()}`,
			});
			const before = yield* findSavedViewById(client, created.id);
			const disabled = yield* updateSavedView(client, before.slug, { isDisabled: true });
			const after = yield* getSavedView(client, before.slug);

			expect(disabled.id).toBe(created.id);
			expect(after.isDisabled).toBe(true);
			expect(after.renderer).toEqual(before.renderer);
			expect(after.settings).toEqual(before.settings);
			expect(after.dataSources).toEqual(before.dataSources);
			expect((yield* listSavedViews(client)).map((view) => view.id)).not.toContain(created.id);
			expect(
				(yield* listSavedViews(client, { includeDisabled: true })).map((view) => view.id),
			).toContain(created.id);
		}),
	);
});
