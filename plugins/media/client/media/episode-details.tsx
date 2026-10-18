import { localDay, useRyotSchedule } from "@ryot-app/plugin-client-sdk/react";
import { Badge, Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { fieldSyncState, isTitleProvisional, SyncPip } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import type { RefObject } from "react";

import { MediaEntityEditAction } from "../entity-editor/edit-action";
import { useQuickLog } from "./activity-log/quick-log";
import { MediaDetailModal } from "./detail-modal";
import { mediaAspectClass } from "./entity-presentation";
import type { MediaEpisodeLog, MediaEpisodeRender } from "./episodes";
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
	readonly compact: boolean;
	readonly editable: boolean;
	readonly onLog: () => void;
	readonly safeAreaTop: number;
	readonly onClose: () => void;
	readonly log: MediaEpisodeLog;
	readonly render: MediaEpisodeRender<Episode>;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
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
			<div
				className={clsx(
					"mx-auto grid max-w-4xl gap-6",
					!compact && "grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start py-2",
				)}
			>
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
				<div className="grid content-start gap-3">
					<h3 className="font-display text-title font-semibold tracking-tight text-balance text-text">
						{episode.name}
						{isTitleProvisional(episode) && <SyncPip className="ml-2" reason="translating" />}
					</h3>
					{metadata === "" ? null : (
						<p className="text-sm text-text-muted tabular-nums">{metadata}</p>
					)}
					{state === undefined ? null : (
						<div className="flex">
							<Badge dot variant={episode.state === "complete" ? "success" : "neutral"}>
								{state}
							</Badge>
						</div>
					)}
					<MediaEpisodeActions log={props.log} episode={episode} onLog={props.onLog} />
					{props.editable ? (
						<div className="flex">
							<MediaEntityEditAction
								isCustom
								label="Edit episode"
								entityId={episode.id}
								entitySchemaSlug={render.entitySchemaSlug}
							/>
						</div>
					) : null}
					{synopsis === undefined ? null : (
						<div className="border-t border-border pt-4 text-body text-text-muted">
							<MediaMarkdown text={synopsis} />
						</div>
					)}
				</div>
			</div>
		</MediaDetailModal>
	);
}

function MediaEpisodeActions(props: {
	readonly onLog: () => void;
	readonly log: MediaEpisodeLog;
	readonly episode: MediaEpisode;
}) {
	const { log, episode } = props;
	const schedule = useRyotSchedule();
	const { locked, log: mark } = useQuickLog(log.parentEntityId);
	if (episode.publishDate !== null && episode.publishDate > localDay(schedule.now())) {
		return null;
	}
	const { participle } = log.logger.copy;
	return (
		<div className="flex flex-col items-start gap-2">
			<div className="flex flex-wrap gap-2">
				<Button
					disabled={locked}
					onClick={() =>
						mark.submit({
							label: `Marked ${episode.name} ${participle}.`,
							entry: {
								kind: "episodes",
								when: { kind: "now" },
								episodeEntityIds: [episode.id],
								parentEntityId: log.parentEntityId,
							},
						})
					}
				>
					{mark.isSending ? "Saving…" : `Mark ${participle}`}
				</Button>
				<Button variant="secondary" onClick={props.onLog}>
					Log with details…
				</Button>
			</div>
			{mark.error === null ? null : (
				<StatusMessage tone="error">Couldn't start saving. Try again.</StatusMessage>
			)}
		</div>
	);
}
