import type { ManagedAssetLocator } from "@ryot-app/client-sdk";
import {
	defineEntityPresentation,
	PluginLink,
	useRyotViewport,
	type EntityPresentationComponentProps,
	type EntityPresentationLoader,
} from "@ryot-app/client-sdk/plugin";
import { ManagedAssetProvider } from "@ryot-app/client-sdk/react";
import { fieldSyncState } from "@ryot-app/client-ui-sdk/sync";
import clsx from "clsx";

import { showPresentationRecipe, type ShowPresentationData } from "../../shared/show-recipes";
import { ManagedAssetImage } from "./managed-assets";
import { collectManagedAssetLocators } from "./media-image";
import {
	showCountLabel,
	showLifecycleLabel,
	showPosterAsset,
	showReleaseLabel,
} from "./summary-state";

export type ShowPresentationViewData = ShowPresentationData & {
	readonly batchAssets: readonly ManagedAssetLocator[];
};

export const loadShowPresentations: EntityPresentationLoader<ShowPresentationViewData> = async ({
	client,
	signal,
	references,
}) => {
	const entityIds = [...new Set(references.map(({ entityId }) => entityId))];
	const shows = await client.data.query(showPresentationRecipe(entityIds), { signal });
	const batchAssets = collectManagedAssetLocators(shows.map(showPosterAsset));
	return Object.fromEntries(shows.map((show) => [show.id, { ...show, batchAssets }]));
};

const episodeProgressLabel = (show: ShowPresentationData) => {
	if (show.storedEpisodes === 0) {
		return undefined;
	}
	if (show.watchedEpisodes === 0) {
		return showCountLabel(show.storedEpisodes, "stored episode");
	}
	return `${show.watchedEpisodes} of ${show.storedEpisodes} episodes watched`;
};

const artworkSize = (layout: "grid" | "list", compact: boolean) => {
	if (layout === "grid") {
		return "aspect-2/3 w-full";
	}
	return compact ? "h-20 w-14" : "h-24 w-16";
};

function ShowArtwork(props: {
	readonly compact: boolean;
	readonly show: ShowPresentationViewData;
	readonly layout: "grid" | "list";
}) {
	const poster = showPosterAsset(props.show);
	return (
		<ManagedAssetImage
			asset={poster}
			monogram={props.show.name}
			state={fieldSyncState(poster, props.show)}
			className={clsx("shrink-0", artworkSize(props.layout, props.compact))}
		/>
	);
}

function ShowFacts(props: { readonly show: ShowPresentationData; readonly compact: boolean }) {
	const release = showReleaseLabel(props.show);
	const progress = episodeProgressLabel(props.show);
	return (
		<div className={clsx("flex min-w-0 flex-col", props.compact ? "gap-1" : "gap-1.5")}>
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-ui text-[12px] text-text-muted">
				{release === undefined ? null : <span>{release}</span>}
				{props.show.productionStatus === null ? null : <span>{props.show.productionStatus}</span>}
				<span className="font-medium text-accent-text">{showLifecycleLabel(props.show.state)}</span>
			</div>
			{props.show.storedSeasons === 0 && progress === undefined ? null : (
				<p className="font-ui text-[12px] leading-5 text-text-subtle">
					{props.show.storedSeasons === 0
						? null
						: showCountLabel(props.show.storedSeasons, "stored season")}
					{props.show.storedSeasons > 0 && progress !== undefined ? " · " : null}
					{progress}
					{props.show.inProgressEpisodes > 0
						? ` · ${showCountLabel(props.show.inProgressEpisodes, "episode")} in progress`
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
		<ManagedAssetProvider assets={props.data.batchAssets}>
			<article
				data-layout="grid"
				data-entity-id={props.entityId}
				className={clsx(
					"flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card",
					props.compact ? "gap-2.5 p-2.5" : "gap-3 p-3",
				)}
			>
				<PluginLink className="block min-w-0" to={{ kind: "entity", entityId: props.entityId }}>
					<ShowArtwork compact={props.compact} layout="grid" show={props.data} />
				</PluginLink>
				<div className="flex min-w-0 flex-col gap-1.5">
					<PluginLink className="block min-w-0" to={{ kind: "entity", entityId: props.entityId }}>
						<span className="line-clamp-2 font-display font-semibold leading-5 text-text">
							{props.data.name}
						</span>
					</PluginLink>
					<ShowFacts compact={props.compact} show={props.data} />
				</div>
			</article>
		</ManagedAssetProvider>
	);
}

export function ShowRowContent(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly data: ShowPresentationViewData;
}) {
	return (
		<ManagedAssetProvider assets={props.data.batchAssets}>
			<article
				data-layout="list"
				data-entity-id={props.entityId}
				className={clsx(
					"grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center rounded-lg border border-border bg-surface",
					props.compact ? "gap-3 p-2.5" : "gap-4 p-3",
				)}
			>
				<PluginLink className="block min-w-0" to={{ kind: "entity", entityId: props.entityId }}>
					<ShowArtwork compact={props.compact} layout="list" show={props.data} />
				</PluginLink>
				<div className="flex min-w-0 flex-col gap-1.5">
					<PluginLink className="block min-w-0" to={{ kind: "entity", entityId: props.entityId }}>
						<span className="line-clamp-2 font-display font-semibold text-text">
							{props.data.name}
						</span>
					</PluginLink>
					<ShowFacts compact={props.compact} show={props.data} />
				</div>
			</article>
		</ManagedAssetProvider>
	);
}

function ShowCard({ data, reference }: EntityPresentationComponentProps<ShowPresentationViewData>) {
	const { compact } = useRyotViewport();
	return <ShowCardContent compact={compact} data={data} entityId={reference.entityId} />;
}

function ShowRow({ data, reference }: EntityPresentationComponentProps<ShowPresentationViewData>) {
	const { compact } = useRyotViewport();
	return <ShowRowContent compact={compact} data={data} entityId={reference.entityId} />;
}

export const showCardPresentation = defineEntityPresentation({
	component: ShowCard,
	loader: loadShowPresentations,
});

export const showRowPresentation = defineEntityPresentation({
	component: ShowRow,
	loader: loadShowPresentations,
});
