import type { LocalMessage } from "@ryot-app/plugin-client-sdk";
import { UTC } from "@ryot-app/plugin-client-sdk/plugin";
import {
	AssetArtWell,
	ManagedAssetProvider,
	type RyotQuery,
	useUserPreferences,
} from "@ryot-app/plugin-client-sdk/react";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { markdownPlainText } from "@ryot-app/plugin-ui-sdk/markdown";
import { fieldSyncState, isTitleProvisional, SyncPip } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import { useRef, useState } from "react";

import { catalogMessage } from "../../shared/messages.generated";
import { useMediaCopy } from "../messages";
import { useActivityLogSubmission } from "./activity-log/queries";
import { MediaActivityLogSheet } from "./activity-log/sheet";
import type { ActivityEpisode, MediaActivityLogger } from "./activity-log/state";
import type { MediaCursorPage } from "./cursor-page-state";
import { MediaCursorPages, type MediaCursorPagesCopy } from "./cursor-pages";
import { type MediaArtworkAspect, mediaAspectClass } from "./entity-presentation";
import type { MediaEpisodeCredits } from "./episode-credits";
import { MediaEpisodeDetails } from "./episode-details";
import {
	type MediaEpisode,
	mediaEpisodeMetadataLabel,
	mediaEpisodesManagedAssets,
	mediaEpisodeStateLabel,
	type MediaEpisodeStateLabels,
	mediaEpisodeSynopsis,
} from "./episodes-state";
import { MediaReviewForm } from "./review";

export type MediaEpisodePagesCopy = MediaCursorPagesCopy;

export type MediaEpisodeLog = {
	readonly parentEntityId: string;
	readonly logger: MediaActivityLogger;
};

export type MediaEpisodePageInput<Scope extends object = object> = Scope & {
	readonly entityId: string;
	readonly containerId: string;
	readonly after: null | string;
};

export type MediaEpisodeRender<Episode extends MediaEpisode> = {
	readonly entitySchemaSlug: string;
	readonly credits?: MediaEpisodeCredits;
	readonly aspect: MediaEpisodeArtworkAspect;
	readonly stateLabels: MediaEpisodeStateLabels;
	readonly numberLabel: (episode: Episode) => LocalMessage;
	readonly originLabel: (episode: Episode) => LocalMessage;
	readonly activityEpisode: (episode: Episode) => ActivityEpisode;
};

type MediaEpisodeArtworkAspect = Extract<MediaArtworkAspect, "still" | "square">;

type MediaEpisodePageQuery<Episode, Scope extends object> = RyotQuery<
	MediaEpisodePageInput<Scope>,
	MediaCursorPage<Episode>
>;

const ARTWORK_WIDTH_CLASS: Record<MediaEpisodeArtworkAspect, { compact: string; regular: string }> =
	{ still: { compact: "w-24", regular: "w-36" }, square: { compact: "w-16", regular: "w-20" } };

const artworkClass = (aspect: MediaEpisodeArtworkAspect, compact: boolean) =>
	clsx(mediaAspectClass(aspect), ARTWORK_WIDTH_CLASS[aspect][compact ? "compact" : "regular"]);

/**
 * Cursor-paged episode list whose first page leads with the parent's next-up episode, which the
 * summary resolves server-side; the caller passes it only to the container that holds it.
 */
export function MediaEpisodePages<
	Episode extends MediaEpisode,
	Scope extends object = object,
>(props: {
	readonly scope?: Scope;
	readonly compact: boolean;
	readonly entityId: string;
	readonly editable: boolean;
	readonly safeAreaTop: number;
	readonly containerId: string;
	readonly log: MediaEpisodeLog;
	readonly nextUp: null | Episode;
	readonly copy: MediaEpisodePagesCopy;
	readonly render: MediaEpisodeRender<Episode>;
	readonly query: MediaEpisodePageQuery<Episode, Scope>;
}) {
	const { render, nextUp } = props;
	return (
		<MediaCursorPages
			copy={props.copy}
			query={props.query}
			key={props.containerId}
			getPageInput={(input, after) => ({ ...input, after })}
			assets={(episodes) => mediaEpisodesManagedAssets(episodes)}
			input={{ ...props.scope, entityId: props.entityId, containerId: props.containerId }}
			renderItems={(episodes) => {
				return (
					<>
						{nextUp === null ? null : (
							<ManagedAssetProvider assets={mediaEpisodesManagedAssets([nextUp])}>
								<MediaNextUpCard
									log={props.log}
									render={render}
									episode={nextUp}
									compact={props.compact}
									editable={props.editable}
									safeAreaTop={props.safeAreaTop}
								/>
							</ManagedAssetProvider>
						)}
						<MediaEpisodeList
							log={props.log}
							render={render}
							episodes={episodes}
							compact={props.compact}
							editable={props.editable}
							safeAreaTop={props.safeAreaTop}
						/>
					</>
				);
			}}
		/>
	);
}

function MediaEpisodeList<Episode extends MediaEpisode>(props: {
	readonly compact: boolean;
	readonly editable: boolean;
	readonly safeAreaTop: number;
	readonly log: MediaEpisodeLog;
	readonly episodes: readonly Episode[];
	readonly render: MediaEpisodeRender<Episode>;
}) {
	return (
		<div>
			{props.episodes.map((episode, index) => (
				<MediaEpisodeRow
					log={props.log}
					key={episode.id}
					episode={episode}
					divided={index > 0}
					render={props.render}
					compact={props.compact}
					editable={props.editable}
					safeAreaTop={props.safeAreaTop}
				/>
			))}
		</div>
	);
}

function MediaNextUpCard<Episode extends MediaEpisode>(props: {
	readonly compact: boolean;
	readonly episode: Episode;
	readonly editable: boolean;
	readonly safeAreaTop: number;
	readonly log: MediaEpisodeLog;
	readonly render: MediaEpisodeRender<Episode>;
}) {
	const { text, local } = useMediaCopy();
	return (
		<div
			className={clsx(
				"mb-2 rounded-lg border border-accent-border bg-accent-soft/40 pt-2.5 pb-0.5",
				props.compact ? "px-3" : "px-4",
			)}
		>
			<div className="flex items-center gap-2">
				<p className="text-micro font-semibold tracking-widest text-accent-text uppercase">
					{text("episodes.next-up")}
				</p>
				<p className="text-micro text-text-subtle">
					{local(props.render.originLabel(props.episode))}
				</p>
			</div>
			<MediaEpisodeRow
				divided={false}
				log={props.log}
				render={props.render}
				episode={props.episode}
				compact={props.compact}
				editable={props.editable}
				safeAreaTop={props.safeAreaTop}
			/>
		</div>
	);
}

function MediaEpisodeRow<Episode extends MediaEpisode>(props: {
	readonly compact: boolean;
	readonly divided: boolean;
	readonly episode: Episode;
	readonly editable: boolean;
	readonly safeAreaTop: number;
	readonly log: MediaEpisodeLog;
	readonly render: MediaEpisodeRender<Episode>;
}) {
	const { render, episode } = props;
	const copy = useMediaCopy();
	const { text } = copy;
	const [overlay, setOverlay] = useState<"log" | "review" | "details">();
	const logSubmission = useActivityLogSubmission();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const asset = episode.image ?? undefined;
	const synopsis = mediaEpisodeSynopsis(episode);
	const lifecycleMessage = mediaEpisodeStateLabel(episode.state, render.stateLabels);
	const lifecycle = lifecycleMessage === undefined ? undefined : copy.local(lifecycleMessage);
	const timeZone = useUserPreferences().data?.timeZone ?? UTC;
	const meta = mediaEpisodeMetadataLabel(copy, episode, timeZone);
	const watched = episode.state === "complete";
	return (
		<>
			<button
				type="button"
				ref={triggerRef}
				aria-haspopup="dialog"
				onClick={() => setOverlay("details")}
				aria-label={text("common.open-named", { name: episode.name })}
				className={clsx(
					"group flex w-full items-center text-left focus-visible:outline-2 focus-visible:outline-accent",
					props.compact ? "gap-3 py-2.5" : "gap-4 py-3",
					props.divided && "border-t border-border",
				)}
			>
				<AssetArtWell
					asset={asset}
					monogram={episode.name}
					state={fieldSyncState(asset, episode)}
					className={clsx("shrink-0", artworkClass(render.aspect, props.compact))}
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<div className="flex items-baseline gap-2">
						<span className="text-xs font-medium text-text-subtle tabular-nums">
							{copy.local(render.numberLabel(episode))}
						</span>
						<span className="line-clamp-1 min-w-0 flex-1 text-sm font-medium text-text group-hover:text-accent-text">
							{episode.name}
							{isTitleProvisional(episode) && <SyncPip className="ml-1.5" reason="translating" />}
						</span>
					</div>
					{meta === "" ? null : (
						<span className="text-xs text-text-subtle tabular-nums">{meta}</span>
					)}
					{synopsis === undefined || props.compact ? null : (
						<span className="line-clamp-1 text-label text-text-muted">
							{markdownPlainText(synopsis)}
						</span>
					)}
				</div>
				{lifecycle === undefined ? null : (
					<span
						className={clsx(
							"flex shrink-0 items-center gap-1 text-xs font-medium",
							watched ? "text-success" : "text-accent-text",
						)}
					>
						<AppIcon size={16} name={watched ? "circle-check" : "play"} />
						<span className={clsx(watched && "sr-only")}>{lifecycle}</span>
					</span>
				)}
			</button>
			{overlay === "details" ? (
				<MediaEpisodeDetails
					log={props.log}
					render={render}
					episode={episode}
					compact={props.compact}
					triggerRef={triggerRef}
					editable={props.editable}
					onLog={() => setOverlay("log")}
					safeAreaTop={props.safeAreaTop}
					onReview={() => setOverlay("review")}
					onClose={() => setOverlay(undefined)}
				/>
			) : null}
			{overlay === "review" ? (
				<MediaReviewForm
					entityId={episode.id}
					triggerRef={triggerRef}
					onClose={() => setOverlay(undefined)}
					fixed={{
						entityId: episode.id,
						label: catalogMessage("activity.episode-name", {
							name: episode.name,
							origin: render.originLabel(episode),
						}),
					}}
				/>
			) : null}
			{overlay === "log" ? (
				<MediaActivityLogSheet
					log={logSubmission}
					triggerRef={triggerRef}
					compact={props.compact}
					logger={props.log.logger}
					entityId={props.log.parentEntityId}
					onClose={() => setOverlay(undefined)}
					initialEpisode={render.activityEpisode(episode)}
				/>
			) : null}
		</>
	);
}
