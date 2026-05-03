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

const identityLine = (show: ShowSummary) =>
	[SHOW_TYPE_LABEL, showReleaseLabel(show)].filter((part) => part !== undefined).join(" • ");

function ShowFactRow(props: { readonly show: ShowSummary }) {
	const { show } = props;
	const seasons = showSeasonFact(show);
	const episodes = showEpisodeFact(show);
	const ratingLabel = showRatingLabel(show);
	const facts = [
		show.productionStatus === null
			? undefined
			: { icon: "clapperboard", label: "Production status", value: show.productionStatus },
		seasons === undefined ? undefined : { icon: "layers-3", ...seasons },
		episodes === undefined ? undefined : { icon: "tv", ...episodes },
	].filter((fact) => fact !== undefined);
	return (
		<View className="flex-row flex-wrap items-center gap-x-4 gap-y-3 pt-0.5 md:flex-nowrap">
			{ratingLabel === undefined ? null : (
				<View className="flex-row items-center gap-2">
					<AppIcon name="star" size={18} className="text-gold" />
					<ShowFact
						value={ratingLabel}
						suffix={RATING_SUFFIX}
						label={show.providerName === null ? "Provider rating" : `${show.providerName} rating`}
					/>
				</View>
			)}
			{facts.map((fact, index) => (
				<View key={fact.label} className="flex-row items-center gap-4">
					{index === 0 && ratingLabel === undefined ? null : <ShowFactDivider />}
					<View className="md:hidden">
						<AppIcon name={fact.icon} size={18} className="text-text-subtle" />
					</View>
					<ShowFact label={fact.label} value={fact.value} />
				</View>
			))}
		</View>
	);
}

function ShowIdentity(props: { readonly show: ShowSummary }) {
	const { show } = props;
	return (
		<View className="min-w-0 flex-1 gap-2.5">
			<Text className="font-display-semibold text-[26px] leading-8 text-text md:text-[34px] md:leading-10">
				{show.name}
			</Text>
			<View className="flex-row flex-wrap items-center gap-2">
				<Text className="font-ui text-[13px] text-text-muted">{identityLine(show)}</Text>
				{show.providerName === null ? null : <ShowChip label={show.providerName} />}
			</View>
			{show.genres === null || show.genres.length === 0 ? null : (
				<View className="flex-row flex-wrap gap-1.5">
					{show.genres.map((genre) => (
						<ShowChip key={genre} label={genre} />
					))}
				</View>
			)}
			<ShowFactRow show={show} />
			{show.description === null ? null : (
				<Text numberOfLines={4} className="pt-1 font-ui text-[14px] leading-6 text-text-muted">
					{show.description}
				</Text>
			)}
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
	const { collections } = show;
	return (
		<View className="overflow-hidden rounded-lg border border-border bg-surface md:w-84">
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
				icon="layers-3"
				title="Collections"
				trailing={
					<ShowLinkButton label="Manage" onPress={() => console.log("TODO: manage collections")} />
				}
			>
				{collections.items.length === 0 ? (
					<Text className="font-ui text-[13px] text-text-muted">
						This show is not in any collection.
					</Text>
				) : (
					<View className="flex-row flex-wrap gap-1.5">
						{collections.items.map((collection) => (
							<ShowChip key={collection.id} label={collection.name} />
						))}
					</View>
				)}
			</ShowRailRow>
			<ShowRailRow
				divided={false}
				icon="circle-check"
				title="Your status"
				detail="Status is calculated from your activity"
				trailing={
					<Text className="font-ui-medium text-[13px] text-success">
						{showLifecycleLabel(show.state)}
					</Text>
				}
			/>
			<View className="flex-row gap-2 px-4 pb-4 md:flex-col">
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

export function ShowSummaryHeader(props: {
	readonly show: ShowSummary;
	readonly managedUrls: ReadonlyMap<string, string>;
}) {
	return (
		<View className="gap-4 md:flex-row md:items-start md:gap-8">
			<View className="flex-row gap-4 md:min-w-0 md:flex-1 md:gap-8">
				<ShowAssetImage
					managedUrls={props.managedUrls}
					asset={showPosterAsset(props.show)}
					className="aspect-2/3 w-24 shrink-0 md:w-60"
				/>
				<ShowIdentity show={props.show} />
			</View>
			<ShowStatusRail show={props.show} />
		</View>
	);
}
