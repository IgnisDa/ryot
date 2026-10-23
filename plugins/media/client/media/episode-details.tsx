import { useRyotSchedule, useRyotSubmission } from "@ryot-app/plugin-client-sdk/react";
import { Badge, Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { fieldSyncState, isTitleProvisional, SyncPip } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import { type RefObject, useRef, useState } from "react";

import { logActivityMutation } from "./activity-log/queries";
import { MediaActivityLogSheet } from "./activity-log/sheet";
import { localDay } from "./activity-log/state";
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
import { MediaLinkButton, MediaMarkdown } from "./primitives";

function MediaEpisodeActions<Episode extends MediaEpisode>(props: {
	readonly episode: Episode;
	readonly compact: boolean;
	readonly log: MediaEpisodeLog;
	readonly render: MediaEpisodeRender<Episode>;
}) {
	const { log, episode } = props;
	const schedule = useRyotSchedule();
	const mark = useRyotSubmission(logActivityMutation, {
		isComplete: (result) => result.status === "saved",
	});
	const [sheetOpen, setSheetOpen] = useState(false);
	const sheetTrigger = useRef<HTMLButtonElement>(null);
	if (episode.publishDate !== null && episode.publishDate > localDay(schedule.now())) {
		return null;
	}
	const { participle } = log.logger.copy;
	return (
		<div className="flex flex-col items-start gap-2">
			<div className="flex flex-wrap gap-2">
				<Button
					disabled={mark.status !== "idle"}
					onClick={() =>
						mark.submit({
							kind: "episodes",
							when: { kind: "now" },
							episodeEntityIds: [episode.id],
							parentEntityId: log.parentEntityId,
						})
					}
				>
					{mark.isPending ? "Saving…" : `Mark ${participle}`}
				</Button>
				<Button ref={sheetTrigger} variant="secondary" onClick={() => setSheetOpen(true)}>
					Log…
				</Button>
			</div>
			{mark.status === "retained" ? (
				<div className="flex items-center gap-3">
					<StatusMessage tone="error">Couldn't save. Try again.</StatusMessage>
					<MediaLinkButton label="Retry" onClick={mark.retry} />
				</div>
			) : null}
			{mark.status === "idle" && mark.data?.status === "saved" ? (
				<StatusMessage tone="success">Marked {participle}.</StatusMessage>
			) : null}
			{sheetOpen ? (
				<MediaActivityLogSheet
					logger={log.logger}
					compact={props.compact}
					triggerRef={sheetTrigger}
					entityId={log.parentEntityId}
					onClose={() => setSheetOpen(false)}
					initialEpisode={props.render.activityEpisode(episode)}
				/>
			) : null}
		</div>
	);
}

export function MediaEpisodeDetails<Episode extends MediaEpisode>(props: {
	readonly episode: Episode;
	readonly log: MediaEpisodeLog;
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
					<MediaEpisodeActions
						log={props.log}
						render={render}
						episode={episode}
						compact={compact}
					/>
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
