import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import { Button, Shelf } from "@ryot-app/plugin-ui-sdk";
import { fieldSyncState } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import type { ReactNode } from "react";

import {
	type MediaArtworkAspect,
	mediaArtworkClass,
	type MediaPresentationSubject,
	mediaRailWidthClass,
} from "./entity-presentation";
import type { MediaImageAsset } from "./image";
import { ManagedAssetImage } from "./managed-assets";
import { MediaOverviewSection, mediaShelfIcons } from "./primitives";
import { mediaPosterAsset } from "./summary-state";
import { type MediaSyncCounts, mediaSyncCounts } from "./sync-counts";

export type MediaRailStatus =
	| { readonly kind: "pending" }
	| { readonly kind: "ready" }
	| { readonly kind: "error"; readonly retry: () => void };

const PENDING_TILE_COUNT = 4;

export function MediaEntityTile(props: {
	readonly compact: boolean;
	readonly aspect: MediaArtworkAspect;
	readonly item: MediaPresentationSubject;
	readonly overlay?: ReactNode;
	readonly art?: MediaImageAsset | undefined;
	readonly lines?: readonly (string | undefined)[] | undefined;
}) {
	const { item } = props;
	const art = props.art ?? mediaPosterAsset(item);
	return (
		<PluginLink
			aria-label={`Open ${item.name}`}
			to={{ kind: "entity", entityId: item.id }}
			className={clsx(
				"group flex flex-col gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-accent",
				mediaRailWidthClass({ aspect: props.aspect, compact: props.compact }),
			)}
		>
			<div className="relative">
				<ManagedAssetImage
					asset={art}
					monogram={item.name}
					state={fieldSyncState(art, item)}
					className={clsx(
						"shadow-sm transition-transform duration-150 group-hover:-translate-y-0.5 motion-reduce:transition-none",
						mediaArtworkClass({ layout: "rail", aspect: props.aspect, compact: props.compact }),
					)}
				/>
				{props.overlay === undefined ? null : (
					<div className="pointer-events-none absolute inset-0">{props.overlay}</div>
				)}
			</div>
			<p className="line-clamp-2 text-[13px] leading-[18px] font-medium text-text">{item.name}</p>
			{(props.lines ?? []).map((line) =>
				line === undefined ? null : (
					<p key={line} className="line-clamp-1 text-xs text-text-muted">
						{line}
					</p>
				),
			)}
		</PluginLink>
	);
}

type MediaSectionFrameProps = {
	readonly title: string;
	readonly compact: boolean;
	readonly action?: ReactNode;
	readonly status: MediaRailStatus;
	readonly children?: ReactNode;
	readonly sync?: MediaSyncCounts | undefined;
};

export function MediaSectionFrame(
	props: MediaSectionFrameProps & { readonly placeholder: ReactNode },
) {
	const { status } = props;
	return (
		<MediaOverviewSection sync={props.sync} title={props.title} action={props.action}>
			{status.kind === "ready" ? props.children : null}
			{status.kind === "pending" ? (
				<div role="status" aria-label={`Loading ${props.title}`}>
					{props.placeholder}
				</div>
			) : null}
			{status.kind === "error" ? (
				<div role="alert" className="flex flex-col items-start gap-2">
					<p className="font-ui text-[13px] text-text-muted">Unable to load this section.</p>
					<Button variant="link" onClick={status.retry}>
						Try again
					</Button>
				</div>
			) : null}
		</MediaOverviewSection>
	);
}

export function MediaRailFrame(props: MediaSectionFrameProps) {
	return (
		<MediaSectionFrame
			{...props}
			placeholder={
				<Shelf label={props.title} compact={props.compact} icons={mediaShelfIcons}>
					{Array.from({ length: PENDING_TILE_COUNT }, (_, index) => (
						<div
							key={index}
							className={clsx(
								"animate-pulse rounded-lg bg-surface-2",
								mediaArtworkClass({ layout: "rail", aspect: "poster", compact: props.compact }),
							)}
						/>
					))}
				</Shelf>
			}
		>
			<Shelf label={props.title} compact={props.compact} icons={mediaShelfIcons}>
				{props.children}
			</Shelf>
		</MediaSectionFrame>
	);
}

export function MediaEntityRailSection<Item extends MediaPresentationSubject>(props: {
	readonly title: string;
	readonly compact: boolean;
	readonly action?: ReactNode;
	readonly items: readonly Item[];
	readonly aspect: (item: Item) => MediaArtworkAspect;
	readonly lines?: ((item: Item) => readonly (string | undefined)[]) | undefined;
}) {
	if (props.items.length === 0) {
		return null;
	}
	return (
		<MediaRailFrame
			title={props.title}
			action={props.action}
			compact={props.compact}
			status={{ kind: "ready" }}
			sync={mediaSyncCounts(props.items, (item) => mediaPosterAsset(item))}
		>
			{props.items.map((item) => (
				<MediaEntityTile
					item={item}
					key={item.id}
					compact={props.compact}
					aspect={props.aspect(item)}
					lines={props.lines?.(item)}
				/>
			))}
		</MediaRailFrame>
	);
}
