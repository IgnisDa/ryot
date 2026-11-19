import { identityTupleKey } from "@ryot-app/contract/modules/plugins/references";
import { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	ascending,
	column,
	defineRecipe,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { useCallback } from "react";

import { useOptionalPageContext } from "../bootstrap/page-context";
import type { RyotClient } from "../client/client";
import { readCursorPages } from "../queries/cursor-pages";
import { createRyotQuery } from "../queries/definitions";
import { useRyotQuery } from "../queries/hooks";

const ENTITY_SCHEMA_NAMES_PAGE_SIZE = 100;

const schema = table("entitySchema", "entitySchemaName");

export const entitySchemaNamesRecipe = defineRecipe({
	map: ({ schemas }) => Result.succeed(schemas),
	queries: {
		schemas: selectedRows(schema, {
			limit: ENTITY_SCHEMA_NAMES_PAGE_SIZE,
			maxLimit: ENTITY_SCHEMA_NAMES_PAGE_SIZE,
			orderBy: [ascending(column(schema, "id"))],
			selection: {
				name: selectedField(column(schema, "name"), Message),
				slug: selectedField(column(schema, "slug"), Schema.String),
				pluginId: selectedField(column(schema, "pluginId"), Schema.NullOr(Schema.String)),
			},
		}),
	},
});

const loadEntitySchemaNames = (client: RyotClient) =>
	readCursorPages((after) =>
		client.data.query(
			entitySchemaNamesRecipe,
			{},
			{ pages: { schemas: after === undefined ? {} : { after } } },
		),
	).pipe(
		Effect.map(
			({ items }): ReadonlyMap<string, Message> =>
				new Map(items.map(({ name, slug, pluginId }) => [identityTupleKey(pluginId, slug), name])),
		),
	);

/** Publication visitors may run only the page's own queries, so they get the fallback name. */
const entitySchemaNamesQuery = createRyotQuery<boolean, ReadonlyMap<string, Message>>(
	({ client, input: readable }) =>
		readable ? loadEntitySchemaNames(client) : Effect.succeed(new Map()),
);

/**
 * Renders an entity schema's served name from its owner and slug, or a neutral fallback while the
 * names load or when the schema is not readable.
 */
export const useEntitySchemaName = () => {
	const t = useT();
	const readable = useOptionalPageContext()?.target.kind !== "publication";
	const names = useRyotQuery(entitySchemaNamesQuery, readable).data;
	return useCallback(
		(reference: { readonly entitySchemaSlug: string; readonly ownerPluginId: null | string }) =>
			t(
				names?.get(identityTupleKey(reference.ownerPluginId, reference.entitySchemaSlug)) ??
					kernelMessage("sdk.entity-schema.unnamed"),
			),
		[names, t],
	);
};
