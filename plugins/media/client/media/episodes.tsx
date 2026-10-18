import { ManagedAssetProvider, type RyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { markdownPlainText } from "@ryot-app/plugin-ui-sdk/markdown";
import { fieldSyncState, isTitleProvisional, SyncPip } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import { useRef, useState } from "react";

import { MediaActivityLogSheet } from "./activity-log/sheet";
import type { ActivityEpisode, MediaActivityLogger } from "./activity-log/state";
import type { MediaCursorPage } from "./cursor-page-state";
import { MediaCursorPages, type MediaCursorPagesCopy } from "./cursor-pages";
import { type MediaArtworkAspect, mediaAspectClass } from "./entity-presentation";
import { MediaEpisodeDetails } from "./episode-details";
import {
	type MediaEpisode,
	mediaEpisodeAsset,
	type MediaEpisodeImagePurpose,
	mediaEpisodeMetadataLabel,
	mediaEpisodesManagedAssets,
	mediaEpisodeStateLabel,
	type MediaEpisodeStateLabels,
	mediaEpisodeSynopsis,
} from "./episodes-state";
import { ManagedAssetImage } from "./managed-assets";

type MediaEpisodeArtworkAspect = Extract<MediaArtworkAspect, "still" | "square">;

export type MediaEpisodeLog = {
	readonly parentEntityId: string;
	readonly logger: MediaActivityLogger;
};

export type MediaEpisodeRender<Episode extends MediaEpisode> = {
	readonly aspect: MediaEpisodeArtworkAspect;
	readonly purpose: MediaEpisodeImagePurpose;
	readonly stateLabels: MediaEpisodeStateLabels;
	readonly numberLabel: (episode: Episode) => string;
	readonly originLabel: (episode: Episode) => string;
	readonly activityEpisode: (episode: Episode) => ActivityEpisode;
};

export type MediaEpisodePagesCopy = MediaCursorPagesCopy;

export type MediaEpisodePageInput<Scope extends object = Record<never, never>> = Scope & {
	readonly after: string | null;
	readonly entityId: string;
	readonly containerId: string;
};

type MediaEpisodePageQuery<Episode, Scope extends object> = RyotQuery<
	MediaEpisodePageInput<Scope>,
	MediaCursorPage<Episode>
>;

const ARTWORK_WIDTH_CLASS: Record<MediaEpisodeArtworkAspect, { compact: string; regular: string }> =
	{ still: { compact: "w-24", regular: "w-36" }, square: { compact: "w-16", regular: "w-20" } };

const artworkClass = (aspect: MediaEpisodeArtworkAspect, compact: boolean) =>
	clsx(mediaAspectClass(aspect), ARTWORK_WIDTH_CLASS[aspect][compact ? "compact" : "regular"]);

function MediaEpisodeRow<Episode extends MediaEpisode>(props: {
	readonly log: MediaEpisodeLog;
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly divided: boolean;
	readonly episode: Episode;
	readonly render: MediaEpisodeRender<Episode>;
}) {
	const { render, episode } = props;
	const [overlay, setOverlay] = useState<"details" | "log">();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const asset = mediaEpisodeAsset(episode, render.purpose);
	const synopsis = mediaEpisodeSynopsis(episode);
	const lifecycle = mediaEpisodeStateLabel(episode.state, render.stateLabels);
	const meta = mediaEpisodeMetadataLabel(episode);
	const watched = episode.state === "complete";
	return (
		<>
			<button
				type="button"
				ref={triggerRef}
				aria-haspopup="dialog"
				aria-label={`Open ${episode.name}`}
				onClick={() => setOverlay("details")}
				className={clsx(
					"group flex w-full items-center text-left focus-visible:outline-2 focus-visible:outline-accent",
					props.compact ? "gap-3 py-2.5" : "gap-4 py-3",
					props.divided && "border-t border-border",
				)}
			>
				<ManagedAssetImage
					asset={asset}
					monogram={episode.name}
					state={fieldSyncState(asset, episode)}
					className={clsx("shrink-0", artworkClass(render.aspect, props.compact))}
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<div className="flex items-baseline gap-2">
						<span className="text-xs font-medium text-text-subtle tabular-nums">
							{render.numberLabel(episode)}
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
					onLog={() => setOverlay("log")}
					safeAreaTop={props.safeAreaTop}
					onClose={() => setOverlay(undefined)}
				/>
			) : null}
			{overlay === "log" ? (
				<MediaActivityLogSheet
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

function MediaNextUpCard<Episode extends MediaEpisode>(props: {
	readonly log: MediaEpisodeLog;
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly episode: Episode;
	readonly render: MediaEpisodeRender<Episode>;
}) {
	return (
		<div
			className={clsx(
				"mb-2 rounded-lg border border-accent-border bg-accent-soft/40 pt-2.5 pb-0.5",
				props.compact ? "px-3" : "px-4",
			)}
		>
			<div className="flex items-center gap-2">
				<p className="text-micro font-semibold tracking-widest text-accent-text uppercase">
					Next up
				</p>
				<p className="text-micro text-text-subtle">{props.render.originLabel(props.episode)}</p>
			</div>
			<MediaEpisodeRow
				divided={false}
				log={props.log}
				render={props.render}
				episode={props.episode}
				compact={props.compact}
				safeAreaTop={props.safeAreaTop}
			/>
		</div>
	);
}

function MediaEpisodeList<Episode extends MediaEpisode>(props: {
	readonly log: MediaEpisodeLog;
	readonly compact: boolean;
	readonly safeAreaTop: number;
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
					safeAreaTop={props.safeAreaTop}
				/>
			))}
		</div>
	);
}

/**
 * Cursor-paged episode list whose first page leads with the parent's next-up episode, which the
 * summary resolves server-side; the caller passes it only to the container that holds it.
 */
export function MediaEpisodePages<
	Episode extends MediaEpisode,
	Scope extends object = Record<never, never>,
>(props: {
	readonly scope?: Scope;
	readonly log: MediaEpisodeLog;
	readonly compact: boolean;
	readonly safeAreaTop: number;
	readonly entityId: string;
	readonly containerId: string;
	readonly copy: MediaEpisodePagesCopy;
	readonly render: MediaEpisodeRender<Episode>;
	readonly query: MediaEpisodePageQuery<Episode, Scope>;
	readonly nextUp: Episode | null;
}) {
	const { render, nextUp } = props;
	return (
		<MediaCursorPages
			copy={props.copy}
			query={props.query}
			key={props.containerId}
			getPageInput={(input, after) => ({ ...input, after })}
			assets={(episodes) => mediaEpisodesManagedAssets(episodes, render.purpose)}
			input={{ ...props.scope, entityId: props.entityId, containerId: props.containerId }}
			renderItems={(episodes) => {
				return (
					<>
						{nextUp === null ? null : (
							<ManagedAssetProvider assets={mediaEpisodesManagedAssets([nextUp], render.purpose)}>
								<MediaNextUpCard
									log={props.log}
									render={render}
									episode={nextUp}
									compact={props.compact}
									safeAreaTop={props.safeAreaTop}
								/>
							</ManagedAssetProvider>
						)}
						<MediaEpisodeList
							log={props.log}
							render={render}
							episodes={episodes}
							compact={props.compact}
							safeAreaTop={props.safeAreaTop}
						/>
					</>
				);
			}}
		/>
	);
}
