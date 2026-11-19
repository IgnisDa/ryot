import { expect } from "bun:test";

import type { PageDefinition } from "@ryot-app/contract/modules/pages/schemas";
import { PluginPackageId, UserId } from "@ryot-app/contract/schema/brands";
import { column, defineRecipe, selectedField, selectedRows, table } from "@ryot-app/ryotql";
import { assert } from "@ryot-app/testing/assert";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Schema } from "effect";

import { DefinitionCatalog } from "#modules/definitions/catalog";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";

import { pageQueryDocument } from "./query-document";

const owner = UserId.make("owner");
const packageId = PluginPackageId.make("testing/page-imports");
const item = table("entity", "item");
const items = selectedRows(item, {
	limit: 1,
	maxLimit: 2,
	selection: { id: selectedField(column(item, "id"), Schema.String) },
});
const own = defineRecipe({ queries: { own: items } }).document;
const fixture = revisionPackage("page-imports", "v1", undefined, packageId);
const plugin = {
	...fixture,
	manifest: {
		...fixture.manifest,
		queries: {
			search: {
				title: "Search items",
				description: "Search items",
				document: defineRecipe({ queries: { items } }).document,
			},
		},
	},
};
const page = (pluginQueries: PageDefinition["pluginQueries"]): PageDefinition => ({
	files: [],
	queries: own,
	pluginQueries,
	entry: "client/page.tsx",
	pluginDependencies: { items: { packageId, scope: "user" } },
});

layer(revisionDatabaseLayer)((test) => {
	test.effect("imports dependency queries under their local name and explains failures", () =>
		Effect.gen(function* () {
			yield* installRevisionPackage(plugin, owner);
			const catalogs = yield* DefinitionCatalog;
			const query = own.queries["own"];
			assert(query);
			expect(
				yield* pageQueryDocument(
					catalogs,
					owner,
					page({ found: { query: "search", dependency: "items" } }),
				),
			).toEqual({ parameters: { fields: {} }, queries: { own: query, "found.items": query } });
			expect(
				(yield* Effect.flip(
					pageQueryDocument(
						catalogs,
						owner,
						page({ found: { query: "search", dependency: "missing" } }),
					),
				)).message,
			).toBe("Plugin query 'found' names undeclared dependency 'missing'");
			expect(
				(yield* Effect.flip(
					pageQueryDocument(
						catalogs,
						owner,
						page({ found: { query: "absent", dependency: "items" } }),
					),
				)).message,
			).toBe("Plugin query 'found' is unavailable: dependency 'items' declares no query 'absent'");
		}),
	);
});
