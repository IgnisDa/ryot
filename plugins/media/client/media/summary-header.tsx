import type { EntitySettleReason } from "@ryot-app/client-sdk";
import { Switch } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import {
	fieldSyncState,
	isTitleProvisional,
	SettleHighlight,
	TranslationChip,
} from "@ryot-app/client-ui-sdk/sync";
import clsx from "clsx";
import { useState, type ReactNode } from "react";

import { mediaArtworkClass } from "./entity-presentation";
import { ManagedAssetImage } from "./managed-assets";
import {
	MediaActionButton,
	MediaChip,
	MediaExternalLink,
	MediaFactRow,
	MediaLinkButton,
	MediaProgressBar,
	MediaRailRow,
} from "./primitives";
import {
	mediaCollectionsLabel,
	mediaOwnershipLabel,
	mediaPosterAsset,
	type MediaEntitySummaryValue,
	type MediaStatusRailConfig,
	type MediaSummaryArtwork,
	type MediaSummaryHeaderDetail,
} from "./summary-state";

function MediaIdentityLine(props: {
	readonly typeLabel: string;
	readonly detail: string | undefined;
	readonly media: MediaEntitySummaryValue;
}) {
	const { media, detail } = props;
	return (
		<p className="font-ui text-[13px] text-text">
			{props.typeLabel}
			{media.providerName === null ? null : (
				<>
					{" • "}
					<span className="font-ui font-medium">{media.providerName}</span>
				</>
			)}
			{detail === undefined ? null : ` • ${detail}`}
		</p>
	);
}

function MediaDescription(props: {
	readonly text: string;
	readonly onToggle: () => void;
	readonly isExpanded: boolean;
}) {
	return (
		<div className="flex flex-col gap-1 pt-1">
			<p
				className={clsx(
					"font-ui text-[14px] leading-6 text-text",
					props.isExpanded ? undefined : "line-clamp-3",
				)}
			>
				{props.text}
			</p>
			<div className="flex items-start">
				<MediaLinkButton
					tone="plain"
					onClick={props.onToggle}
					label={props.isExpanded ? "Less" : "More"}
				/>
			</div>
		</div>
	);
}

function MediaIdentity(props: {
	readonly compact: boolean;
	readonly typeLabel: string;
	readonly description: ReactNode;
	readonly media: MediaEntitySummaryValue;
	readonly detail: MediaSummaryHeaderDetail;
	readonly settled: EntitySettleReason | undefined;
}) {
	const { media, detail, compact } = props;
	return (
		<div className={clsx("flex min-w-0 flex-col", compact ? "gap-4" : "flex-1 gap-2.5")}>
			<SettleHighlight
				reason={props.settled}
				className={clsx(
					"flex flex-col gap-2.5 rounded-lg",
					compact ? "min-h-48 justify-end pl-36" : "min-h-0 justify-start pl-0",
				)}
			>
				<h1
					className={clsx(
						"font-display font-semibold text-text",
						compact ? "text-[22px] leading-7" : "text-[34px] leading-10",
					)}
				>
					{media.name}
				</h1>
				<MediaIdentityLine
					media={media}
					typeLabel={props.typeLabel}
					detail={detail.identityDetail}
				/>
				{detail.chips.length === 0 ? null : (
					<div className="flex flex-wrap gap-1.5">
						{detail.chips.map((chip) => (
							<MediaChip key={chip} label={chip} />
						))}
					</div>
				)}
			</SettleHighlight>
			<MediaFactRow compact={compact} facts={detail.facts} />
			{detail.links.length === 0 ? null : (
				<div className="flex flex-wrap gap-x-4 gap-y-2">
					{detail.links.map((link) => (
						<MediaExternalLink key={link.href} href={link.href} label={link.label} />
					))}
				</div>
			)}
			{props.description}
			{isTitleProvisional(media) && (
				<div className="flex items-start">
					<TranslationChip icon={<AppIcon size={13} name="globe" />} />
				</div>
			)}
		</div>
	);
}

function MediaLibraryBadge(props: { readonly isInLibrary: boolean }) {
	if (!props.isInLibrary) {
		return <AppIcon size={20} name="circle-check" className="text-text-subtle" />;
	}
	return (
		<div className="flex h-5 w-5 items-center justify-center rounded-full bg-success">
			<AppIcon size={13} name="check" className="text-bg" />
		</div>
	);
}

function MediaStatusRail(props: {
	readonly compact: boolean;
	readonly media: MediaEntitySummaryValue;
	readonly config: MediaStatusRailConfig;
}) {
	const { media, config, compact } = props;
	const { status, ownership } = config;
	return (
		<div className={clsx("flex flex-col", compact ? "gap-3" : "w-84 gap-2")}>
			<div className="overflow-hidden rounded-lg border border-border bg-surface">
				{status === undefined ? null : (
					<>
						<MediaRailRow
							compact={compact}
							icon="circle-check"
							title="Your status"
							detail="Status is calculated from your activity"
							trailing={
								<span className="font-ui font-medium text-[13px] text-success">{status.label}</span>
							}
						/>
						{status.progress === undefined ? null : (
							<div className="px-4 py-3.5">
								<MediaProgressBar percent={status.progress.percent} />
							</div>
						)}
					</>
				)}
				<MediaRailRow
					icon="radio"
					compact={compact}
					title="Monitoring"
					detail="Keep provider details up to date"
					trailing={
						<Switch
							checked={media.isMonitored}
							label="Toggle media monitoring"
							onChange={() => console.log("TODO: toggle media monitoring")}
						/>
					}
				/>
				<MediaRailRow
					icon="library"
					compact={compact}
					title="In library"
					trailing={<MediaLibraryBadge isInLibrary={media.isInLibrary} />}
				/>
				{ownership === undefined ? null : (
					<MediaRailRow
						icon="tags"
						compact={compact}
						title="Ownership"
						trailing={
							<span className="font-ui text-[13px] text-text-muted">
								{mediaOwnershipLabel(ownership.owned)}
							</span>
						}
					/>
				)}
				<MediaRailRow
					divided={false}
					icon="layers-3"
					compact={compact}
					title="Collections"
					detail={mediaCollectionsLabel(media.collections)}
					trailing={
						<MediaLinkButton
							label="Manage"
							onClick={() => console.log("TODO: manage collections")}
						/>
					}
				/>
			</div>
			<div className={clsx("flex gap-2", !compact && "flex-col")}>
				{config.logActivity ? (
					<MediaActionButton
						variant="primary"
						compact={compact}
						label="Log activity"
						onClick={() => console.log("TODO: open activity form")}
					/>
				) : null}
				<MediaActionButton
					compact={compact}
					variant="secondary"
					label="Write review"
					onClick={() => console.log("TODO: open review form")}
				/>
			</div>
		</div>
	);
}

export function MediaSummaryHeader(props: {
	readonly compact: boolean;
	readonly typeLabel: string;
	readonly media: MediaEntitySummaryValue;
	readonly artwork: MediaSummaryArtwork;
	readonly detail: MediaSummaryHeaderDetail;
	readonly settled: EntitySettleReason | undefined;
}) {
	const { media, compact, artwork } = props;
	const poster = mediaPosterAsset(media, artwork.purpose);
	const { description } = media;
	const [isExpanded, setIsExpanded] = useState(false);
	const descriptionNode =
		description === null ? null : (
			<MediaDescription
				text={description}
				isExpanded={isExpanded}
				onToggle={() => setIsExpanded(!isExpanded)}
			/>
		);
	return (
		<div className={clsx("flex gap-4", compact ? "flex-col" : "flex-row items-start gap-8")}>
			<div
				className={clsx("relative flex min-w-0", compact ? "flex-col" : "flex-1 flex-row gap-8")}
			>
				<div className={compact ? "absolute top-0 left-0 w-32" : "relative w-60 shrink-0"}>
					<ManagedAssetImage
						asset={poster}
						fit={artwork.fit}
						monogram={media.name}
						state={fieldSyncState(poster, media)}
						className={mediaArtworkClass({ compact, layout: "grid", aspect: artwork.aspect })}
					/>
				</div>
				<MediaIdentity
					media={media}
					compact={compact}
					detail={props.detail}
					settled={props.settled}
					typeLabel={props.typeLabel}
					description={descriptionNode}
				/>
			</div>
			<MediaStatusRail media={media} compact={compact} config={props.detail.rail} />
		</div>
	);
}
