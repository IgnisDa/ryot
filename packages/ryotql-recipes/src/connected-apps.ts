import { ConnectedAppId } from "@ryot-app/contract/schema/brands";
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

const app = table("connectedApp", "app");

export const connectedAppsRecipe = defineRecipe({
	map: ({ apps }) => Result.succeed({ ...apps, items: apps.items.map(withWriteAccess) }),
	queries: {
		apps: selectedRows(app, {
			limit: 50,
			maxLimit: 1000,
			orderBy: [descending(column(app, "createdAt")), descending(column(app, "id"))],
			selection: {
				id: selectedField(column(app, "id"), ConnectedAppId),
				name: selectedField(column(app, "name"), Schema.String),
				createdAt: selectedField(column(app, "createdAt"), IsoDateString),
				scopes: selectedField(column(app, "scopes"), Schema.Array(Schema.String)),
				lastUsedAt: selectedField(column(app, "lastUsedAt"), Schema.NullOr(IsoDateString)),
			},
		}),
	},
});

export type ConnectedAppItem = ConnectedAppsPage["items"][number];
export type ConnectedAppsPage = Recipe.Success<typeof connectedAppsRecipe>;
