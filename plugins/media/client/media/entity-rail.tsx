import { PluginLink } from "@ryot-app/client-sdk/plugin";
import { fieldSyncState } from "@ryot-app/client-ui-sdk/sync";
import clsx from "clsx";
import type { ReactNode } from "react";

import {
	mediaArtworkClass,
	type MediaArtworkAspect,
	type MediaPresentationSubject,
} from "./entity-presentation";
import { ManagedAssetImage } from "./managed-assets";
import { MediaOverviewSection, MediaRail } from "./primitives";
import { mediaPosterAsset } from "./summary-state";
import { mediaSyncCounts } from "./sync-counts";

export function MediaEntityTile(props: {
	readonly compact: boolean;
	readonly aspect: MediaArtworkAspect;
	readonly item: MediaPresentationSubject;
	readonly lines?: readonly (string | undefined)[] | undefined;
}) {
	const { item } = props;
	const poster = mediaPosterAsset(item);
	return (
		<PluginLink
			aria-label={`Open ${item.name}`}
			to={{ kind: "entity", entityId: item.id }}
			className={clsx(
				"flex flex-col gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-accent",
				props.compact ? "w-28" : "w-32",
			)}
		>
			<ManagedAssetImage
				asset={poster}
				monogram={item.name}
				state={fieldSyncState(poster, item)}
				className={mediaArtworkClass({
					layout: "grid",
					aspect: props.aspect,
					compact: props.compact,
				})}
			/>
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

export function MediaEntityRailSection<Item extends MediaPresentationSubject>(props: {
	readonly title: string;
	readonly compact: boolean;
	readonly divided: boolean;
	readonly action?: ReactNode;
	readonly items: readonly Item[];
	readonly aspect: MediaArtworkAspect;
	readonly lines?: ((item: Item) => readonly (string | undefined)[]) | undefined;
}) {
	if (props.items.length === 0) {
		return null;
	}
	return (
		<MediaOverviewSection
			title={props.title}
			action={props.action}
			compact={props.compact}
			divided={props.divided}
			sync={mediaSyncCounts(props.items, (item) => mediaPosterAsset(item))}
		>
			<MediaRail compact={props.compact}>
				{props.items.map((item) => (
					<MediaEntityTile
						item={item}
						key={item.id}
						aspect={props.aspect}
						compact={props.compact}
						lines={props.lines?.(item)}
					/>
				))}
			</MediaRail>
		</MediaOverviewSection>
	);
}
