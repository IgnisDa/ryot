import { useRyotQuery } from "@ryot-app/client-sdk/react";

import { latestCompletionSuggestionsRecipe } from "../../shared/discovery-recipes";
import { mediaAspectOf } from "../schema-aspects";
import { HomeRail } from "./home-rail";
import { createHomeSectionQuery } from "./section-query";

const suggestionsQuery = createHomeSectionQuery(
	(_input: void) => ({ suggestions: latestCompletionSuggestionsRecipe({ limit: 20 }) }),
	({ suggestions }) => [
		...(suggestions.source === null ? [] : [suggestions.source.id]),
		...suggestions.items.map(({ id }) => id),
	],
);

export function SuggestionsRail(props: { readonly compact: boolean }) {
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
