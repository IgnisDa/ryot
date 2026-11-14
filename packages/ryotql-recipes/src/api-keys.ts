import { ApiKeyId } from "@ryot-app/contract/schema/brands";
import {
	column,
	defineRecipe,
	descending,
	type Recipe,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";
import { withWriteAccess } from "./write-access";

const key = table("apiKey", "key");

export const apiKeysRecipe = defineRecipe({
	map: ({ keys }) => Result.succeed({ ...keys, items: keys.items.map(withWriteAccess) }),
	queries: {
		keys: selectedRows(key, {
			limit: 50,
			maxLimit: 1000,
			orderBy: [descending(column(key, "createdAt")), descending(column(key, "id"))],
			selection: {
				id: selectedField(column(key, "id"), ApiKeyId),
				createdAt: selectedField(column(key, "createdAt"), IsoDateString),
				name: selectedField(column(key, "name"), Schema.NullOr(Schema.String)),
				start: selectedField(column(key, "start"), Schema.NullOr(Schema.String)),
				scopes: selectedField(column(key, "scopes"), Schema.Array(Schema.String)),
				expiresAt: selectedField(column(key, "expiresAt"), Schema.NullOr(IsoDateString)),
				lastUsedAt: selectedField(column(key, "lastUsedAt"), Schema.NullOr(IsoDateString)),
			},
		}),
	},
});

export type ApiKeyItem = ApiKeysPage["items"][number];
export type ApiKeysPage = Recipe.Success<typeof apiKeysRecipe>;
