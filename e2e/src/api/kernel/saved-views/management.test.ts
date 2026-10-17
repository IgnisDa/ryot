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
	listInstalledPlugins,
	reorderSavedViews,
	updateSavedView,
} from "~/fixtures/kernel";
import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("saved views management", () => {
	it.live("clones renderer settings and data sources into an independent user view", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const sourceCreated = yield* createSavedView(client, {
				name: `Clone Source ${crypto.randomUUID()}`,
			});
			const source = yield* findSavedViewById(client, sourceCreated.id);
			const cloned = yield* cloneSavedView(client, source.reference);
			const clone = yield* findSavedViewById(client, cloned.id);

			expect(clone.id).not.toBe(source.id);
			expect(clone.name).toBe(`${source.name} (Copy)`);
			expect(clone.renderer).toEqual(source.renderer);
			expect(clone.settings).toEqual(source.settings);
			expect(clone.dataSources).toEqual(source.dataSources);

			yield* updateSavedView(client, clone.reference, {
				name: `${clone.name} Updated`,
				settings: { ...clone.settings, pageSize: 5 },
			});
			const unchangedSource = yield* getSavedView(client, source.reference);
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
			const cloned = yield* cloneSavedView(client, builtin.reference);
			const clone = yield* findSavedViewById(client, cloned.id);
			yield* deleteSavedView(client, clone.reference);

			expect((yield* getSavedView(client, builtin.reference)).id).toBe(builtin.id);
			expect((yield* listSavedViews(client)).map((view) => view.id)).not.toContain(clone.id);
		}),
	);

	it.live("filters and reorders canonical views within a workspace", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, pluginId } = yield* createPluginEntitySchema(client, {
				schemaName: `Saved View Workspace ${crypto.randomUUID()}`,
			});
			const workspace = requirePresent(
				(yield* listInstalledPlugins(client)).find((row) => row.pluginId === pluginId),
				"Workspace missing",
			);
			const dataSources = buildSavedViewDataSources([schemaId], { pluginId, kind: "local" });
			const firstCreated = yield* createSavedView(client, {
				dataSources,
				name: `Workspace A ${crypto.randomUUID()}`,
				workspaceInstallationId: workspace.installationId,
			});
			const secondCreated = yield* createSavedView(client, {
				dataSources,
				name: `Workspace B ${crypto.randomUUID()}`,
				workspaceInstallationId: workspace.installationId,
			});
			const first = yield* findSavedViewById(client, firstCreated.id);
			const second = yield* findSavedViewById(client, secondCreated.id);

			const reordered = yield* reorderSavedViews(client, {
				installationId: workspace.installationId,
				references: [second.reference, first.reference],
			});
			const workspaceViews = yield* listSavedViews(client, {
				installationId: workspace.installationId,
			});

			expect(reordered.references.slice(0, 2)).toEqual([second.reference, first.reference]);
			expect(workspaceViews.map((view) => view.slug).slice(0, 2)).toEqual([
				second.slug,
				first.slug,
			]);
			expect(workspaceViews.every((view) => view.packageId === workspace.packageId)).toBe(true);
		}),
	);

	it.live("disables a view without changing its renderer definition", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const created = yield* createSavedView(client, {
				name: `Disable Definition ${crypto.randomUUID()}`,
			});
			const before = yield* findSavedViewById(client, created.id);
			const disabled = yield* updateSavedView(client, before.reference, { isHidden: true });
			const after = yield* getSavedView(client, before.reference);

			expect(disabled.id).toBe(created.id);
			expect(after.isHidden).toBe(true);
			expect(after.renderer).toEqual(before.renderer);
			expect(after.settings).toEqual(before.settings);
			expect(after.dataSources).toEqual(before.dataSources);
			expect((yield* listSavedViews(client)).map((view) => view.id)).not.toContain(created.id);
			expect(
				(yield* listSavedViews(client, { includeHidden: true })).map((view) => view.id),
			).toContain(created.id);
		}),
	);
});
