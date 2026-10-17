import { UserId } from "@ryot-app/contract/schema/brands";
import { UserPreferences } from "@ryot-app/contract/schema/user-preferences";
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
	map: ({ user: current }) => Result.succeed(current),
	queries: {
		user: selectedRow(user, {
			selection: {
				id: selectedField(column(user, "id"), UserId),
				name: selectedField(column(user, "name"), Schema.String),
				email: selectedField(column(user, "email"), Schema.String),
				preferences: selectedField(column(user, "preferences"), UserPreferences),
				image: selectedField(column(user, "image"), Schema.NullOr(Schema.String)),
			},
		}),
	},
}));

export type UserSettingsResult = Recipe.Success<typeof userSettingsRecipe>;
