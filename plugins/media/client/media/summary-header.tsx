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

import { ManagedAssetImage } from "./managed-assets";
import {
	MediaActionButton,
	MediaChip,
	MediaFact,
	MediaFactDivider,
	MediaLinkButton,
	MediaProgressBar,
	MediaRailRow,
} from "./primitives";
import {
	mediaCollectionsLabel,
	mediaOwnershipLabel,
	mediaPosterAsset,
	mediaReleaseLabel,
	type MediaCollectionList,
	type MediaSummaryFact,
	type MediaSummaryFields,
} from "./summary-state";

export type MediaSummaryValue = MediaSummaryFields & { readonly collections: MediaCollectionList };

function MediaFactRow(props: {
	readonly compact: boolean;
	readonly facts: readonly MediaSummaryFact[];
}) {
	const { compact } = props;
	return (
		<div
			className={clsx(
				"flex flex-wrap items-center gap-y-4 pt-0.5",
				!compact && "flex-nowrap gap-x-4",
			)}
		>
			{props.facts.map((fact, index) => (
				<div
					key={fact.label}
					className={clsx("flex items-center gap-3", compact ? "w-1/2" : "w-auto flex-none")}
				>
					{index === 0 || (compact && index % 2 === 0) ? null : (
						<div className={clsx("flex", compact ? "mr-3" : "mr-4")}>
							<MediaFactDivider />
						</div>
					)}
					{compact && (
						<div className="flex w-5 items-center">
							<AppIcon
								size={18}
								name={fact.icon}
								className={fact.iconClass ?? "text-text-subtle"}
							/>
						</div>
					)}
					<MediaFact label={fact.label} value={fact.value} suffix={fact.suffix} />
				</div>
			))}
		</div>
	);
}

function MediaIdentityLine(props: {
	readonly typeLabel: string;
	readonly media: MediaSummaryValue;
}) {
	const { media } = props;
	const release = mediaReleaseLabel(media);
	return (
		<p className="font-ui text-[13px] text-text">
			{props.typeLabel}
			{media.providerName === null ? null : (
				<>
					{" • "}
					<span className="font-ui font-medium">{media.providerName}</span>
				</>
			)}
			{release === undefined ? null : ` • ${release}`}
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
	readonly media: MediaSummaryValue;
	readonly facts: readonly MediaSummaryFact[];
	readonly settled: EntitySettleReason | undefined;
}) {
	const { media, compact } = props;
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
				<MediaIdentityLine media={media} typeLabel={props.typeLabel} />
				{media.genres === null || media.genres.length === 0 ? null : (
					<div className="flex flex-wrap gap-1.5">
						{media.genres.map((genre) => (
							<MediaChip key={genre} label={genre} />
						))}
					</div>
				)}
			</SettleHighlight>
			<MediaFactRow compact={compact} facts={props.facts} />
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
	readonly lifecycleLabel: string;
	readonly media: MediaSummaryValue;
	readonly progress: { readonly percent: number } | undefined;
}) {
	const { media, compact } = props;
	return (
		<div className={clsx("flex flex-col", compact ? "gap-3" : "w-84 gap-2")}>
			<div className="overflow-hidden rounded-lg border border-border bg-surface">
				<MediaRailRow
					compact={compact}
					icon="circle-check"
					title="Your status"
					detail="Status is calculated from your activity"
					trailing={
						<span className="font-ui font-medium text-[13px] text-success">
							{props.lifecycleLabel}
						</span>
					}
				/>
				{props.progress === undefined ? null : (
					<div className="px-4 py-3.5">
						<MediaProgressBar percent={props.progress.percent} />
					</div>
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
				<MediaRailRow
					icon="tags"
					compact={compact}
					title="Ownership"
					trailing={
						<span className="font-ui text-[13px] text-text-muted">
							{mediaOwnershipLabel(media.owned)}
						</span>
					}
				/>
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
				<MediaActionButton
					variant="primary"
					compact={compact}
					label="Log activity"
					onClick={() => console.log("TODO: open activity form")}
				/>
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
	readonly lifecycleLabel: string;
	readonly media: MediaSummaryValue;
	readonly facts: readonly MediaSummaryFact[];
	readonly settled: EntitySettleReason | undefined;
	readonly progress?: { readonly percent: number } | undefined;
}) {
	const { media, compact } = props;
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
				<ManagedAssetImage
					monogram={media.name}
					asset={mediaPosterAsset(media)}
					state={fieldSyncState(mediaPosterAsset(media), media)}
					className={clsx(
						"aspect-2/3",
						compact ? "absolute top-0 left-0 w-32" : "relative w-60 shrink-0",
					)}
				/>
				<MediaIdentity
					media={media}
					compact={compact}
					facts={props.facts}
					settled={props.settled}
					typeLabel={props.typeLabel}
					description={descriptionNode}
				/>
			</div>
			<MediaStatusRail
				media={media}
				compact={compact}
				progress={props.progress}
				lifecycleLabel={props.lifecycleLabel}
			/>
		</div>
	);
}
