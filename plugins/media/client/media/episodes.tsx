import { ManagedAssetProvider, type RyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { fieldSyncState, isTitleProvisional, SyncPip } from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import { useRef, useState } from "react";

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
	{ still: { compact: "w-28", regular: "w-44" }, square: { compact: "w-20", regular: "w-24" } };

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
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const asset = mediaEpisodeAsset(episode, render.purpose);
	const synopsis = mediaEpisodeSynopsis(episode);
	const lifecycle = mediaEpisodeStateLabel(episode.state, render.stateLabels);
	const meta = mediaEpisodeMetadataLabel(episode);
	return (
		<>
			<button
				type="button"
				ref={triggerRef}
				aria-haspopup="dialog"
				onClick={() => setOpen(true)}
				aria-label={`Open ${episode.name}`}
				className={clsx(
					"flex w-full items-start text-left focus-visible:outline-2 focus-visible:outline-accent",
					props.compact ? "gap-3 py-3" : "gap-4 py-4",
					props.divided && "border-t border-border",
				)}
			>
				<ManagedAssetImage
					asset={asset}
					monogram={episode.name}
					state={fieldSyncState(asset, episode)}
					className={clsx("shrink-0", artworkClass(render.aspect, props.compact))}
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<div className="flex items-baseline gap-2">
						<span className="font-ui font-medium text-[12px] text-text-subtle">
							{render.numberLabel(episode)}
						</span>
						<span className="line-clamp-1 min-w-0 flex-1 font-ui font-medium text-[14px] text-text">
							{episode.name}
							{isTitleProvisional(episode) && <SyncPip className="ml-1.5" reason="translating" />}
						</span>
						{lifecycle === undefined ? null : (
							<span
								className={clsx(
									"font-ui text-[12px]",
									episode.state === "complete" ? "text-success" : "text-accent-text",
								)}
							>
								{lifecycle}
							</span>
						)}
					</div>
					{meta === "" ? null : (
						<span className="font-ui text-[12px] text-text-subtle">{meta}</span>
					)}
					{synopsis === undefined ? null : (
						<span className="line-clamp-2 font-ui text-[13px] leading-5 text-text-muted">
							{synopsis}
						</span>
					)}
				</div>
			</button>
			{open ? (
				<MediaEpisodeDetails
					log={props.log}
					render={render}
					episode={episode}
					compact={props.compact}
					triggerRef={triggerRef}
					onClose={() => setOpen(false)}
					safeAreaTop={props.safeAreaTop}
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
				"rounded-lg border border-border bg-surface pt-2.5 pb-1",
				props.compact ? "px-3.5" : "px-4",
			)}
		>
			<div className="flex items-center gap-2">
				<p className="font-ui font-medium text-[11px] tracking-widest text-text-subtle uppercase">
					Next up
				</p>
				<p className="font-ui text-[11px] text-text-subtle">
					{props.render.originLabel(props.episode)}
				</p>
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
	readonly leadingDivider: boolean;
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
					render={props.render}
					compact={props.compact}
					safeAreaTop={props.safeAreaTop}
					divided={props.leadingDivider || index > 0}
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
			renderPage={(episodes, index) => {
				return (
					<>
						{index !== 0 || nextUp === null ? null : (
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
							leadingDivider={index > 0}
							safeAreaTop={props.safeAreaTop}
						/>
					</>
				);
			}}
		/>
	);
}
