import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import { trendingLatestMediaRecipe } from "../../shared/discovery-recipes";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { mediaAspectOf } from "../schema-aspects";
import { HomeRail, HomeTileBadge } from "./home-rail";
import { createHomeSectionQuery } from "./section-query";

const trendingQuery = createHomeSectionQuery(
	(_input: void, client) =>
		client.data
			.query(
				trendingLatestMediaRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }),
				{ entitySchemaSlugs: ["movie", "show"] },
				{ pages: { trending: { limit: 20 } } },
			)
			.pipe(Effect.map((trending) => ({ trending }))),
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
					isInMediaLibrary: item.isInMediaLibrary,
					overlay: <HomeTileBadge label={String(item.rank)} />,
				}))
			}
		/>
	);
}
