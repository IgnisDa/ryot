import type { EntitySettleReason } from "@ryot-app/plugin-client-sdk";
import { useAssetUrl } from "@ryot-app/plugin-client-sdk/react";
import { Badge, Button, ProgressBar, Skeleton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { markdownPlainText } from "@ryot-app/plugin-ui-sdk/markdown";
import {
	fieldSyncState,
	isTitleProvisional,
	SettleHighlight,
	TranslationChip,
} from "@ryot-app/plugin-ui-sdk/sync";
import { ImageTintOverlay, useImageTint } from "@ryot-app/plugin-ui-sdk/tint";
import clsx from "clsx";
import { Fragment, useState } from "react";

import { MediaEntityEditAction } from "../entity-editor/edit-action";
import { MediaLogActivityButton } from "./activity-log/button";
import type { MediaActivityLogger } from "./activity-log/state";
import { MediaCollectionsControl } from "./collections";
import { mediaArtworkClass } from "./entity-presentation";
import { ManagedAssetImage } from "./managed-assets";
import { MediaMonitoringControl } from "./monitoring";
import { MediaOwnershipControl } from "./ownership";
import { MediaExternalLink, MediaFactRow, MediaMarkdown } from "./primitives";
import { MediaProviderRefreshControl } from "./provider-refresh";
import { MediaReviewButton } from "./review";
import {
	type MediaEntitySummaryValue,
	mediaPosterAsset,
	type MediaStatusRailConfig,
	type MediaSummaryArtwork,
	type MediaSummaryFact,
	type MediaSummaryHeaderDetail,
} from "./summary-state";

function MediaIdentityLine(props: {
	readonly detail: string | undefined;
	readonly facts: readonly MediaSummaryFact[];
	readonly media: MediaEntitySummaryValue;
}) {
	const { providerName } = props.media;
	const parts = [
		...(props.detail === undefined ? [] : [{ key: "detail", text: props.detail }]),
		...props.facts.map((fact) => ({ key: fact.label, text: `${fact.value}${fact.suffix ?? ""}` })),
		...(providerName === null ? [] : [{ key: "provider", text: providerName }]),
	];
	if (parts.length === 0) {
		return null;
	}
	return (
		<p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-text-muted">
			{parts.map((part, index) => (
				<Fragment key={part.key}>
					{index === 0 ? null : <span aria-hidden="true">·</span>}
					<span className="tabular-nums">{part.text}</span>
				</Fragment>
			))}
		</p>
	);
}

function MediaDescription(props: { readonly text: string }) {
	const [isExpanded, setIsExpanded] = useState(false);
	return (
		<div className="flex max-w-[62ch] flex-col gap-1">
			{isExpanded ? (
				<div className="text-body text-text-muted">
					<MediaMarkdown text={props.text} />
				</div>
			) : (
				<p className="line-clamp-3 text-body text-text-muted">{markdownPlainText(props.text)}</p>
			)}
			<div className="flex items-start">
				<Button variant="linkPlain" onClick={() => setIsExpanded(!isExpanded)}>
					{isExpanded ? "Less" : "More"}
				</Button>
			</div>
		</div>
	);
}

function MediaActions(props: {
	readonly compact: boolean;
	readonly media: MediaEntitySummaryValue;
	readonly logActivity: MediaActivityLogger | undefined;
}) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			{props.logActivity === undefined ? null : (
				<MediaLogActivityButton
					compact={props.compact}
					entityId={props.media.id}
					logger={props.logActivity}
				/>
			)}
			<MediaReviewButton entityId={props.media.id} />
			<MediaEntityEditAction
				entityId={props.media.id}
				isCustom={props.media.isCustom}
				entitySchemaSlug={props.media.schemaSlug}
			/>
		</div>
	);
}

function MediaIdentity(props: {
	readonly compact: boolean;
	readonly media: MediaEntitySummaryValue;
	readonly detail: MediaSummaryHeaderDetail;
	readonly settled: EntitySettleReason | undefined;
}) {
	const { media, detail, compact } = props;
	const inlineFacts = detail.facts.filter((fact) => fact.inline === true);
	const labelledFacts = detail.facts.filter((fact) => fact.inline !== true);
	return (
		<SettleHighlight reason={props.settled} className="grid min-w-0 content-start gap-3 rounded-lg">
			<h1
				className={clsx(
					"font-display font-semibold tracking-tight text-balance text-text",
					compact ? "text-title" : "text-display",
				)}
			>
				{media.name}
			</h1>
			<MediaIdentityLine media={media} facts={inlineFacts} detail={detail.identityDetail} />
			{detail.chips.length === 0 ? null : (
				<div className="flex flex-wrap gap-1.5">
					{detail.chips.map((chip) => (
						<Badge key={chip} variant="neutral">
							{chip}
						</Badge>
					))}
				</div>
			)}
			{compact || labelledFacts.length === 0 ? null : (
				<MediaFactRow compact={false} facts={labelledFacts} />
			)}
			{detail.links.length === 0 ? null : (
				<div className="flex flex-wrap gap-x-4 gap-y-2">
					{detail.links.map((link) => (
						<MediaExternalLink key={link.href} href={link.href} label={link.label} />
					))}
				</div>
			)}
		</SettleHighlight>
	);
}

function MediaLibraryStrip(props: {
	readonly media: MediaEntitySummaryValue;
	readonly config: MediaStatusRailConfig;
}) {
	const { media, config } = props;
	const { status, ownership } = config;
	return (
		<div role="group" aria-label="Your library" className="flex flex-wrap items-center gap-2">
			{status === undefined ? null : (
				<span className="inline-flex items-center gap-2">
					<Badge dot variant={status.tone}>
						<span className="sr-only">Status: </span>
						{status.label}
					</Badge>
					{status.progress === undefined ? null : (
						<>
							<ProgressBar
								max={100}
								tone="success"
								className="w-16"
								label="Progress"
								value={status.progress.percent}
							/>
							<span className="text-xs text-text-muted tabular-nums">
								{Math.round(status.progress.percent)}%
							</span>
						</>
					)}
				</span>
			)}
			<span className="inline-flex items-center gap-1.5 px-1 text-xs text-text-muted">
				<AppIcon
					size={14}
					name={media.isInMediaLibrary ? "circle-check" : "library"}
					className={media.isInMediaLibrary ? "text-success" : "text-text-subtle"}
				/>
				{media.isInMediaLibrary ? "In your library" : "Not in your library"}
			</span>
			{ownership === undefined ? null : (
				<MediaOwnershipControl
					entityId={media.id}
					owned={ownership.owned}
					ownedOn={ownership.ownedOn}
					key={`ownership:${media.id}`}
				/>
			)}
			<MediaCollectionsControl
				entityId={media.id}
				key={`collections:${media.id}`}
				collections={media.collections}
			/>
			{media.providerName === null ? null : (
				<MediaMonitoringControl
					entityId={media.id}
					monitored={media.isMonitored}
					key={`monitoring:${media.id}`}
				/>
			)}
			<MediaProviderRefreshControl media={media} />
		</div>
	);
}

export function MediaSummaryHeader(props: {
	readonly compact: boolean;
	readonly media: MediaEntitySummaryValue;
	readonly artwork: MediaSummaryArtwork;
	readonly detail: MediaSummaryHeaderDetail;
	readonly settled: EntitySettleReason | undefined;
}) {
	const { media, detail, compact, artwork } = props;
	const poster = mediaPosterAsset(media, artwork.purpose);
	const { gradientStops } = useImageTint(useAssetUrl(poster));
	const art = (
		<ManagedAssetImage
			asset={poster}
			fit={artwork.fit}
			monogram={media.name}
			state={fieldSyncState(poster, media)}
			className={clsx(
				"shadow-card",
				mediaArtworkClass({ compact, layout: "grid", aspect: artwork.aspect }),
			)}
		/>
	);
	const identity = (
		<MediaIdentity media={media} detail={detail} compact={compact} settled={props.settled} />
	);
	const content = (
		<>
			{media.description === null ? null : <MediaDescription text={media.description} />}
			{isTitleProvisional(media) && (
				<div className="flex items-start">
					<TranslationChip icon={<AppIcon size={13} name="globe" />} />
				</div>
			)}
			<MediaActions media={media} compact={compact} logActivity={detail.rail.logActivity} />
			<MediaLibraryStrip media={media} config={detail.rail} />
		</>
	);
	const labelledFacts = detail.facts.filter((fact) => fact.inline !== true);
	return (
		<header
			className={clsx(
				"relative isolate",
				compact ? "-mx-4 -mt-4 px-4 pt-4 pb-1" : "-mx-8 -mt-8 px-8 pt-8 pb-2",
			)}
		>
			<div className="absolute inset-0 -z-10 overflow-hidden">
				<ImageTintOverlay direction="vertical" gradientStops={gradientStops} />
			</div>
			{compact ? (
				<div className="grid grid-cols-[minmax(0,1fr)] gap-4">
					<div className="flex items-end gap-4">
						<div className="w-28 shrink-0">{art}</div>
						{identity}
					</div>
					{labelledFacts.length === 0 ? null : <MediaFactRow compact facts={labelledFacts} />}
					{content}
				</div>
			) : (
				<div className="grid grid-cols-[12rem_minmax(0,1fr)] gap-8">
					{art}
					<div className="grid min-w-0 content-start gap-4">
						{identity}
						{content}
					</div>
				</div>
			)}
		</header>
	);
}

export function MediaSummarySkeleton(props: {
	readonly compact: boolean;
	readonly title: string;
	readonly detail: string;
}) {
	const lines = (
		<div className="grid min-w-0 flex-1 content-start gap-3">
			<Skeleton className={clsx("h-9", props.compact ? "w-4/5" : "w-2/3")} />
			<Skeleton className="h-4 w-1/2" />
			<Skeleton className="h-4 w-full max-w-xl" />
			<Skeleton className="h-4 w-5/6 max-w-lg" />
			<div className="flex gap-2 pt-1">
				<Skeleton className="h-9 w-32" />
				<Skeleton className="h-9 w-28" />
			</div>
		</div>
	);
	return (
		<div role="status" className={clsx("flex gap-8", props.compact && "flex-col gap-5")}>
			<span className="sr-only">
				{props.title} {props.detail}
			</span>
			<Skeleton
				className={clsx("shrink-0 rounded-lg", props.compact ? "h-42 w-28" : "h-72 w-48")}
			/>
			{lines}
		</div>
	);
}
