import { Switch } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import clsx from "clsx";
import { useState, type ReactNode } from "react";

import { ManagedAssetImage } from "./managed-assets";
import {
	ShowActionButton,
	ShowChip,
	ShowFact,
	ShowFactDivider,
	ShowLinkButton,
	ShowRailRow,
} from "./primitives";
import {
	showCollectionsLabel,
	showEpisodeFact,
	showLifecycleLabel,
	showOwnershipLabel,
	showPosterAsset,
	showRatingLabel,
	showReleaseLabel,
	showSeasonFact,
	type ShowSummary,
} from "./summary-state";

const SHOW_TYPE_LABEL = "TV Show";

const RATING_SUFFIX = " / 100";

type SummaryFact = {
	readonly icon: string;
	readonly label: string;
	readonly value: string;
	readonly suffix?: string | undefined;
	readonly iconClass?: string;
};

const summaryFacts = (show: ShowSummary): readonly SummaryFact[] => {
	const seasons = showSeasonFact(show);
	const episodes = showEpisodeFact(show);
	const ratingLabel = showRatingLabel(show);
	return [
		ratingLabel === undefined
			? undefined
			: {
					icon: "star",
					value: ratingLabel,
					suffix: RATING_SUFFIX,
					iconClass: "text-accent-text",
					label: show.providerName === null ? "Provider rating" : `${show.providerName} rating`,
				},
		show.productionStatus === null
			? undefined
			: { icon: "clapperboard", label: "Production status", value: show.productionStatus },
		seasons === undefined ? undefined : { icon: "layers-3", ...seasons },
		episodes === undefined ? undefined : { icon: "tv", ...episodes },
	].filter((fact) => fact !== undefined);
};

function ShowFactRow(props: { readonly show: ShowSummary }) {
	return (
		<div className="flex flex-wrap items-center gap-y-4 pt-0.5 md:flex-nowrap md:gap-x-4">
			{summaryFacts(props.show).map((fact, index) => (
				<div key={fact.label} className="flex w-1/2 items-center gap-3 md:w-auto md:flex-none">
					{index === 0 ? null : (
						<div className={clsx("mr-3 md:mr-4", index % 2 === 0 ? "hidden md:flex" : "flex")}>
							<ShowFactDivider />
						</div>
					)}
					<div className="flex w-5 items-center md:hidden">
						<AppIcon name={fact.icon} size={18} className={fact.iconClass ?? "text-text-subtle"} />
					</div>
					<ShowFact label={fact.label} value={fact.value} suffix={fact.suffix} />
				</div>
			))}
		</div>
	);
}

function ShowIdentityLine(props: { readonly show: ShowSummary }) {
	const { show } = props;
	const release = showReleaseLabel(show);
	return (
		<p className="font-ui text-[13px] text-text">
			{SHOW_TYPE_LABEL}
			{show.providerName === null ? null : (
				<>
					{" • "}
					<span className="font-ui font-medium">{show.providerName}</span>
				</>
			)}
			{release === undefined ? null : ` • ${release}`}
		</p>
	);
}

function ShowDescription(props: {
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
				<ShowLinkButton
					tone="plain"
					onClick={props.onToggle}
					label={props.isExpanded ? "Less" : "More"}
				/>
			</div>
		</div>
	);
}

function ShowIdentity(props: { readonly show: ShowSummary; readonly description: ReactNode }) {
	const { show } = props;
	return (
		<div className="flex min-w-0 flex-col gap-4 md:flex-1 md:gap-2.5">
			<div className="flex min-h-48 flex-col justify-end gap-2.5 pl-36 md:min-h-0 md:justify-start md:pl-0">
				<h1 className="font-display font-semibold text-[22px] leading-7 text-text md:text-[34px] md:leading-10">
					{show.name}
				</h1>
				<ShowIdentityLine show={show} />
				{show.genres === null || show.genres.length === 0 ? null : (
					<div className="flex flex-wrap gap-1.5">
						{show.genres.map((genre) => (
							<ShowChip key={genre} label={genre} />
						))}
					</div>
				)}
			</div>
			<ShowFactRow show={show} />
			{props.description}
		</div>
	);
}

function ShowLibraryBadge(props: { readonly isInLibrary: boolean }) {
	if (!props.isInLibrary) {
		return <AppIcon name="circle-check" size={20} className="text-text-subtle" />;
	}
	return (
		<div className="flex h-5 w-5 items-center justify-center rounded-full bg-success">
			<AppIcon name="check" size={13} className="text-bg" />
		</div>
	);
}

function ShowStatusRail(props: { readonly show: ShowSummary }) {
	const { show } = props;
	return (
		<div className="flex flex-col gap-3 md:w-84 md:gap-2">
			<div className="overflow-hidden rounded-lg border border-border bg-surface">
				<ShowRailRow
					icon="circle-check"
					title="Your status"
					detail="Status is calculated from your activity"
					trailing={
						<span className="font-ui font-medium text-[13px] text-success">
							{showLifecycleLabel(show.state)}
						</span>
					}
				/>
				<ShowRailRow
					icon="radio"
					title="Monitoring"
					detail="Keep provider details up to date"
					trailing={
						<Switch
							checked={show.isMonitored}
							label="Toggle media monitoring"
							onChange={() => console.log("TODO: toggle media monitoring")}
						/>
					}
				/>
				<ShowRailRow
					icon="library"
					title="In library"
					trailing={<ShowLibraryBadge isInLibrary={show.isInLibrary} />}
				/>
				<ShowRailRow
					icon="tags"
					title="Ownership"
					trailing={
						<span className="font-ui text-[13px] text-text-muted">
							{showOwnershipLabel(show.owned)}
						</span>
					}
				/>
				<ShowRailRow
					divided={false}
					icon="layers-3"
					title="Collections"
					detail={showCollectionsLabel(show.collections)}
					trailing={
						<ShowLinkButton
							label="Manage"
							onClick={() => console.log("TODO: manage collections")}
						/>
					}
				/>
			</div>
			<div className="flex gap-2 md:flex-col">
				<ShowActionButton
					variant="primary"
					label="Log activity"
					onClick={() => console.log("TODO: open activity form")}
				/>
				<ShowActionButton
					variant="secondary"
					label="Write review"
					onClick={() => console.log("TODO: open review form")}
				/>
			</div>
		</div>
	);
}

export function ShowSummaryHeader(props: { readonly show: ShowSummary }) {
	const { description } = props.show;
	const [isExpanded, setIsExpanded] = useState(false);
	const descriptionNode =
		description === null ? null : (
			<ShowDescription
				text={description}
				isExpanded={isExpanded}
				onToggle={() => setIsExpanded(!isExpanded)}
			/>
		);
	return (
		<div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-8">
			<div className="relative flex min-w-0 flex-col md:flex-1 md:flex-row md:gap-8">
				<ManagedAssetImage
					asset={showPosterAsset(props.show)}
					className="absolute top-0 left-0 aspect-2/3 w-32 md:relative md:w-60 md:shrink-0"
				/>
				<ShowIdentity show={props.show} description={descriptionNode} />
			</div>
			<ShowStatusRail show={props.show} />
		</div>
	);
}
