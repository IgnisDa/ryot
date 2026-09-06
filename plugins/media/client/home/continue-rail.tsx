import type { RyotQueryResult } from "@ryot-app/client-sdk/react";

import {
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "../../shared/lifecycle-expressions";
import {
	episodicByLifecycleStateRecipe,
	flatByLifecycleStateRecipe,
	type EpisodicByLifecycleStateResult,
	type FlatByLifecycleStateResult,
} from "../../shared/lifecycle-list-recipes";
import { MediaProgressBar } from "../media/primitives";
import { mediaAspectOf } from "../schema-aspects";
import { HomeRail, HomeTileBadge, type HomeTile } from "./home-rail";
import { episodePositionLabel, flatProgressLabel, resumeLabel } from "./labels";
import { createHomeSectionQuery, type SectionData } from "./section-query";

const RAIL_LIMIT = 20;

const libraryStateRecipes = (input: { readonly state: "in_progress" | "backlog" }) => ({
	flat: flatByLifecycleStateRecipe({ limit: RAIL_LIMIT, states: [input.state] }),
	show: episodicByLifecycleStateRecipe({
		limit: RAIL_LIMIT,
		states: [input.state],
		config: showEpisodicKindConfig,
	}),
	podcast: episodicByLifecycleStateRecipe({
		limit: RAIL_LIMIT,
		states: [input.state],
		config: podcastEpisodicKindConfig,
	}),
});

export type LibraryStateData = SectionData<ReturnType<typeof libraryStateRecipes>>;

type LibraryEntry =
	| { readonly kind: "flat"; readonly item: FlatByLifecycleStateResult["items"][number] }
	| { readonly kind: "episodic"; readonly item: EpisodicByLifecycleStateResult["items"][number] };

const activityOrder = (entry: LibraryEntry) => entry.item.latestActivityAt ?? "";

export const libraryEntries = (data: LibraryStateData): readonly LibraryEntry[] =>
	[
		...data.flat.items.map((item) => ({ item, kind: "flat" as const })),
		...data.show.items.map((item) => ({ item, kind: "episodic" as const })),
		...data.podcast.items.map((item) => ({ item, kind: "episodic" as const })),
	]
		.sort((left, right) => activityOrder(right).localeCompare(activityOrder(left)))
		.slice(0, RAIL_LIMIT);

export const libraryStateQuery = createHomeSectionQuery(libraryStateRecipes, (data) =>
	libraryEntries(data).map(({ item }) => item.id),
);

const continueTile = (entry: LibraryEntry, today: string): HomeTile => {
	const { item } = entry;
	const base = { item, key: item.id, aspect: mediaAspectOf(item.schemaSlug) };
	if (entry.kind === "flat") {
		const percent = entry.item.progressPercent;
		return {
			...base,
			lines: [flatProgressLabel(entry.item)],
			overlay:
				percent === null ? undefined : (
					<div className="absolute inset-x-1.5 bottom-1.5">
						<MediaProgressBar percent={percent} />
					</div>
				),
		};
	}
	const { nextUp } = entry.item;
	if (nextUp === null) {
		return { ...base, lines: [resumeLabel(entry.item.latestActivityAt, today)] };
	}
	return {
		...base,
		lines: [nextUp.name],
		overlay: <HomeTileBadge label={episodePositionLabel(nextUp)} />,
	};
};

export function ContinueRail(props: {
	readonly today: string;
	readonly compact: boolean;
	readonly result: RyotQueryResult<LibraryStateData>;
}) {
	return (
		<HomeRail
			title="Continue"
			result={props.result}
			compact={props.compact}
			tiles={(data) => libraryEntries(data).map((entry) => continueTile(entry, props.today))}
		/>
	);
}
