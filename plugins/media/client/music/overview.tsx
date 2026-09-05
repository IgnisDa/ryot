import type { MusicOverviewResult } from "../../shared/music-recipes";
import {
	mediaGroupOverviewIsEmpty,
	mediaGroupOverviewManagedAssets,
	MediaPartOfSection,
} from "../media/group-section";
import { MediaOverviewRelations, type MediaOverviewRelationsRender } from "../media/overview";
import { mediaRelationsAreEmpty } from "../media/overview-state";

export type MusicOverview = MusicOverviewResult;

export const musicOverviewManagedAssets = mediaGroupOverviewManagedAssets;

export const musicOverviewIsEmpty = mediaGroupOverviewIsEmpty;

export const musicOverviewRelations: MediaOverviewRelationsRender<MusicOverview> = ({
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
			onViewAllPeople={() => console.log("TODO: open all music credits")}
			trailing={
				group === null ? null : (
					<MediaPartOfSection
						group={group}
						aspect="square"
						compact={compact}
						actionLabel="View album"
						title={`Part of ${group.name}`}
						divided={divided || !mediaRelationsAreEmpty(overview)}
					/>
				)
			}
		/>
	);
};
