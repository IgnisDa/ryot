import type { RyotQueryResult } from "@ryot-app/client-sdk/react";

import { animeAiringSoonRecipe, showsAiringSoonRecipe } from "../../shared/airing-recipes";
import { formatLocalDateKey } from "../media/date";
import { mediaImageAsset } from "../media/image";
import { mediaBackdropAsset, mediaPosterAsset } from "../media/summary-state";
import { mediaAspectOf } from "../schema-aspects";
import { HomeRail, type HomeTile } from "./home-rail";
import { airingDayCaption, episodePositionLabel, sameDayLabel } from "./labels";
import { createHomeSectionQuery, type SectionData } from "./section-query";

const RAIL_LIMIT = 20;

/** The window is today and the fourteen local days after it. */
const WINDOW_DAYS = 14;

const localMidnight = (day: string, offsetDays: number) =>
	new Date(
		Number(day.slice(0, 4)),
		Number(day.slice(5, 7)) - 1,
		Number(day.slice(8, 10)) + offsetDays,
	).toISOString();

/**
 * Shows take local dates and anime takes instants. Anime starts at local midnight rather than now,
 * so the input changes once a day and an episode that aired earlier today still shows.
 */
const airingRecipes = (input: { readonly today: string }) => ({
	anime: animeAiringSoonRecipe({
		now: localMidnight(input.today, 0),
		until: localMidnight(input.today, WINDOW_DAYS + 1),
	}),
	shows: showsAiringSoonRecipe({
		limit: RAIL_LIMIT,
		from: input.today,
		until: formatLocalDateKey(localMidnight(input.today, WINDOW_DAYS)),
	}),
});

type AiringData = SectionData<ReturnType<typeof airingRecipes>>;

export const airingQuery = createHomeSectionQuery(airingRecipes, (data) => [
	...data.shows.map(({ entity }) => entity.id),
	...data.anime.map(({ entity }) => entity.id),
]);

/**
 * Tiles by local day. A date-only entry's order key is its day alone, so it leads the instants
 * airing that day.
 */
const airingTiles = (data: AiringData, today: string): readonly HomeTile[] => {
	const caption = (day: string, sameDayCount: number) =>
		sameDayLabel(airingDayCaption(day, today), sameDayCount);
	return [
		...data.shows.map(({ entity, episode, sameDayCount }) => ({
			order: episode.publishDate,
			tile: {
				item: entity,
				key: entity.id,
				aspect: "still" as const,
				lines: [episodePositionLabel(episode), caption(episode.publishDate, sameDayCount)],
				art:
					mediaImageAsset(episode.images, "still") ??
					mediaBackdropAsset(entity) ??
					mediaPosterAsset(entity),
			},
		})),
		...data.anime.map(({ entity, airsAt, dateOnly, episodeLabel, sameDayCount }) => {
			const day = dateOnly ? airsAt : formatLocalDateKey(airsAt);
			return {
				order: dateOnly ? day : `${day}${airsAt}`,
				tile: {
					item: entity,
					key: entity.id,
					aspect: mediaAspectOf(entity.schemaSlug),
					lines: [episodeLabel, caption(day, sameDayCount)],
				},
			};
		}),
	]
		.sort((left, right) => left.order.localeCompare(right.order))
		.map(({ tile }) => tile);
};

export function AiringRail(props: {
	readonly today: string;
	readonly compact: boolean;
	readonly result: RyotQueryResult<AiringData>;
}) {
	return (
		<HomeRail
			title="Airing soon"
			result={props.result}
			compact={props.compact}
			tiles={(data) => airingTiles(data, props.today)}
		/>
	);
}
