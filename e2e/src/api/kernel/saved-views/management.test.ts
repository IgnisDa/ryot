import { Effect } from "effect";

import {
	buildSavedViewDataSources,
	cloneSavedView,
	createAuthenticatedClient,
	createPluginEntitySchema,
	createSavedView,
	deleteSavedView,
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
			const source = yield* createSavedView(client, {
				name: `Clone Source ${crypto.randomUUID()}`,
			});
			const clone = yield* cloneSavedView(client, source.slug);

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
			const clone = yield* cloneSavedView(client, builtin.slug);
			yield* deleteSavedView(client, clone.slug);

			expect((yield* getSavedView(client, builtin.slug)).id).toBe(builtin.id);
			expect((yield* listSavedViews(client)).map((view) => view.id)).not.toContain(clone.id);
		}),
	);

	it.live("filters and reorders canonical views within a workspace", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginSlug, schemaId } = yield* createPluginEntitySchema(client, {
				schemaName: `Saved View Workspace ${crypto.randomUUID()}`,
			});
			const dataSources = buildSavedViewDataSources([schemaId]);
			const first = yield* createSavedView(client, {
				dataSources,
				workspacePluginSlug: pluginSlug,
				name: `Workspace A ${crypto.randomUUID()}`,
			});
			const second = yield* createSavedView(client, {
				dataSources,
				workspacePluginSlug: pluginSlug,
				name: `Workspace B ${crypto.randomUUID()}`,
			});

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
			const disabled = yield* updateSavedView(client, created.slug, { isDisabled: true });

			expect(disabled.isDisabled).toBe(true);
			expect(disabled.renderer).toEqual(created.renderer);
			expect(disabled.settings).toEqual(created.settings);
			expect(disabled.dataSources).toEqual(created.dataSources);
			expect((yield* listSavedViews(client)).map((view) => view.id)).not.toContain(created.id);
			expect(
				(yield* listSavedViews(client, { includeDisabled: true })).map((view) => view.id),
			).toContain(created.id);
		}),
	);
});
