import { normalizeUserPreferences } from "@ryot-app/contract/auth-middleware";
import { UserId } from "@ryot-app/contract/schema/brands";
import {
	column,
	defineRecipe,
	selectedField,
	selectedRow,
	table,
	type Recipe,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

const user = table("user", "user");

export const userSettingsRecipe = defineRecipe(() => ({
	map: ({ user: current }) =>
		Result.succeed({ ...current, preferences: normalizeUserPreferences(current.preferences) }),
	queries: {
		user: selectedRow(user, {
			selection: {
				id: selectedField(column(user, "id"), UserId),
				name: selectedField(column(user, "name"), Schema.String),
				email: selectedField(column(user, "email"), Schema.String),
				preferences: selectedField(column(user, "preferences"), Schema.Unknown),
				image: selectedField(column(user, "image"), Schema.NullOr(Schema.String)),
			},
		}),
	},
}));

export type UserSettingsResult = Recipe.Success<typeof userSettingsRecipe>;
