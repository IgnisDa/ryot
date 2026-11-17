import type { LocalMessage } from "@ryot-app/plugin-client-sdk";
import { PluginLink } from "@ryot-app/plugin-client-sdk/plugin";
import { type Text, useDisplayText } from "@ryot-app/plugin-client-sdk/react";
import { Button, Shelf } from "@ryot-app/plugin-ui-sdk";
import { fieldSyncState } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import type { ReactNode } from "react";

import { useMediaCopy, useMediaMessages } from "../messages";
import {
	type MediaArtworkAspect,
	mediaArtworkClass,
	type MediaPresentationSubject,
	mediaRailWidthClass,
} from "./entity-presentation";
import type { MediaImageAsset } from "./image";
import { MediaLibraryTitle } from "./library-title";
import { ManagedAssetImage } from "./managed-assets";
import { MediaOverviewSection, mediaShelfIcons } from "./primitives";
import { mediaPosterAsset } from "./summary-state";
import { type MediaSyncCounts, mediaSyncCounts } from "./sync-counts";

export type MediaRailStatus =
	| { readonly kind: "ready" }
	| { readonly kind: "pending" }
	| { readonly kind: "error"; readonly retry: () => void };

const PENDING_TILE_COUNT = 4;

type MediaSectionFrameProps = {
	readonly title: Text;
	readonly compact: boolean;
	readonly action?: ReactNode;
	readonly children?: ReactNode;
	readonly status: MediaRailStatus;
	readonly sync?: undefined | MediaSyncCounts;
};

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

export function MediaSectionFrame(
	props: MediaSectionFrameProps & { readonly placeholder: ReactNode },
) {
	const { status } = props;
	const text = useMediaMessages();
	return (
		<MediaOverviewSection sync={props.sync} title={props.title} action={props.action}>
			{status.kind === "ready" ? props.children : null}
			{status.kind === "pending" ? (
				<div role="status" aria-label={text("section.loading", { title: props.title })}>
					{props.placeholder}
				</div>
			) : null}
			{status.kind === "error" ? (
				<div role="alert" className="flex flex-col items-start gap-2">
					<p className="font-ui text-[13px] text-text-muted">{text("section.load-failed")}</p>
					<Button variant="link" onClick={status.retry}>
						{text("common.action.try-again")}
					</Button>
				</div>
			) : null}
		</MediaOverviewSection>
	);
}

export function MediaEntityRailSection<
	Item extends MediaPresentationSubject & { readonly isInMediaLibrary: boolean },
>(props: {
	readonly compact: boolean;
	readonly action?: ReactNode;
	readonly items: readonly Item[];
	readonly title: string | LocalMessage;
	readonly aspect: (item: Item) => MediaArtworkAspect;
	readonly lines?: undefined | ((item: Item) => readonly (string | undefined)[]);
}) {
	const { local } = useMediaCopy();
	const displayText = useDisplayText();
	if (props.items.length === 0) {
		return null;
	}
	return (
		<MediaRailFrame
			action={props.action}
			compact={props.compact}
			status={{ kind: "ready" }}
			sync={mediaSyncCounts(props.items, (item) => mediaPosterAsset(item))}
			title={typeof props.title === "string" ? displayText(props.title) : local(props.title)}
		>
			{props.items.map((item) => (
				<MediaEntityTile
					item={item}
					key={item.id}
					compact={props.compact}
					aspect={props.aspect(item)}
					lines={props.lines?.(item)}
					isInMediaLibrary={item.isInMediaLibrary}
				/>
			))}
		</MediaRailFrame>
	);
}

export function MediaEntityTile(props: {
	readonly compact: boolean;
	readonly overlay?: ReactNode;
	readonly aspect: MediaArtworkAspect;
	readonly item: MediaPresentationSubject;
	readonly art?: undefined | MediaImageAsset;
	readonly isInMediaLibrary?: boolean | undefined;
	readonly lines?: undefined | readonly (string | undefined)[];
}) {
	const { item } = props;
	const text = useMediaMessages();
	const art = props.art ?? mediaPosterAsset(item);
	return (
		<PluginLink
			to={{ kind: "entity", entityId: item.id }}
			aria-label={text("common.open-named", { name: item.name })}
			aria-description={props.isInMediaLibrary ? text("library.in-library") : undefined}
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
			<MediaLibraryTitle
				name={item.name}
				isInMediaLibrary={props.isInMediaLibrary ?? false}
				className="line-clamp-2 text-[13px] leading-[18px] font-medium"
			/>
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
