import type { ManagedAssetLocator } from "@ryot-app/client-sdk";
import { Effect, Result } from "@ryot-app/client-sdk/effect";
import {
	defineEntityPresentation,
	PluginLink,
	useRyotViewport,
	type EntityPresentationComponentProps,
	type EntityPresentationLoader,
	type EntityPresentationPrepare,
} from "@ryot-app/client-sdk/plugin";
import { ManagedAssetProvider } from "@ryot-app/client-sdk/react";
import {
	fieldSyncState,
	isTitleProvisional,
	SyncPip,
	type EntitySyncState,
} from "@ryot-app/client-ui-sdk/sync";
import clsx from "clsx";
import type { ReactNode } from "react";

import {
	mediaPresentationSourceRecipe,
	type MediaPresentationSource,
} from "../../shared/entity-presentations";
import { collectManagedAssetLocators, type MediaImageAsset, type MediaImages } from "./image";
import { ManagedAssetImage } from "./managed-assets";

export type MediaArtworkAspect = "poster" | "square" | "still";

type MediaArtworkLayout = "grid" | "list" | "rail";

export type MediaPresentationSubject = EntitySyncState & {
	readonly id: string;
	readonly name: string;
	readonly images: MediaImages;
};

export type MediaSavedViewPresentationSubject = EntitySyncState & {
	readonly id: string;
	readonly name: string;
	readonly image: MediaImageAsset | null;
};

export type MediaPresentationViewData<Data> = Data & {
	readonly batchAssets: readonly ManagedAssetLocator[];
};

const GRID_ASPECT_CLASS: Record<MediaArtworkAspect, string> = {
	poster: "aspect-2/3",
	still: "aspect-video",
	square: "aspect-square",
};

export const mediaAspectClass = (aspect: MediaArtworkAspect) => GRID_ASPECT_CLASS[aspect];

const RAIL_WIDTH_CLASS: Record<MediaArtworkAspect, { compact: string; regular: string }> = {
	poster: { compact: "w-28", regular: "w-32" },
	square: { compact: "w-42", regular: "w-48" },
	still: { compact: "w-74.75", regular: "w-85.25" },
};

export const mediaRailWidthClass = (input: {
	readonly compact: boolean;
	readonly aspect: MediaArtworkAspect;
}) => RAIL_WIDTH_CLASS[input.aspect][input.compact ? "compact" : "regular"];

export const mediaArtworkClass = (input: {
	readonly compact: boolean;
	readonly layout: MediaArtworkLayout;
	readonly aspect: MediaArtworkAspect;
}) => {
	if (input.layout === "grid") {
		return `${mediaAspectClass(input.aspect)} w-full`;
	}
	if (input.layout === "rail") {
		return clsx(
			input.compact ? "h-42" : "h-48",
			mediaRailWidthClass(input),
			mediaAspectClass(input.aspect),
		);
	}
	if (input.aspect === "square") {
		return input.compact ? "h-20 w-20" : "h-24 w-24";
	}
	if (input.aspect === "still") {
		return input.compact ? "h-20 w-35.5" : "h-24 w-42.75";
	}
	return input.compact ? "h-20 w-14" : "h-24 w-16";
};

export const createMediaPresentationPrepare =
	<Data extends MediaSavedViewPresentationSubject>(
		source: MediaPresentationSource<Data>,
	): EntityPresentationPrepare<MediaPresentationViewData<Data>> =>
	({ sources, references }) => {
		const decoded = Result.all(
			references.map((reference) => {
				const raw = sources.get(reference.entityId);
				if (raw === undefined) {
					return Result.fail(
						new Error(`Missing media presentation source for '${reference.entityId}'`),
					);
				}
				return Result.flatMap(source.decode(raw), (data) =>
					data.id === reference.entityId
						? Result.succeed(data)
						: Result.fail(
								new Error(`Media presentation source ID did not match '${reference.entityId}'`),
							),
				);
			}),
		);
		return Result.map(decoded, prepareMediaPresentationRows);
	};

const prepareMediaPresentationRows = <Data extends MediaSavedViewPresentationSubject>(
	rows: readonly Data[],
) => {
	const batchAssets = collectManagedAssetLocators(rows.map(({ image }) => image ?? undefined));
	return Object.fromEntries(rows.map((row) => [row.id, { ...row, batchAssets }]));
};

export const createMediaPresentationLoader =
	<Data extends MediaSavedViewPresentationSubject>(
		source: MediaPresentationSource<Data>,
	): EntityPresentationLoader<MediaPresentationViewData<Data>> =>
	({ client, references }) => {
		const entitySchemaSlug = references[0]?.entitySchemaSlug ?? "";
		const entityIds = [...new Set(references.map(({ entityId }) => entityId))];
		return client.data
			.query(mediaPresentationSourceRecipe(source, { entityIds, entitySchemaSlug }))
			.pipe(Effect.map(prepareMediaPresentationRows));
	};

export function MediaEntityArtwork(props: {
	readonly compact: boolean;
	readonly layout: MediaArtworkLayout;
	readonly aspect: MediaArtworkAspect;
	readonly data: MediaSavedViewPresentationSubject;
}) {
	const poster = props.data.image ?? undefined;
	return (
		<ManagedAssetImage
			asset={poster}
			monogram={props.data.name}
			state={fieldSyncState(poster, props.data)}
			className={clsx(
				"shrink-0",
				mediaArtworkClass({ aspect: props.aspect, layout: props.layout, compact: props.compact }),
			)}
		/>
	);
}

function MediaPresentationTitle(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly leading?: string;
	readonly data: MediaSavedViewPresentationSubject;
	readonly facts: ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<span className="flex min-w-0 items-baseline gap-1.5">
				<PluginLink className="block min-w-0" to={{ kind: "entity", entityId: props.entityId }}>
					<span
						className={clsx("line-clamp-2 font-display font-semibold text-text", props.leading)}
					>
						{props.data.name}
					</span>
				</PluginLink>
				{isTitleProvisional(props.data) && <SyncPip reason="translating" />}
			</span>
			{props.facts}
		</div>
	);
}

export function MediaCardContent<Data extends MediaSavedViewPresentationSubject>(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly facts: ReactNode;
	readonly aspect: MediaArtworkAspect;
	readonly data: MediaPresentationViewData<Data>;
}) {
	return (
		<ManagedAssetProvider assets={props.data.batchAssets}>
			<article
				data-layout="grid"
				data-entity-id={props.entityId}
				className={clsx("flex h-full min-w-0 flex-col", props.compact ? "gap-2.5" : "gap-3")}
			>
				<PluginLink className="block min-w-0" to={{ kind: "entity", entityId: props.entityId }}>
					<MediaEntityArtwork
						layout="grid"
						data={props.data}
						aspect={props.aspect}
						compact={props.compact}
					/>
				</PluginLink>
				<MediaPresentationTitle
					data={props.data}
					leading="leading-5"
					facts={props.facts}
					compact={props.compact}
					entityId={props.entityId}
				/>
			</article>
		</ManagedAssetProvider>
	);
}

export function MediaRowContent<Data extends MediaSavedViewPresentationSubject>(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly facts: ReactNode;
	readonly position?: string | undefined;
	readonly aspect: MediaArtworkAspect;
	readonly data: MediaPresentationViewData<Data>;
}) {
	return (
		<ManagedAssetProvider assets={props.data.batchAssets}>
			<article
				data-layout="list"
				data-entity-id={props.entityId}
				className={clsx(
					"grid min-w-0 items-center border-b border-border",
					props.position === undefined
						? "grid-cols-[auto_minmax(0,1fr)]"
						: "grid-cols-[2rem_auto_minmax(0,1fr)]",
					props.compact ? "gap-3 py-2.5" : "gap-4 py-3",
				)}
			>
				{props.position === undefined ? null : (
					<span className="text-right font-ui font-medium text-[12px] text-text-subtle tabular-nums">
						{props.position}
					</span>
				)}
				<PluginLink className="block min-w-0" to={{ kind: "entity", entityId: props.entityId }}>
					<MediaEntityArtwork
						layout="list"
						data={props.data}
						aspect={props.aspect}
						compact={props.compact}
					/>
				</PluginLink>
				<MediaPresentationTitle
					data={props.data}
					facts={props.facts}
					compact={props.compact}
					entityId={props.entityId}
				/>
			</article>
		</ManagedAssetProvider>
	);
}

export const defineMediaPresentationPair = <Data extends MediaSavedViewPresentationSubject>(input: {
	readonly aspect: MediaArtworkAspect;
	readonly source: MediaPresentationSource<Data>;
	readonly Facts: (props: { readonly compact: boolean; readonly data: Data }) => ReactNode;
}) => {
	const { Facts } = input;
	const loader = createMediaPresentationLoader(input.source);
	const prepare = createMediaPresentationPrepare(input.source);
	const Card = ({
		data,
		reference,
	}: EntityPresentationComponentProps<MediaPresentationViewData<Data>>) => {
		const { compact } = useRyotViewport();
		return (
			<MediaCardContent
				data={data}
				compact={compact}
				aspect={input.aspect}
				entityId={reference.entityId}
				facts={<Facts data={data} compact={compact} />}
			/>
		);
	};
	const Row = ({
		data,
		reference,
	}: EntityPresentationComponentProps<MediaPresentationViewData<Data>>) => {
		const { compact } = useRyotViewport();
		return (
			<MediaRowContent
				data={data}
				compact={compact}
				aspect={input.aspect}
				entityId={reference.entityId}
				facts={<Facts data={data} compact={compact} />}
			/>
		);
	};
	return {
		rowPresentation: defineEntityPresentation({ loader, prepare, component: Row }),
		cardPresentation: defineEntityPresentation({ loader, prepare, component: Card }),
	};
};
