import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { useEntitlement, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import {
	latestCompletionSuggestionsQuery,
	latestCompletionSuggestionsRecipe,
} from "../../shared/discovery-recipes";
import { declaredQuerySource, PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { mediaAspectOf } from "../schema-aspects";
import { HomeRail } from "./home-rail";
import { createHomeSectionQuery } from "./section-query";

const suggestionsQuery = createHomeSectionQuery(
	(_input: void, client) =>
		client.data
			.queryDeclared(
				latestCompletionSuggestionsRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
				declaredQuerySource(latestCompletionSuggestionsQuery),
				{},
				{ pages: { items: { limit: 20 } } },
			)
			.pipe(Effect.map((suggestions) => ({ suggestions }))),
	({ suggestions }) => [
		...(suggestions.source === null ? [] : [suggestions.source.id]),
		...suggestions.items.map(({ id }) => id),
	],
);

export function SuggestionsRail(props: { readonly compact: boolean }) {
	return useEntitlement("pro").granted ? <EntitledSuggestionsRail compact={props.compact} /> : null;
}

function EntitledSuggestionsRail(props: { readonly compact: boolean }) {
	const result = useRyotQuery(suggestionsQuery);
	const source = result.data?.suggestions.source;
	return (
		<HomeRail
			result={result}
			compact={props.compact}
			title={source ? `Because you finished ${source.name}` : "Because you finished"}
			tiles={({ suggestions }) =>
				suggestions.items.map((item) => ({
					item,
					key: item.id,
					aspect: mediaAspectOf(item.schemaSlug),
				}))
			}
		/>
	);
}
