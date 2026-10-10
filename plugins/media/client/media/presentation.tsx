import type { ManagedAssetLocator } from "@ryot-app/client-sdk";
import {
	defineEntityPresentation,
	PluginLink,
	useRyotViewport,
	type EntityPresentationComponentProps,
	type EntityPresentationLoader,
	type EntityPresentationPrepare,
} from "@ryot-app/client-sdk/plugin";
import { ManagedAssetProvider } from "@ryot-app/client-sdk/react";
import { fieldSyncState, isTitleProvisional, SyncPip } from "@ryot-app/client-ui-sdk/sync";
import clsx from "clsx";

import {
	mediaPresentationSource,
	type MediaPresentationData,
} from "../../shared/entity-presentations";
import {
	createMediaPresentationLoader,
	createMediaPresentationPrepare,
} from "./entity-presentation";
import { ManagedAssetImage } from "./managed-assets";

export type MediaPresentationViewData = MediaPresentationData & {
	readonly batchAssets: readonly ManagedAssetLocator[];
};

const artworkSize = (layout: "grid" | "list", compact: boolean) => {
	if (layout === "grid") {
		return "aspect-3/4 w-full";
	}
	return compact ? "h-24 w-16" : "h-16 w-11 rounded-sm";
};

const posterAsset = (media: MediaPresentationData) => media.image ?? undefined;

export const prepareMediaPresentations: EntityPresentationPrepare<MediaPresentationViewData> = (
	context,
) => {
	const { references } = context;
	const slug = references[0]?.entitySchemaSlug ?? "";
	return createMediaPresentationPrepare(mediaPresentationSource(slug))(context);
};

export const loadMediaPresentations: EntityPresentationLoader<MediaPresentationViewData> = (
	context,
) => {
	const slug = context.references[0]?.entitySchemaSlug ?? "";
	return createMediaPresentationLoader(mediaPresentationSource(slug))(context);
};

const ratingLabel = (rating: number | null) =>
	rating === null ? undefined : rating.toLocaleString(undefined, { maximumFractionDigits: 1 });

function MediaArtwork(props: {
	readonly compact: boolean;
	readonly layout: "grid" | "list";
	readonly data: MediaPresentationViewData;
}) {
	const poster = posterAsset(props.data);
	return (
		<ManagedAssetImage
			asset={poster}
			monogram={props.data.name}
			state={fieldSyncState(poster, props.data)}
			className={clsx("shrink-0", artworkSize(props.layout, props.compact))}
		/>
	);
}

function MediaFacts(props: { readonly schemaName: string; readonly data: MediaPresentationData }) {
	const rating = ratingLabel(props.data.rating);
	return (
		<div className="grid min-w-0 gap-1">
			<span className="truncate text-[11px] font-semibold tracking-wide text-text-subtle uppercase">
				{props.schemaName}
			</span>
			<span className="flex min-w-0 items-baseline gap-1.5">
				<PluginLink className="min-w-0" to={{ kind: "entity", entityId: props.data.id }}>
					<span className="line-clamp-2 min-w-0 text-[15px] font-semibold text-text">
						{props.data.name}
					</span>
				</PluginLink>
				{isTitleProvisional(props.data) && <SyncPip reason="translating" />}
			</span>
			{props.data.primary !== null && (
				<span className="truncate text-xs text-text-muted">{props.data.primary}</span>
			)}
			{props.data.secondary !== null && (
				<span className="truncate text-xs text-text-subtle">{props.data.secondary}</span>
			)}
			{rating !== undefined && (
				<span className="truncate text-xs font-semibold text-accent-text">{rating}</span>
			)}
		</div>
	);
}

const schemaLabel = (entitySchemaSlug: string) => entitySchemaSlug.split("-").join(" ");

export function MediaCardContent(props: {
	readonly compact: boolean;
	readonly data: MediaPresentationViewData;
}) {
	return (
		<ManagedAssetProvider assets={props.data.batchAssets}>
			<article
				data-layout="grid"
				data-entity-id={props.data.id}
				className="grid min-w-0 content-start gap-2"
			>
				<PluginLink
					className="block min-w-0"
					aria-label={`Open ${props.data.name}`}
					to={{ kind: "entity", entityId: props.data.id }}
				>
					<MediaArtwork layout="grid" data={props.data} compact={props.compact} />
				</PluginLink>
				<MediaFacts data={props.data} schemaName={schemaLabel(props.data.schemaSlug)} />
			</article>
		</ManagedAssetProvider>
	);
}

export function MediaRowContent(props: {
	readonly compact: boolean;
	readonly data: MediaPresentationViewData;
}) {
	return (
		<ManagedAssetProvider assets={props.data.batchAssets}>
			<article
				data-layout="list"
				data-entity-id={props.data.id}
				className={clsx(
					"flex min-w-0 items-center border-b border-border",
					props.compact ? "min-h-28 gap-3 py-2" : "min-h-18 gap-3.5 py-2",
				)}
			>
				<PluginLink
					className="block shrink-0"
					aria-label={`Open ${props.data.name}`}
					to={{ kind: "entity", entityId: props.data.id }}
				>
					<MediaArtwork layout="list" data={props.data} compact={props.compact} />
				</PluginLink>
				<div className="min-w-0 flex-1">
					<MediaFacts data={props.data} schemaName={schemaLabel(props.data.schemaSlug)} />
				</div>
			</article>
		</ManagedAssetProvider>
	);
}

function MediaCard({ data }: EntityPresentationComponentProps<MediaPresentationViewData>) {
	const { compact } = useRyotViewport();
	return <MediaCardContent data={data} compact={compact} />;
}

function MediaRow({ data }: EntityPresentationComponentProps<MediaPresentationViewData>) {
	const { compact } = useRyotViewport();
	return <MediaRowContent data={data} compact={compact} />;
}

export const mediaCardPresentation = defineEntityPresentation({
	component: MediaCard,
	loader: loadMediaPresentations,
	prepare: prepareMediaPresentations,
});

export const mediaRowPresentation = defineEntityPresentation({
	component: MediaRow,
	loader: loadMediaPresentations,
	prepare: prepareMediaPresentations,
});
