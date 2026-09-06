import { PluginLink } from "@ryot-app/client-sdk/plugin";
import { fieldSyncState } from "@ryot-app/client-ui-sdk/sync";
import clsx from "clsx";
import type { ReactNode } from "react";

import {
	mediaArtworkClass,
	mediaRailWidthClass,
	type MediaArtworkAspect,
	type MediaPresentationSubject,
} from "./entity-presentation";
import type { MediaImageAsset } from "./image";
import { ManagedAssetImage } from "./managed-assets";
import { MediaLinkButton, MediaOverviewSection, MediaRail } from "./primitives";
import { mediaPosterAsset } from "./summary-state";
import { mediaSyncCounts, type MediaSyncCounts } from "./sync-counts";

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
				"flex flex-col gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-accent",
				mediaRailWidthClass({ aspect: props.aspect, compact: props.compact }),
			)}
		>
			<div className="relative">
				<ManagedAssetImage
					asset={art}
					monogram={item.name}
					state={fieldSyncState(art, item)}
					className={mediaArtworkClass({
						layout: "rail",
						aspect: props.aspect,
						compact: props.compact,
					})}
				/>
				{props.overlay === undefined ? null : (
					<div className="pointer-events-none absolute inset-0">{props.overlay}</div>
				)}
			</div>
			<p className="line-clamp-2 font-ui text-[12px] leading-4.25 text-text">{item.name}</p>
			{(props.lines ?? []).map((line) =>
				line === undefined ? null : (
					<p key={line} className="line-clamp-1 font-ui text-[11px] leading-3.75 text-text-subtle">
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
	readonly divided?: boolean;
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
		<MediaOverviewSection
			sync={props.sync}
			title={props.title}
			action={props.action}
			compact={props.compact}
			divided={props.divided ?? false}
		>
			{status.kind === "ready" ? props.children : null}
			{status.kind === "pending" ? (
				<div role="status" aria-label={`Loading ${props.title}`}>
					{props.placeholder}
				</div>
			) : null}
			{status.kind === "error" ? (
				<div role="alert" className="flex flex-col items-start gap-2">
					<p className="font-ui text-[13px] text-text-muted">Unable to load this section.</p>
					<MediaLinkButton label="Try again" onClick={status.retry} />
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
				<MediaRail compact={props.compact}>
					{Array.from({ length: PENDING_TILE_COUNT }, (_, index) => (
						<div
							key={index}
							className={clsx(
								"animate-pulse rounded-lg bg-surface-2",
								mediaArtworkClass({ layout: "rail", aspect: "poster", compact: props.compact }),
							)}
						/>
					))}
				</MediaRail>
			}
		>
			<MediaRail compact={props.compact}>{props.children}</MediaRail>
		</MediaSectionFrame>
	);
}

export function MediaEntityRailSection<Item extends MediaPresentationSubject>(props: {
	readonly title: string;
	readonly compact: boolean;
	readonly divided: boolean;
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
			divided={props.divided}
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
