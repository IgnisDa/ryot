import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	type RyotQueryResult,
	usePluginIdentity,
	usePluginUserSettings,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { upcomingRecipe } from "../../shared/upcoming-recipes";
import { upcomingSettings } from "../../shared/upcoming-settings";
import { formatLocalDateKey } from "../media/date";
import { mediaImageAsset } from "../media/image";
import { mediaBackdropAsset, mediaPosterAsset } from "../media/summary-state";
import { mediaAspectOf } from "../schema-aspects";
import { HomeRail, type HomeTile } from "./home-rail";
import { airingDayCaption, episodePositionLabel, moreLabel } from "./labels";
import { createHomeSectionQuery } from "./section-query";

const RAIL_LIMIT = 20;

const TITLE = "Upcoming";
type UpcomingSelection = ReturnType<typeof upcomingSettings>;
type UpcomingData = { readonly titles: Recipe.Success<ReturnType<typeof upcomingRecipe>> };
const upcomingQuery = createHomeSectionQuery(
	(input: UpcomingSelection, client) =>
		client.data
			.query(upcomingRecipe({ reference: client.pluginIdentity(PLUGIN_PACKAGE_ID) }), {
				daysAhead: input.daysAhead,
				onePerTitle: input.onePerTitle,
			})
			.pipe(Effect.map((titles) => ({ titles }))),
	(data) => data.titles.map(({ entity }) => entity.id),
);

/**
 * Occurrences by local day; a date-only entry leads the instants of its day. With one entry per
 * title, a title keeps its soonest occurrence and counts the rest of its window across sources.
 */
const upcomingTiles = (
	data: UpcomingData,
	today: string,
	onePerTitle: boolean,
): readonly HomeTile[] => {
	const totals = new Map<string, number>();
	for (const { total, entity } of data.titles) {
		totals.set(entity.id, (totals.get(entity.id) ?? 0) + total);
	}
	const seen = new Set<string>();
	return data.titles
		.flatMap(({ entity, occurrences }) =>
			occurrences.map((occurrence) => {
				const day = occurrence.dateOnly ? occurrence.airsAt : formatLocalDateKey(occurrence.airsAt);
				return {
					day,
					entity,
					occurrence,
					order: occurrence.dateOnly ? day : `${day}${occurrence.airsAt}`,
				};
			}),
		)
		.sort((left, right) => left.order.localeCompare(right.order))
		.filter(({ entity }) => {
			if (!onePerTitle) {
				return true;
			}
			const first = !seen.has(entity.id);
			seen.add(entity.id);
			return first;
		})
		.slice(0, RAIL_LIMIT)
		.map(({ day, entity, occurrence }) => {
			const show = entity.schemaSlug === "show";
			const more = onePerTitle ? (totals.get(entity.id) ?? 1) - 1 : 0;
			return {
				item: entity,
				key: occurrence.key,
				aspect: show ? "still" : mediaAspectOf(entity.schemaSlug),
				art: show
					? (mediaImageAsset(occurrence.images, "still") ??
						mediaBackdropAsset(entity) ??
						mediaPosterAsset(entity))
					: undefined,
				lines: [
					occurrence.episode === null ? undefined : episodePositionLabel(occurrence.episode),
					moreLabel(airingDayCaption(day, today), more),
				],
			};
		});
};

export function UpcomingRail(props: {
	readonly today: string;
	readonly compact: boolean;
	readonly onePerTitle: boolean;
	readonly result: RyotQueryResult<UpcomingData>;
}) {
	return (
		<HomeRail
			title={TITLE}
			result={props.result}
			compact={props.compact}
			tiles={(data) => upcomingTiles(data, props.today, props.onePerTitle)}
		/>
	);
}

export function UpcomingSection(props: { readonly today: string; readonly compact: boolean }) {
	const settings = usePluginUserSettings(usePluginIdentity(PLUGIN_PACKAGE_ID).pluginId);
	if (settings.data === undefined) {
		return <HomeRail title={TITLE} tiles={() => []} result={settings} compact={props.compact} />;
	}
	return (
		<UpcomingQueryRail
			today={props.today}
			compact={props.compact}
			selection={upcomingSettings(settings.data)}
		/>
	);
}

function UpcomingQueryRail(props: {
	readonly today: string;
	readonly compact: boolean;
	readonly selection: UpcomingSelection;
}) {
	const result = useRyotQuery(upcomingQuery, props.selection);
	return (
		<UpcomingRail
			result={result}
			today={props.today}
			compact={props.compact}
			onePerTitle={props.selection.onePerTitle}
		/>
	);
}
