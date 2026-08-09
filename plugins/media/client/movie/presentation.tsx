import clsx from "clsx";

import { moviePresentationRecipe, type MoviePresentationData } from "../../shared/movie-recipes";
import { decimalLabel, mediaActivityDurationLabel } from "../media/activity-timeline";
import {
	createMediaPresentationLoader,
	defineMediaPresentationPair,
	MediaCardContent,
	MediaRowContent,
	type MediaPresentationViewData,
} from "../media/entity-presentation";
import { mediaReleaseLabel } from "../media/summary-state";
import { movieLifecycleLabel } from "./summary-state";

export type MoviePresentationViewData = MediaPresentationViewData<MoviePresentationData>;

export const loadMoviePresentations = createMediaPresentationLoader(moviePresentationRecipe);

const progressHint = (movie: MoviePresentationData) =>
	movie.state === "in_progress" && movie.progressPercent !== null
		? `${decimalLabel(movie.progressPercent)}% watched`
		: undefined;

function MovieFacts(props: { readonly compact: boolean; readonly data: MoviePresentationData }) {
	const release = mediaReleaseLabel(props.data);
	const progress = progressHint(props.data);
	return (
		<div className={clsx("flex min-w-0 flex-col", props.compact ? "gap-1" : "gap-1.5")}>
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-[12px] text-text-muted">
				{release === undefined ? null : <span>{release}</span>}
				{props.data.runtime === null ? null : (
					<span>{mediaActivityDurationLabel(props.data.runtime)}</span>
				)}
				<span className="font-medium text-accent-text">
					{movieLifecycleLabel(props.data.state)}
				</span>
			</div>
			{progress === undefined ? null : (
				<p className="font-ui text-[12px] leading-5 text-text-subtle">{progress}</p>
			)}
		</div>
	);
}

export function MovieCardContent(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly data: MoviePresentationViewData;
}) {
	return (
		<MediaCardContent
			aspect="poster"
			data={props.data}
			compact={props.compact}
			entityId={props.entityId}
			facts={<MovieFacts data={props.data} compact={props.compact} />}
		/>
	);
}

export function MovieRowContent(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly data: MoviePresentationViewData;
}) {
	return (
		<MediaRowContent
			aspect="poster"
			data={props.data}
			compact={props.compact}
			entityId={props.entityId}
			facts={<MovieFacts data={props.data} compact={props.compact} />}
		/>
	);
}

const moviePresentations = defineMediaPresentationPair({
	aspect: "poster",
	Facts: MovieFacts,
	loader: loadMoviePresentations,
});

export const movieCardPresentation = moviePresentations.cardPresentation;

export const movieRowPresentation = moviePresentations.rowPresentation;
