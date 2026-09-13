import clsx from "clsx";

import { musicPresentationRecipe, type MusicPresentationData } from "../../shared/music-recipes";
import { decimalLabel, mediaTrackLengthLabel } from "../media/activity-timeline";
import {
	createMediaPresentationLoader,
	defineMediaPresentationPair,
	MediaCardContent,
	MediaRowContent,
	type MediaPresentationViewData,
} from "../media/entity-presentation";
import { mediaReleaseLabel } from "../media/summary-state";
import { musicLifecycleLabel } from "./summary-state";

export type MusicPresentationViewData = MediaPresentationViewData<MusicPresentationData>;

export const loadMusicPresentations = createMediaPresentationLoader(musicPresentationRecipe);

const progressHint = (music: MusicPresentationData) =>
	music.state === "in_progress" && music.progressPercent !== null
		? `${decimalLabel(music.progressPercent)}% played`
		: undefined;

function MusicFacts(props: { readonly compact: boolean; readonly data: MusicPresentationData }) {
	const release = mediaReleaseLabel(props.data);
	const progress = progressHint(props.data);
	return (
		<div className={clsx("flex min-w-0 flex-col", props.compact ? "gap-1" : "gap-1.5")}>
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-[12px] text-text-muted">
				{release === undefined ? null : <span>{release}</span>}
				{props.data.duration === null ? null : (
					<span>{mediaTrackLengthLabel(props.data.duration)}</span>
				)}
				<span className="font-medium text-accent-text">
					{musicLifecycleLabel(props.data.state)}
				</span>
			</div>
			{progress === undefined ? null : (
				<p className="font-ui text-[12px] leading-5 text-text-subtle">{progress}</p>
			)}
		</div>
	);
}

export function MusicCardContent(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly data: MusicPresentationViewData;
}) {
	return (
		<MediaCardContent
			aspect="square"
			data={props.data}
			compact={props.compact}
			entityId={props.entityId}
			facts={<MusicFacts data={props.data} compact={props.compact} />}
		/>
	);
}

export function MusicRowContent(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly data: MusicPresentationViewData;
}) {
	return (
		<MediaRowContent
			aspect="square"
			data={props.data}
			compact={props.compact}
			entityId={props.entityId}
			facts={<MusicFacts data={props.data} compact={props.compact} />}
		/>
	);
}

const musicPresentations = defineMediaPresentationPair({
	aspect: "square",
	Facts: MusicFacts,
	loader: loadMusicPresentations,
});

export const musicCardPresentation = musicPresentations.cardPresentation;

export const musicRowPresentation = musicPresentations.rowPresentation;
