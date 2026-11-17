import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { useEntitlement, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import {
	latestCompletionSuggestionsQuery,
	latestCompletionSuggestionsRecipe,
} from "../../shared/discovery-recipes";
import { declaredQuerySource, PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { useMediaMessages } from "../messages";
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
	const text = useMediaMessages();
	const result = useRyotQuery(suggestionsQuery);
	const source = result.data?.suggestions.source;
	return (
		<HomeRail
			result={result}
			compact={props.compact}
			title={
				source
					? text("home.suggestions.title-from", { name: source.name })
					: text("home.suggestions.title")
			}
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
