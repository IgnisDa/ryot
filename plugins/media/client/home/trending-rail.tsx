import { useRyotQuery } from "@ryot-app/client-sdk/react";

import { trendingLatestMediaRecipe } from "../../shared/discovery-recipes";
import { mediaAspectOf } from "../schema-aspects";
import { HomeRail, HomeTileBadge } from "./home-rail";
import { createHomeSectionQuery } from "./section-query";

const trendingQuery = createHomeSectionQuery(
	(_input: void) => ({
		trending: trendingLatestMediaRecipe({ limit: 20, entitySchemaSlugs: ["movie", "show"] }),
	}),
	({ trending }) => trending.items.map(({ id }) => id),
);

export function TrendingRail(props: { readonly compact: boolean }) {
	return (
		<HomeRail
			compact={props.compact}
			title="Trending in films & shows"
			result={useRyotQuery(trendingQuery)}
			tiles={({ trending }) =>
				trending.items.map((item) => ({
					item,
					key: item.id,
					aspect: mediaAspectOf(item.schemaSlug),
					overlay: <HomeTileBadge label={String(item.rank)} />,
				}))
			}
		/>
	);
}
