import { OAuthConnectionStatus } from "@ryot-app/contract/modules/oauth-connections/schemas";
import {
	column,
	defineRecipe,
	eq,
	literal,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/ryotql";
import { Option, Result } from "effect";

const connection = table("oauthConnection", "connection");

export const oauthConnectionStatusRecipe = defineRecipe((input: { readonly id: string }) => ({
	map: ({ connection: current }) =>
		Result.succeed(current === undefined ? Option.none() : Option.some(current.status)),
	queries: {
		connection: selectedOptionalRow(connection, {
			where: eq(column(connection, "id"), literal(input.id)),
			selection: { status: selectedField(column(connection, "status"), OAuthConnectionStatus) },
		}),
	},
}));
