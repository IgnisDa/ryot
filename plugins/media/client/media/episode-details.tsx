import { Badge } from "@ryot-app/plugin-ui-sdk";
import { fieldSyncState, isTitleProvisional, SyncPip } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import type { RefObject } from "react";

import { MediaDetailModal } from "./detail-modal";
import { mediaAspectClass } from "./entity-presentation";
import type { MediaEpisodeRender } from "./episodes";
import {
	type MediaEpisode,
	mediaEpisodeAsset,
	mediaEpisodeMetadataLabel,
	mediaEpisodeStateLabel,
	mediaEpisodeSynopsis,
} from "./episodes-state";
import { ManagedAssetImage } from "./managed-assets";
import { MediaMarkdown } from "./primitives";

export function MediaEpisodeDetails<Episode extends MediaEpisode>(props: {
	readonly episode: Episode;
	readonly render: MediaEpisodeRender<Episode>;
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly onClose: () => void;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const { render, episode, compact } = props;
	const asset = mediaEpisodeAsset(episode, render.purpose);
	const synopsis = mediaEpisodeSynopsis(episode);
	const state = mediaEpisodeStateLabel(episode.state, render.stateLabels);
	const metadata = mediaEpisodeMetadataLabel(episode);
	return (
		<MediaDetailModal
			compact={compact}
			label={episode.name}
			onClose={props.onClose}
			triggerRef={props.triggerRef}
			safeAreaTop={props.safeAreaTop}
			closeLabel="Close episode details"
			title={render.originLabel(episode)}
		>
			<div className={clsx("mx-auto grid max-w-3xl gap-6", !compact && "py-4")}>
				<ManagedAssetImage
					asset={asset}
					fit="contain"
					monogram={episode.name}
					state={fieldSyncState(asset, episode)}
					className={clsx(
						"w-full overflow-hidden rounded-lg bg-bg shadow-card",
						mediaAspectClass(render.aspect),
						render.aspect === "square" && "mx-auto max-w-80",
					)}
				/>
				<div className="grid gap-3">
					<h3
						className={clsx(
							"font-display font-semibold tracking-tight text-balance text-text",
							compact ? "text-[22px] leading-7" : "text-display",
						)}
					>
						{episode.name}
						{isTitleProvisional(episode) && <SyncPip className="ml-2" reason="translating" />}
					</h3>
					{metadata === "" ? null : (
						<p className="font-ui text-sm text-text-muted tabular-nums">{metadata}</p>
					)}
					{state === undefined ? null : (
						<div className="flex">
							<Badge dot variant={episode.state === "complete" ? "success" : "neutral"}>
								{state}
							</Badge>
						</div>
					)}
				</div>
				{synopsis === undefined ? null : (
					<div className="border-t border-border pt-5 text-[15px] leading-7 text-text-muted">
						<MediaMarkdown text={synopsis} />
					</div>
				)}
			</div>
		</MediaDetailModal>
	);
}
