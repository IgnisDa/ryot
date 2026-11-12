import { ManagedAssetProvider, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";

import type { mediaEpisodeCreditsRecipe } from "../../shared/media-recipes";
import { createMediaCreditsQuery, MediaCreditsButton, type MediaCreditsRecipe } from "./credits";
import { createMediaEntityQuery } from "./detail-queries";
import type { MediaEpisode } from "./episodes-state";
import { collectManagedAssetLocators } from "./image";
import {
	MediaOverviewBody,
	type MediaOverviewRelationsRender,
	MediaPeopleSection,
} from "./overview";
import { mapMediaOverview, mediaPersonAsset } from "./overview-state";

type MediaEpisodeCreditRows = Recipe.Success<
	ReturnType<ReturnType<typeof mediaEpisodeCreditsRecipe>>
>;

type MediaEpisodeCreditCopy = {
	readonly crew: string;
	readonly title: string;
	readonly loading: string;
	readonly guestStars: string;
	readonly fullCredits: string;
};

/** An episode descriptor's credit queries and sections; the full credit list opens from the first section. */
export const createMediaEpisodeCredits = (input: {
	readonly copy: MediaEpisodeCreditCopy;
	readonly recipes: {
		readonly peopleRecipe: MediaCreditsRecipe;
		readonly overviewRecipe: ReturnType<typeof mediaEpisodeCreditsRecipe>;
	};
}) => {
	const { copy, recipes } = input;
	const peopleQuery = createMediaCreditsQuery(
		recipes.peopleRecipe,
		({ entityId }) => ({ entityId }),
		"people",
	);
	const relations: MediaOverviewRelationsRender<MediaEpisodeCreditRows> = ({
		compact,
		entityId,
		overview,
		safeAreaTop,
	}) => {
		const sections = [
			{ title: copy.guestStars, people: overview.guestStars.items },
			{ title: copy.crew, people: overview.crew.items },
		].filter(({ people }) => people.length > 0);
		return (
			<ManagedAssetProvider
				assets={collectManagedAssetLocators(
					sections.flatMap(({ people }) => people.map(mediaPersonAsset)),
				)}
			>
				<div className="grid grid-cols-[minmax(0,1fr)] gap-8">
					{sections.map(({ title, people }, index) => (
						<MediaPeopleSection
							key={title}
							title={title}
							people={people}
							compact={compact}
							action={
								index === 0 ? (
									<MediaCreditsButton
										aspect="square"
										purpose="profile"
										compact={compact}
										title={copy.title}
										query={peopleQuery}
										input={{ entityId }}
										label={copy.fullCredits}
										safeAreaTop={safeAreaTop}
									/>
								) : null
							}
						/>
					))}
				</div>
			</ManagedAssetProvider>
		);
	};
	return {
		copy,
		relations,
		query: createMediaEntityQuery(recipes.overviewRecipe, (data) =>
			[...data.guestStars.items, ...data.crew.items].map(({ id }) => id),
		),
	};
};

export type MediaEpisodeCredits = ReturnType<typeof createMediaEpisodeCredits>;

/** An episode's credits, populated from its provider while the episode is open. */
export function MediaEpisodeCreditsSection(props: {
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly episode: MediaEpisode;
	readonly credits: MediaEpisodeCredits;
}) {
	const { episode, credits } = props;
	const result = useRyotQuery(credits.query, { entityId: episode.id });
	return (
		<MediaOverviewBody
			entityId={episode.id}
			compact={props.compact}
			refresh={result.refetch}
			relations={credits.relations}
			safeAreaTop={props.safeAreaTop}
			noticeTitle={credits.copy.title}
			state={mapMediaOverview(result)}
			loadingDetail={credits.copy.loading}
			related={episode.relatedPopulationStatus}
		/>
	);
}
