import type { ManagedAssetLocator } from "@ryot-app/client-sdk";
import {
	defineEntityPresentation,
	PluginLink,
	useRyotViewport,
	type EntityPresentationComponentProps,
	type EntityPresentationLoader,
} from "@ryot-app/client-sdk/plugin";
import { ManagedAssetProvider } from "@ryot-app/client-sdk/react";
import { fieldSyncState, isTitleProvisional, SyncPip } from "@ryot-app/client-ui-sdk/sync";
import clsx from "clsx";

import { moviePresentationRecipe, type MoviePresentationData } from "../../shared/movie-recipes";
import { mediaActivityDurationLabel, decimalLabel } from "../media/activity-timeline";
import { collectManagedAssetLocators } from "../media/image";
import { ManagedAssetImage } from "../media/managed-assets";
import { mediaPosterAsset, mediaReleaseLabel } from "../media/summary-state";
import { movieLifecycleLabel } from "./summary-state";

export type MoviePresentationViewData = MoviePresentationData & {
	readonly batchAssets: readonly ManagedAssetLocator[];
};

export const loadMoviePresentations: EntityPresentationLoader<MoviePresentationViewData> = async ({
	client,
	signal,
	references,
}) => {
	const entityIds = [...new Set(references.map(({ entityId }) => entityId))];
	const movies = await client.data.query(moviePresentationRecipe(entityIds), { signal });
	const batchAssets = collectManagedAssetLocators(movies.map(mediaPosterAsset));
	return Object.fromEntries(movies.map((movie) => [movie.id, { ...movie, batchAssets }]));
};

const progressHint = (movie: MoviePresentationData) =>
	movie.state === "in_progress" && movie.progressPercent !== null
		? `${decimalLabel(movie.progressPercent)}% watched`
		: undefined;

const artworkSize = (layout: "grid" | "list", compact: boolean) => {
	if (layout === "grid") {
		return "aspect-2/3 w-full";
	}
	return compact ? "h-20 w-14" : "h-24 w-16";
};

function MovieArtwork(props: {
	readonly compact: boolean;
	readonly layout: "grid" | "list";
	readonly movie: MoviePresentationViewData;
}) {
	const poster = mediaPosterAsset(props.movie);
	return (
		<ManagedAssetImage
			asset={poster}
			monogram={props.movie.name}
			state={fieldSyncState(poster, props.movie)}
			className={clsx("shrink-0", artworkSize(props.layout, props.compact))}
		/>
	);
}

function MovieFacts(props: { readonly compact: boolean; readonly movie: MoviePresentationData }) {
	const release = mediaReleaseLabel(props.movie);
	const progress = progressHint(props.movie);
	return (
		<div className={clsx("flex min-w-0 flex-col", props.compact ? "gap-1" : "gap-1.5")}>
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-[12px] text-text-muted">
				{release === undefined ? null : <span>{release}</span>}
				{props.movie.runtime === null ? null : (
					<span>{mediaActivityDurationLabel(props.movie.runtime)}</span>
				)}
				<span className="font-medium text-accent-text">
					{movieLifecycleLabel(props.movie.state)}
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
		<ManagedAssetProvider assets={props.data.batchAssets}>
			<article
				data-layout="grid"
				data-entity-id={props.entityId}
				className={clsx("flex h-full min-w-0 flex-col", props.compact ? "gap-2.5" : "gap-3")}
			>
				<PluginLink className="block min-w-0" to={{ kind: "entity", entityId: props.entityId }}>
					<MovieArtwork layout="grid" movie={props.data} compact={props.compact} />
				</PluginLink>
				<div className="flex min-w-0 flex-col gap-1.5">
					<span className="flex min-w-0 items-baseline gap-1.5">
						<PluginLink className="block min-w-0" to={{ kind: "entity", entityId: props.entityId }}>
							<span className="line-clamp-2 font-display font-semibold leading-5 text-text">
								{props.data.name}
							</span>
						</PluginLink>
						{isTitleProvisional(props.data) && <SyncPip reason="translating" />}
					</span>
					<MovieFacts movie={props.data} compact={props.compact} />
				</div>
			</article>
		</ManagedAssetProvider>
	);
}

export function MovieRowContent(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly data: MoviePresentationViewData;
}) {
	return (
		<ManagedAssetProvider assets={props.data.batchAssets}>
			<article
				data-layout="list"
				data-entity-id={props.entityId}
				className={clsx(
					"grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center border-b border-border",
					props.compact ? "gap-3 py-2.5" : "gap-4 py-3",
				)}
			>
				<PluginLink className="block min-w-0" to={{ kind: "entity", entityId: props.entityId }}>
					<MovieArtwork layout="list" movie={props.data} compact={props.compact} />
				</PluginLink>
				<div className="flex min-w-0 flex-col gap-1.5">
					<span className="flex min-w-0 items-baseline gap-1.5">
						<PluginLink className="block min-w-0" to={{ kind: "entity", entityId: props.entityId }}>
							<span className="line-clamp-2 font-display font-semibold text-text">
								{props.data.name}
							</span>
						</PluginLink>
						{isTitleProvisional(props.data) && <SyncPip reason="translating" />}
					</span>
					<MovieFacts movie={props.data} compact={props.compact} />
				</div>
			</article>
		</ManagedAssetProvider>
	);
}

function MovieCard({
	data,
	reference,
}: EntityPresentationComponentProps<MoviePresentationViewData>) {
	const { compact } = useRyotViewport();
	return <MovieCardContent data={data} compact={compact} entityId={reference.entityId} />;
}

function MovieRow({
	data,
	reference,
}: EntityPresentationComponentProps<MoviePresentationViewData>) {
	const { compact } = useRyotViewport();
	return <MovieRowContent data={data} compact={compact} entityId={reference.entityId} />;
}

export const movieCardPresentation = defineEntityPresentation({
	component: MovieCard,
	loader: loadMoviePresentations,
});

export const movieRowPresentation = defineEntityPresentation({
	component: MovieRow,
	loader: loadMoviePresentations,
});
