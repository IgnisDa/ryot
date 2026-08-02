import type { ManagedAssetLocator } from "@ryot-app/client-sdk";
import {
	defineEntityPresentation,
	PluginLink,
	useRyotViewport,
	type EntityPresentationComponentProps,
	type EntityPresentationLoader,
} from "@ryot-app/client-sdk/plugin";
import {
	ManagedAssetProvider,
	managedAssetKey,
	useManagedAssetUrl,
} from "@ryot-app/client-sdk/react";
import {
	EntityArtWell,
	fieldSyncState,
	isTitleProvisional,
	SyncPip,
} from "@ryot-app/client-ui-sdk/sync";
import clsx from "clsx";

import {
	fitnessPresentationRecipe,
	type FitnessPresentationData,
} from "./entity-presentation-query";

export type FitnessPresentationViewData = FitnessPresentationData & {
	readonly batchAssets: readonly ManagedAssetLocator[];
};

const coverAsset = (data: FitnessPresentationData) => data.images?.[0];

export const loadFitnessPresentations: EntityPresentationLoader<
	FitnessPresentationViewData
> = async ({ client, signal, references }) => {
	const slug = references[0]?.entitySchemaSlug ?? "";
	const entityIds = [...new Set(references.map(({ entityId }) => entityId))];
	const rows = await client.data.query(fitnessPresentationRecipe({ slug, entityIds }), { signal });
	const managed = rows
		.map(coverAsset)
		.filter(
			(asset): asset is ManagedAssetLocator => asset !== undefined && asset.type !== "remote",
		);
	const batchAssets = [
		...new Map(managed.map((asset) => [managedAssetKey(asset), asset])).values(),
	].sort((left, right) => managedAssetKey(left).localeCompare(managedAssetKey(right)));
	return Object.fromEntries(rows.map((row) => [row.id, { ...row, batchAssets }]));
};

const schemaLabel = (entitySchemaSlug: string) => entitySchemaSlug.split("-").join(" ");

const artworkSize = (layout: "grid" | "list", compact: boolean) => {
	if (layout === "grid") {
		return "aspect-3/4 w-full";
	}
	return compact ? "h-24 w-16" : "h-16 w-11";
};

function FitnessArtwork(props: {
	readonly compact: boolean;
	readonly layout: "grid" | "list";
	readonly data: FitnessPresentationViewData;
}) {
	const asset = coverAsset(props.data);
	const managedUrl = useManagedAssetUrl(asset?.type === "remote" ? undefined : asset);
	return (
		<EntityArtWell
			shape="rounded"
			monogram={props.data.name}
			state={fieldSyncState(asset, props.data)}
			url={asset?.type === "remote" ? asset.url : managedUrl}
			className={clsx("shrink-0", artworkSize(props.layout, props.compact))}
		/>
	);
}

function FitnessFacts(props: { readonly data: FitnessPresentationData }) {
	return (
		<div className="grid min-w-0 gap-1">
			<span className="truncate text-[11px] font-semibold tracking-wide text-text-subtle uppercase">
				{schemaLabel(props.data.schemaSlug)}
			</span>
			<span className="flex min-w-0 items-baseline gap-1.5">
				<PluginLink to={{ kind: "entity", entityId: props.data.id }} className="min-w-0">
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
			{props.data.callout !== null && (
				<span className="truncate text-xs font-semibold text-accent-text">
					{props.data.callout}
				</span>
			)}
		</div>
	);
}

function FitnessPresentation(props: {
	readonly compact: boolean;
	readonly layout: "grid" | "list";
	readonly data: FitnessPresentationViewData;
}) {
	return (
		<ManagedAssetProvider assets={props.data.batchAssets}>
			<article
				data-layout={props.layout}
				data-entity-id={props.data.id}
				className={clsx(
					"min-w-0",
					props.layout === "grid"
						? "grid content-start gap-2"
						: clsx(
								"flex items-center border-b border-border py-2",
								props.compact ? "min-h-28 gap-3" : "min-h-18 gap-3.5",
							),
				)}
			>
				<PluginLink
					aria-label={`Open ${props.data.name}`}
					to={{ kind: "entity", entityId: props.data.id }}
					className={props.layout === "grid" ? "block min-w-0" : "block shrink-0"}
				>
					<FitnessArtwork compact={props.compact} layout={props.layout} data={props.data} />
				</PluginLink>
				<div className="min-w-0 flex-1">
					<FitnessFacts data={props.data} />
				</div>
			</article>
		</ManagedAssetProvider>
	);
}

function FitnessCard({ data }: EntityPresentationComponentProps<FitnessPresentationViewData>) {
	const { compact } = useRyotViewport();
	return <FitnessPresentation compact={compact} layout="grid" data={data} />;
}

function FitnessRow({ data }: EntityPresentationComponentProps<FitnessPresentationViewData>) {
	const { compact } = useRyotViewport();
	return <FitnessPresentation compact={compact} layout="list" data={data} />;
}

export const fitnessCardPresentation = defineEntityPresentation({
	component: FitnessCard,
	loader: loadFitnessPresentations,
});

export const fitnessRowPresentation = defineEntityPresentation({
	component: FitnessRow,
	loader: loadFitnessPresentations,
});
