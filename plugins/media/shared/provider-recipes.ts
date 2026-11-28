import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	ascending,
	column,
	defineRecipe,
	eq,
	parameters,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/plugin-kit/ryotql";

import { catalogMessage } from "./messages.generated";

/** The slug of one sandbox provider, or `null` when it is not visible. */
export const providerSlugRecipe = (() => {
	const args = parameters({
		fields: {
			providerId: {
				type: "string",
				validation: { required: true },
				description: "Provider to read",
				label: catalogMessage("query-parameter.id"),
			},
		},
	});
	const providerTable = table("sandboxProvider", "provider");
	return defineRecipe({
		parameters: args.schema,
		map: ({ provider }) => Result.succeed(provider?.slug ?? null),
		queries: {
			provider: selectedOptionalRow(providerTable, {
				orderBy: [ascending(column(providerTable, "id"))],
				where: eq(column(providerTable, "id"), args.value("providerId")),
				selection: { slug: selectedField(column(providerTable, "slug"), Schema.String) },
			}),
		},
	});
})();
