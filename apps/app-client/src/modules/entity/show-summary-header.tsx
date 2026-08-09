import clsx from "clsx";
import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { AppSwitch } from "@/modules/ui/switch";

import { ShowAssetImage } from "./show-image";
import {
	ShowActionButton,
	ShowChip,
	ShowFact,
	ShowFactDivider,
	ShowLinkButton,
	ShowRailRow,
} from "./show-primitives";
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
} from "./show-summary-state";

const SHOW_TYPE_LABEL = "TV Show";

const RATING_SUFFIX = " / 100";

const DESCRIPTION_CLAMP = 3;

type SummaryFact = {
	readonly icon: string;
	readonly label: string;
	readonly value: string;
	readonly suffix?: string;
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
					iconClass: "text-gold",
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
		<View className="flex-row flex-wrap items-center gap-y-4 pt-0.5 md:flex-nowrap md:gap-x-4">
			{summaryFacts(props.show).map((fact, index) => (
				<View key={fact.label} className="w-1/2 flex-row items-center gap-3 md:w-auto md:flex-none">
					{index === 0 ? null : (
						<View className={clsx("mr-3 md:mr-4", index % 2 === 0 && "hidden md:flex")}>
							<ShowFactDivider />
						</View>
					)}
					<View className="w-5 items-center md:hidden">
						<AppIcon name={fact.icon} size={18} className={fact.iconClass ?? "text-text-subtle"} />
					</View>
					<ShowFact label={fact.label} value={fact.value} suffix={fact.suffix} />
				</View>
			))}
		</View>
	);
}

function ShowIdentityLine(props: { readonly show: ShowSummary }) {
	const { show } = props;
	const release = showReleaseLabel(show);
	return (
		<Text className="font-ui text-[13px] text-text">
			{SHOW_TYPE_LABEL}
			{show.providerName === null ? null : (
				<>
					{" • "}
					<Text className="font-ui-medium">{show.providerName}</Text>
				</>
			)}
			{release === undefined ? null : ` • ${release}`}
		</Text>
	);
}

function ShowDescription(props: {
	readonly text: string;
	readonly onToggle: () => void;
	readonly isExpanded: boolean;
}) {
	return (
		<View className="gap-1 pt-1">
			<Text
				className="font-ui text-[14px] leading-6 text-text"
				numberOfLines={props.isExpanded ? undefined : DESCRIPTION_CLAMP}
			>
				{props.text}
			</Text>
			<View className="items-start">
				<ShowLinkButton
					tone="plain"
					onPress={props.onToggle}
					label={props.isExpanded ? "Less" : "More"}
				/>
			</View>
		</View>
	);
}

function ShowIdentity(props: { readonly show: ShowSummary; readonly description: ReactNode }) {
	const { show } = props;
	return (
		<View className="min-w-0 gap-4 md:flex-1 md:gap-2.5">
			<View className="min-h-48 justify-end gap-2.5 pl-36 md:min-h-0 md:justify-start md:pl-0">
				<Text className="font-display-semibold text-[22px] leading-7 text-text md:text-[34px] md:leading-10">
					{show.name}
				</Text>
				<ShowIdentityLine show={show} />
				{show.genres === null || show.genres.length === 0 ? null : (
					<View className="flex-row flex-wrap gap-1.5">
						{show.genres.map((genre) => (
							<ShowChip key={genre} label={genre} />
						))}
					</View>
				)}
			</View>
			<ShowFactRow show={show} />
			{props.description}
		</View>
	);
}

function ShowLibraryBadge(props: { readonly isInLibrary: boolean }) {
	if (!props.isInLibrary) {
		return <AppIcon name="circle-check" size={20} className="text-text-subtle" />;
	}
	return (
		<View className="h-5 w-5 items-center justify-center rounded-full bg-success">
			<AppIcon name="check" size={13} className="text-bg" />
		</View>
	);
}

function ShowStatusRail(props: { readonly show: ShowSummary }) {
	const { show } = props;
	return (
		<View className="gap-3 md:w-84 md:gap-2">
			<View className="overflow-hidden rounded-lg border border-border bg-surface">
				<ShowRailRow
					icon="circle-check"
					title="Your status"
					detail="Status is calculated from your activity"
					trailing={
						<Text className="font-ui-medium text-[13px] text-success">
							{showLifecycleLabel(show.state)}
						</Text>
					}
				/>
				<ShowRailRow
					icon="radio"
					title="Monitoring"
					detail="Keep provider details up to date"
					trailing={
						<AppSwitch
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
						<Text className="font-ui text-[13px] text-text-muted">
							{showOwnershipLabel(show.owned)}
						</Text>
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
							onPress={() => console.log("TODO: manage collections")}
						/>
					}
				/>
			</View>
			<View className="flex-row gap-2 md:flex-col">
				<ShowActionButton
					variant="primary"
					label="Log activity"
					onPress={() => console.log("TODO: open activity form")}
				/>
				<ShowActionButton
					variant="secondary"
					label="Write review"
					onPress={() => console.log("TODO: open review form")}
				/>
			</View>
		</View>
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
		<View className="gap-4 md:flex-row md:items-start md:gap-8">
			<View className="min-w-0 md:flex-1 md:flex-row md:gap-8">
				<ShowAssetImage
					asset={showPosterAsset(props.show)}
					className="absolute top-0 left-0 aspect-2/3 w-32 md:relative md:w-60 md:shrink-0"
				/>
				<ShowIdentity show={props.show} description={descriptionNode} />
			</View>
			<ShowStatusRail show={props.show} />
		</View>
	);
}
