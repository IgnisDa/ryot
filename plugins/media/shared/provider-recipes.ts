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
				description: "Provider to read",
				validation: { required: true },
				label: catalogMessage("query-parameter.id"),
			},
		},
	});
	const provider = table("sandboxProvider", "provider");
	return defineRecipe({
		parameters: args.schema,
		map: ({ provider }) => Result.succeed(provider?.slug ?? null),
		queries: {
			provider: selectedOptionalRow(provider, {
				orderBy: [ascending(column(provider, "id"))],
				where: eq(column(provider, "id"), args.value("providerId")),
				selection: { slug: selectedField(column(provider, "slug"), Schema.String) },
			}),
		},
	});
})();
