import { OAuthConnectionStatus } from "@ryot-app/contract/modules/oauth-connections/schemas";
import {
	column,
	defineRecipe,
	eq,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Option, Result } from "effect";

const connection = table("oauthConnection", "connection");

export const oauthConnectionStatusRecipe = (() => {
	const recipeParameters = parameters({
		fields: {
			id: {
				label: "id",
				type: "string",
				description: "Query argument",
				validation: { required: true },
			},
		},
	});
	return defineRecipe({
		parameters: recipeParameters.schema,
		map: ({ connection: current }) =>
			Result.succeed(current === undefined ? Option.none() : Option.some(current.status)),
		queries: {
			connection: selectedOptionalRow(connection, {
				where: eq(column(connection, "id"), recipeParameters.value("id")),
				selection: { status: selectedField(column(connection, "status"), OAuthConnectionStatus) },
			}),
		},
	});
})();
