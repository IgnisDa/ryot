import type { ManagedAssetLocator } from "@ryot-app/plugin-client-sdk";
import { Result } from "@ryot-app/plugin-client-sdk/effect";
import {
	defineEntityPresentation,
	deviceTimeZone,
	type EntityPresentationComponentProps,
	type EntityPresentationPrepare,
	type EntityReference,
	PluginLink,
	type TimeZone,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	collectManagedAssetLocators,
	type Formatters,
	ManagedAssetProvider,
	useAssetUrl,
	useEntitySchemaName,
	useFormatters,
} from "@ryot-app/plugin-client-sdk/react";
import { Eyebrow } from "@ryot-app/plugin-ui-sdk";
import {
	EntityArtWell,
	fieldSyncState,
	isTitleProvisional,
	SyncPip,
} from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";

import {
	type FitnessEntityPresentationData,
	fitnessEntityPresentationSource,
	fitnessPresentationSource,
	type FitnessPresentationSourceData,
} from "../shared/entity-presentations";
import { formatDay, formatValue } from "./measurements/model";
import { useFitnessMessages } from "./messages";

export type FitnessPresentationViewData = {
	readonly name: string;
	readonly callout: null | string;
	readonly primary: null | string;
	readonly secondary: null | string;
	readonly batchAssets: readonly ManagedAssetLocator[];
	readonly image: FitnessPresentationSourceData["presentationImage"];
	readonly latest: null | { readonly day: string; readonly value: number };
};

const buildFitnessPresentations = (
	formatters: Formatters,
	references: readonly EntityReference[],
	sources: readonly (FitnessPresentationSourceData | FitnessEntityPresentationData)[],
	timeZone: TimeZone,
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
			const batchAssets = collectManagedAssetLocators(
				rows.map(({ presentationImage }) => presentationImage ?? undefined),
			);
			return Object.fromEntries(
				rows.map((source) => [
					source.presentationId,
					{
						batchAssets,
						name: source.presentationName,
						image: source.presentationImage,
						callout: source.presentationCallout,
						primary: source.presentationPrimary,
						secondary: source.presentationSecondary,
						latest:
							"presentationLatestAt" in source &&
							"presentationLatestValue" in source &&
							typeof source.presentationLatestValue === "number" &&
							typeof source.presentationLatestAt === "string"
								? {
										value: source.presentationLatestValue,
										day: formatDay(formatters, source.presentationLatestAt, timeZone),
									}
								: null,
					},
				]),
			);
		},
	);
};

export const prepareFitnessPresentations: EntityPresentationPrepare<
	FitnessPresentationViewData
> = ({ sources, context, references, formatters }) => {
	const source = fitnessPresentationSource(references[0]?.entitySchemaSlug ?? "");
	return Result.flatMap(
		Result.all(references.map((reference) => source.decode(sources.get(reference.entityId)))),
		(rows) =>
			buildFitnessPresentations(
				formatters,
				references,
				rows,
				context?.timeZone ?? deviceTimeZone(),
			),
	);
};

const artworkSize = (layout: "grid" | "list", compact: boolean) => {
	if (layout === "grid") {
		return "aspect-3/4 w-full";
	}
	return compact ? "h-24 w-16" : "h-16 w-11";
};

function FitnessRow({
	data,
	reference,
}: EntityPresentationComponentProps<FitnessPresentationViewData>) {
	const { compact } = useRyotViewport();
	return <FitnessPresentation data={data} layout="list" compact={compact} reference={reference} />;
}

function FitnessCard({
	data,
	reference,
}: EntityPresentationComponentProps<FitnessPresentationViewData>) {
	const { compact } = useRyotViewport();
	return <FitnessPresentation data={data} layout="grid" compact={compact} reference={reference} />;
}

function FitnessArtwork(props: {
	readonly compact: boolean;
	readonly layout: "grid" | "list";
	readonly reference: EntityReference;
	readonly data: FitnessPresentationViewData;
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

function FitnessPresentation(props: {
	readonly compact: boolean;
	readonly layout: "grid" | "list";
	readonly reference: EntityReference;
	readonly data: FitnessPresentationViewData;
}) {
	const text = useFitnessMessages();
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
					to={{ kind: "entity", entityId: props.reference.entityId }}
					aria-label={text("client.presentation.open", { name: props.data.name })}
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

function FitnessFacts(props: {
	readonly reference: EntityReference;
	readonly data: FitnessPresentationViewData;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const schemaName = useEntitySchemaName();
	const { data } = props;
	const primary =
		data.latest === null
			? data.primary
			: text("client.presentation.latest", {
					day: data.latest.day,
					value: formatValue(formatters, text, data.latest.value, data.primary),
				});
	return (
		<div className="grid min-w-0 gap-1">
			<Eyebrow>{schemaName(props.reference)}</Eyebrow>
			<span className="flex min-w-0 items-baseline gap-1.5">
				<PluginLink className="min-w-0" to={{ kind: "entity", entityId: props.reference.entityId }}>
					<span className="line-clamp-2 min-w-0 text-[15px] font-semibold text-text">
						{props.data.name}
					</span>
				</PluginLink>
				{isTitleProvisional(props.reference) && <SyncPip reason="translating" />}
			</span>
			{primary !== null && <span className="truncate text-xs text-text-muted">{primary}</span>}
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

const prepareEntity: EntityPresentationPrepare<FitnessPresentationViewData> = ({
	sources,
	context,
	references,
	formatters,
}) =>
	Result.flatMap(
		Result.all(
			references.map((reference) =>
				fitnessEntityPresentationSource(reference.entitySchemaSlug).decode(
					sources.get(reference.entityId),
				),
			),
		),
		(rows) =>
			buildFitnessPresentations(
				formatters,
				references,
				rows,
				context?.timeZone ?? deviceTimeZone(),
			),
	);

export const fitnessEntityCardPresentation = defineEntityPresentation({
	component: FitnessCard,
	prepare: prepareEntity,
});
export const fitnessEntityRowPresentation = defineEntityPresentation({
	component: FitnessRow,
	prepare: prepareEntity,
});

export const fitnessCardPresentation = defineEntityPresentation({
	component: FitnessCard,
	prepare: prepareFitnessPresentations,
	entity: fitnessEntityCardPresentation,
});

export const fitnessRowPresentation = defineEntityPresentation({
	component: FitnessRow,
	prepare: prepareFitnessPresentations,
	entity: fitnessEntityRowPresentation,
});
