import clsx from "clsx";

import { showPresentationRecipe, type ShowPresentationData } from "../../shared/show-recipes";
import {
	createMediaPresentationLoader,
	defineMediaPresentationPair,
	MediaCardContent,
	MediaRowContent,
	type MediaPresentationViewData,
} from "../media/entity-presentation";
import { mediaCountLabel, mediaReleaseLabel } from "../media/summary-state";
import { showLifecycleLabel } from "./summary-state";

export type ShowPresentationViewData = MediaPresentationViewData<ShowPresentationData>;

export const loadShowPresentations = createMediaPresentationLoader(showPresentationRecipe);

const episodeProgressLabel = (show: ShowPresentationData) => {
	if (show.storedEpisodes === 0) {
		return undefined;
	}
	if (show.watchedEpisodes === 0) {
		return mediaCountLabel(show.storedEpisodes, "stored episode");
	}
	return `${show.watchedEpisodes} of ${show.storedEpisodes} episodes watched`;
};

function ShowFacts(props: { readonly data: ShowPresentationData; readonly compact: boolean }) {
	const release = mediaReleaseLabel(props.data);
	const progress = episodeProgressLabel(props.data);
	return (
		<div className={clsx("flex min-w-0 flex-col", props.compact ? "gap-1" : "gap-1.5")}>
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-[12px] text-text-muted">
				{release === undefined ? null : <span>{release}</span>}
				{props.data.productionStatus === null ? null : <span>{props.data.productionStatus}</span>}
				<span className="font-medium text-accent-text">{showLifecycleLabel(props.data.state)}</span>
			</div>
			{props.data.storedSeasons === 0 && progress === undefined ? null : (
				<p className="font-ui text-[12px] leading-5 text-text-subtle">
					{props.data.storedSeasons === 0
						? null
						: mediaCountLabel(props.data.storedSeasons, "stored season")}
					{props.data.storedSeasons > 0 && progress !== undefined ? " · " : null}
					{progress}
					{props.data.inProgressEpisodes > 0
						? ` · ${mediaCountLabel(props.data.inProgressEpisodes, "episode")} in progress`
						: null}
				</p>
			)}
		</div>
	);
}

export function ShowCardContent(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly data: ShowPresentationViewData;
}) {
	return (
		<MediaCardContent
			aspect="poster"
			data={props.data}
			compact={props.compact}
			entityId={props.entityId}
			facts={<ShowFacts data={props.data} compact={props.compact} />}
		/>
	);
}

export function ShowRowContent(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly data: ShowPresentationViewData;
}) {
	return (
		<MediaRowContent
			aspect="poster"
			data={props.data}
			compact={props.compact}
			entityId={props.entityId}
			facts={<ShowFacts data={props.data} compact={props.compact} />}
		/>
	);
}

const showPresentations = defineMediaPresentationPair({
	aspect: "poster",
	Facts: ShowFacts,
	loader: loadShowPresentations,
});

export const showCardPresentation = showPresentations.cardPresentation;

export const showRowPresentation = showPresentations.rowPresentation;
