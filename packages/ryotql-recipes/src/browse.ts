import { EntitySchemaBrowse } from "@ryot-app/contract/modules/filters/browse";
import type { BrowseSort } from "@ryot-app/contract/modules/filters/sort";
import {
	definitionOwner,
	ownerIdentityReference,
} from "@ryot-app/contract/modules/plugins/references";
import type { TableReference } from "@ryot-app/contract/modules/ryotql/authored";
import type { RowsPageInfo } from "@ryot-app/contract/modules/ryotql/language";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	literal,
	or,
	type Recipe,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import type { SortTarget } from "@ryot-app/ryotql/sort";
import { Array as Arr, Effect, Result, Schema } from "effect";

import { collectionsFilterField } from "./filters";

const NAME_SORT_KEY = "name";

export const reservedBrowseFieldKeys: readonly string[] = [
	collectionsFilterField.key,
	NAME_SORT_KEY,
];

export const ENTITY_IDS_PAGE_SIZE = 100;

export type BrowseSortChoice = BrowseSort & { readonly key: string };

export type EntityIdsResult = {
	readonly items: readonly string[];
	readonly pageInfo: typeof RowsPageInfo.Type;
};

export type BrowseSchema = {
	readonly slug: string;
	readonly pluginId: null | string;
	readonly browse: null | EntitySchemaBrowse;
};

export const nameSortTarget = (entity: TableReference): SortTarget => ({
	label: "Name",
	ascending: "A–Z",
	descending: "Z–A",
	key: NAME_SORT_KEY,
	defaultDirection: "asc",
	branches: [{ value: column(entity, "name") }],
});

const schemaOwner = (schema: BrowseSchema) =>
	ownerIdentityReference(definitionOwner(schema.pluginId));

const definitions = table("entitySchema", "browseSchema");

export const entitySchemaBrowseRecipe = (input: {
	readonly schemas: readonly [
		{ readonly slug: string; readonly pluginId: null | string },
		...{ readonly slug: string; readonly pluginId: null | string }[],
	];
}) => {
	return defineRecipe({
		map: ({ schemas }) =>
			Result.succeed(
				input.schemas.flatMap((requested): readonly BrowseSchema[] => {
					const rows = schemas.items.filter(
						(row) => row.slug === requested.slug && row.pluginId === requested.pluginId,
					);
					return rows.length > 0
						? rows
						: [{ browse: null, slug: requested.slug, pluginId: requested.pluginId }];
				}),
			),
		queries: {
			schemas: selectedRows(definitions, {
				limit: 100,
				maxLimit: 100,
				orderBy: [ascending(column(definitions, "id"))],
				where: or(
					...input.schemas.map((schema) =>
						and(
							eq(column(definitions, "slug"), literal(schema.slug)),
							schemaOwnerPredicate(
								definitions,
								"pluginId",
								schemaOwner({ ...schema, browse: null }),
							),
						),
					),
				),
				selection: {
					slug: selectedField(column(definitions, "slug"), EntitySchemaSlug),
					pluginId: selectedField(column(definitions, "pluginId"), Schema.NullOr(Schema.String)),
					browse: selectedField(column(definitions, "browse"), Schema.NullOr(EntitySchemaBrowse)),
				},
			}),
		},
	});
};

export type EntitySchemaBrowseResult = Recipe.Success<ReturnType<typeof entitySchemaBrowseRecipe>>;

export const loadEntitySchemaBrowse = Effect.fn("loadEntitySchemaBrowse")(function* <E, R>(
	schemas: readonly Pick<BrowseSchema, "slug" | "pluginId">[],
	query: (
		recipe: ReturnType<typeof entitySchemaBrowseRecipe>,
	) => Effect.Effect<EntitySchemaBrowseResult, E, R>,
) {
	const results = yield* Effect.forEach(Arr.chunksOf(schemas, 100), (batch) =>
		query(entitySchemaBrowseRecipe({ schemas: batch })),
	);
	return results.flat();
});
