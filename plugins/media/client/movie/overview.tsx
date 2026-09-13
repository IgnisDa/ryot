import type { MovieOverviewResult } from "../../shared/movie-recipes";
import {
	mediaGroupOverviewIsEmpty,
	mediaGroupOverviewManagedAssets,
	MediaPartOfSection,
} from "../media/group-section";
import { MediaOverviewRelations, type MediaOverviewRelationsRender } from "../media/overview";
import { mediaRelationsAreEmpty } from "../media/overview-state";

export type MovieOverview = MovieOverviewResult;

export const movieOverviewManagedAssets = mediaGroupOverviewManagedAssets;

export const movieOverviewIsEmpty = mediaGroupOverviewIsEmpty;

export const movieOverviewRelations: MediaOverviewRelationsRender<MovieOverview> = ({
	compact,
	divided,
	overview,
}) => {
	const group = overview.group ?? null;
	return (
		<MediaOverviewRelations
			compact={compact}
			divided={divided}
			overview={overview}
			onViewAllPeople={() => console.log("TODO: open all movie credits")}
			trailing={
				group === null ? null : (
					<MediaPartOfSection
						group={group}
						aspect="poster"
						compact={compact}
						actionLabel="View collection"
						title={`Part of ${group.name}`}
						divided={divided || !mediaRelationsAreEmpty(overview)}
					/>
				)
			}
		/>
	);
};
