import type { ManagedAssetLocator } from "@ryot-app/client-sdk";
import { Result } from "@ryot-app/client-sdk/effect";
import {
	defineEntityPresentation,
	PluginLink,
	useRyotViewport,
	type EntityPresentationComponentProps,
	type EntityPresentationLoader,
	type EntityPresentationPrepare,
	type EntityReference,
} from "@ryot-app/client-sdk/plugin";
import { ManagedAssetProvider } from "@ryot-app/client-sdk/react";
import { defineRecipe } from "@ryot-app/client-sdk/ryotql";
import {
	EntityArtWell,
	fieldSyncState,
	isTitleProvisional,
	SyncPip,
} from "@ryot-app/client-ui-sdk/sync";
import clsx from "clsx";

import {
	fitnessPresentationSource,
	type FitnessPresentationSourceData,
} from "../shared/entity-presentations";
import { managedAssetBatch, useAssetUrl } from "./asset-urls";

export type FitnessPresentationViewData = {
	readonly callout: string | null;
	readonly image: FitnessPresentationSourceData["presentationImage"];
	readonly name: string;
	readonly primary: string | null;
	readonly secondary: string | null;
	readonly batchAssets: readonly ManagedAssetLocator[];
};

const buildFitnessPresentations = (
	references: readonly EntityReference[],
	sources: readonly FitnessPresentationSourceData[],
) => {
	const byId = new Map(sources.map((source) => [source.presentationId, source]));
	return Result.map(
		Result.all(
			references.map((reference) => {
				const source = byId.get(reference.entityId);
				return source === undefined
					? Result.fail(
							new Error(`Missing fitness presentation source for '${reference.entityId}'`),
						)
					: Result.succeed(source);
			}),
		),
		(rows) => {
			const batchAssets = managedAssetBatch(
				rows.map(({ presentationImage }) => presentationImage ?? undefined),
			);
			return Object.fromEntries(
				rows.map((source) => [
					source.presentationId,
					{
						batchAssets,
						name: source.presentationName,
						image: source.presentationImage,
						primary: source.presentationPrimary,
						callout: source.presentationCallout,
						secondary: source.presentationSecondary,
					},
				]),
			);
		},
	);
};

export const prepareFitnessPresentations: EntityPresentationPrepare<
	FitnessPresentationViewData
> = ({ sources, references }) => {
	const source = fitnessPresentationSource(references[0]?.entitySchemaSlug ?? "");
	return Result.flatMap(
		Result.all(references.map((reference) => source.decode(sources.get(reference.entityId)))),
		(rows) => buildFitnessPresentations(references, rows),
	);
};

export const loadFitnessPresentations: EntityPresentationLoader<FitnessPresentationViewData> = ({
	client,
	references,
}) => {
	const source = fitnessPresentationSource(references[0]?.entitySchemaSlug ?? "");
	const entityIds = [...new Set(references.map(({ entityId }) => entityId))];
	const recipe = defineRecipe(() => ({
		queries: { presentations: source.query(entityIds) },
		map: ({ presentations }) => buildFitnessPresentations(references, presentations.items),
	}))();
	return client.data.query(recipe);
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
	readonly reference: EntityReference;
}) {
	const asset = props.data.image ?? undefined;
	const url = useAssetUrl(asset);
	return (
		<EntityArtWell
			url={url}
			shape="rounded"
			monogram={props.data.name}
			state={fieldSyncState(asset, props.reference)}
			className={clsx("shrink-0", artworkSize(props.layout, props.compact))}
		/>
	);
}

function FitnessFacts(props: {
	readonly data: FitnessPresentationViewData;
	readonly reference: EntityReference;
}) {
	return (
		<div className="grid min-w-0 gap-1">
			<span className="truncate text-[11px] font-semibold tracking-wide text-text-subtle uppercase">
				{schemaLabel(props.reference.entitySchemaSlug)}
			</span>
			<span className="flex min-w-0 items-baseline gap-1.5">
				<PluginLink className="min-w-0" to={{ kind: "entity", entityId: props.reference.entityId }}>
					<span className="line-clamp-2 min-w-0 text-[15px] font-semibold text-text">
						{props.data.name}
					</span>
				</PluginLink>
				{isTitleProvisional(props.reference) && <SyncPip reason="translating" />}
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
	readonly reference: EntityReference;
}) {
	return (
		<ManagedAssetProvider assets={props.data.batchAssets}>
			<article
				data-layout={props.layout}
				data-entity-id={props.reference.entityId}
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
					to={{ kind: "entity", entityId: props.reference.entityId }}
					className={props.layout === "grid" ? "block min-w-0" : "block shrink-0"}
				>
					<FitnessArtwork
						data={props.data}
						layout={props.layout}
						compact={props.compact}
						reference={props.reference}
					/>
				</PluginLink>
				<div className="min-w-0 flex-1">
					<FitnessFacts data={props.data} reference={props.reference} />
				</div>
			</article>
		</ManagedAssetProvider>
	);
}

function FitnessCard({
	data,
	reference,
}: EntityPresentationComponentProps<FitnessPresentationViewData>) {
	const { compact } = useRyotViewport();
	return <FitnessPresentation data={data} layout="grid" compact={compact} reference={reference} />;
}

function FitnessRow({
	data,
	reference,
}: EntityPresentationComponentProps<FitnessPresentationViewData>) {
	const { compact } = useRyotViewport();
	return <FitnessPresentation data={data} layout="list" compact={compact} reference={reference} />;
}

export const fitnessCardPresentation = defineEntityPresentation({
	component: FitnessCard,
	loader: loadFitnessPresentations,
	prepare: prepareFitnessPresentations,
});

export const fitnessRowPresentation = defineEntityPresentation({
	component: FitnessRow,
	loader: loadFitnessPresentations,
	prepare: prepareFitnessPresentations,
});
