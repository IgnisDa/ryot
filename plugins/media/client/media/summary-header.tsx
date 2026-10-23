import type { EntitySettleReason } from "@ryot-app/plugin-client-sdk";
import { Badge, Button, Row, RowGroup } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { markdownPlainText } from "@ryot-app/plugin-ui-sdk/markdown";
import {
	fieldSyncState,
	isTitleProvisional,
	SettleHighlight,
	TranslationChip,
} from "@ryot-app/plugin-ui-sdk/sync";
import clsx from "clsx";
import { Fragment, useState } from "react";

import { MediaLogActivityButton } from "./activity-log/button";
import type { MediaActivityLogger } from "./activity-log/state";
import { MediaCollectionsRow } from "./collections";
import { mediaArtworkClass } from "./entity-presentation";
import { ManagedAssetImage } from "./managed-assets";
import { MediaMonitoringRow } from "./monitoring";
import { MediaExternalLink, MediaFactRow, MediaMarkdown, MediaProgressBar } from "./primitives";
import { MediaReviewButton } from "./review";
import {
	type MediaEntitySummaryValue,
	mediaOwnershipLabel,
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
				<div className="text-[15px] leading-6 text-text-muted">
					<MediaMarkdown text={props.text} />
				</div>
			) : (
				<p className="line-clamp-3 text-[15px] leading-6 text-text-muted">
					{markdownPlainText(props.text)}
				</p>
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
	readonly entityId: string;
	readonly logActivity: MediaActivityLogger | undefined;
}) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			{props.logActivity === undefined ? null : (
				<MediaLogActivityButton
					compact={props.compact}
					entityId={props.entityId}
					logger={props.logActivity}
				/>
			)}
			<MediaReviewButton entityId={props.entityId} />
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
	const { status } = detail.rail;
	const inlineFacts = detail.facts.filter((fact) => fact.inline === true);
	const labelledFacts = detail.facts.filter((fact) => fact.inline !== true);
	return (
		<SettleHighlight reason={props.settled} className="grid min-w-0 content-start gap-3 rounded-lg">
			<h1
				className={clsx(
					"font-display font-semibold tracking-tight text-balance text-text",
					compact ? "text-[22px] leading-7" : "text-display",
				)}
			>
				{media.name}
			</h1>
			<MediaIdentityLine media={media} facts={inlineFacts} detail={detail.identityDetail} />
			{status === undefined && detail.chips.length === 0 ? null : (
				<div className="flex flex-wrap gap-1.5">
					{status === undefined ? null : (
						<Badge dot variant={status.tone}>
							{status.label}
						</Badge>
					)}
					{detail.chips.map((chip) => (
						<Badge key={chip} variant="neutral">
							{chip}
						</Badge>
					))}
				</div>
			)}
			{labelledFacts.length === 0 ? null : <MediaFactRow compact={compact} facts={labelledFacts} />}
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

function MediaLibraryBadge(props: { readonly isInMediaLibrary: boolean }) {
	if (!props.isInMediaLibrary) {
		return <AppIcon size={20} name="circle-check" className="text-text-subtle" />;
	}
	return (
		<div className="flex h-5 w-5 items-center justify-center rounded-full bg-success">
			<AppIcon size={13} name="check" className="text-bg" />
		</div>
	);
}

function MediaStatusRail(props: {
	readonly media: MediaEntitySummaryValue;
	readonly config: MediaStatusRailConfig;
}) {
	const { media, config } = props;
	const { status, ownership } = config;
	return (
		<RowGroup className="self-start">
			{status === undefined ? null : (
				<Row
					title="Your status"
					trailing={
						<Badge dot size="sm" variant={status.tone}>
							{status.label}
						</Badge>
					}
					description={
						status.progress === undefined ? undefined : (
							<MediaProgressBar percent={status.progress.percent} />
						)
					}
				/>
			)}
			{media.providerName === null ? null : (
				<MediaMonitoringRow key={media.id} entityId={media.id} monitored={media.isMonitored} />
			)}
			<Row
				title="In media library"
				trailing={<MediaLibraryBadge isInMediaLibrary={media.isInMediaLibrary} />}
			/>
			{ownership === undefined ? null : (
				<Row
					title="Ownership"
					trailing={
						<span className="text-sm text-text-muted">{mediaOwnershipLabel(ownership.owned)}</span>
					}
				/>
			)}
			<MediaCollectionsRow
				entityId={media.id}
				key={`collections:${media.id}`}
				collections={media.collections}
			/>
		</RowGroup>
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
			<MediaActions compact={compact} entityId={media.id} logActivity={detail.rail.logActivity} />
		</>
	);
	const rail = <MediaStatusRail media={media} config={detail.rail} />;
	if (compact) {
		return (
			<div className="grid gap-5">
				<div className="flex items-start gap-4">
					<div className="w-28 shrink-0">{art}</div>
					{identity}
				</div>
				{content}
				{rail}
			</div>
		);
	}
	return (
		<div className="grid grid-cols-[11rem_minmax(0,1fr)_18rem] gap-7">
			{art}
			<div className="grid min-w-0 content-start gap-3.5">
				{identity}
				{content}
			</div>
			{rail}
		</div>
	);
}
