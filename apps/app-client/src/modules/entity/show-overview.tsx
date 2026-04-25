import clsx from "clsx";
import { Text, View } from "react-native";

import {
	ShowCompaniesSection,
	ShowImageGallery,
	ShowPeopleSection,
	ShowRecommendationsSection,
} from "./show-overview-sections";
import {
	showOverviewError,
	showOverviewIsEmpty,
	type ShowOverview as ShowOverviewData,
	type ShowOverviewState,
} from "./show-overview-state";
import { ShowLinkButton, ShowOverviewSection } from "./show-primitives";
import { showGalleryAssets, type ShowSummary } from "./show-summary-state";

type ManagedUrls = ReadonlyMap<string, string>;

function ShowOverviewNotice(props: {
	readonly title: string;
	readonly detail: string;
	readonly divided: boolean;
	readonly onRetry?: () => void;
}) {
	return (
		<ShowOverviewSection divided={props.divided} title="Cast, companies and recommendations">
			<View className="items-start gap-2">
				<Text className="font-ui text-[13px] text-text-muted">{props.title}</Text>
				<Text className="max-w-xl font-ui text-[13px] text-text-subtle">{props.detail}</Text>
				{props.onRetry === undefined ? null : (
					<ShowLinkButton label="Try again" onPress={props.onRetry} />
				)}
			</View>
		</ShowOverviewSection>
	);
}

function ShowOverviewRelations(props: {
	readonly divided: boolean;
	readonly managedUrls: ManagedUrls;
	readonly overview: ShowOverviewData;
}) {
	if (showOverviewIsEmpty(props.overview)) {
		return null;
	}
	const { companies, people, recommendations } = props.overview;
	const hasCredits = people.items.length > 0 || companies.items.length > 0;
	return (
		<>
			<View
				className={clsx(
					"gap-7 md:flex-row md:gap-10",
					hasCredits && "md:pt-5",
					hasCredits && props.divided && "md:border-t md:border-border",
				)}
			>
				<ShowPeopleSection
					people={people.items}
					divided={props.divided}
					managedUrls={props.managedUrls}
				/>
				<ShowCompaniesSection
					companies={companies.items}
					managedUrls={props.managedUrls}
					divided={props.divided || people.items.length > 0}
				/>
			</View>
			<ShowRecommendationsSection
				managedUrls={props.managedUrls}
				divided={props.divided || hasCredits}
				recommendations={recommendations.items}
			/>
		</>
	);
}

function ShowOverviewBody(props: {
	readonly divided: boolean;
	readonly refresh: () => void;
	readonly managedUrls: ManagedUrls;
	readonly state: ShowOverviewState;
}) {
	const { state } = props;
	if (state.status === "loading") {
		return (
			<ShowOverviewNotice
				divided={props.divided}
				title="Loading details..."
				detail="Fetching the cast, companies and recommendations for this show."
			/>
		);
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return (
			<ShowOverviewNotice
				divided={props.divided}
				onRetry={props.refresh}
				{...showOverviewError(state)}
			/>
		);
	}
	return (
		<ShowOverviewRelations
			divided={props.divided}
			overview={state.overview}
			managedUrls={props.managedUrls}
		/>
	);
}

export function ShowOverview(props: {
	readonly show: ShowSummary;
	readonly managedUrls: ManagedUrls;
	readonly refreshOverview: () => void;
	readonly overview: ShowOverviewState;
	readonly overviewManagedUrls: ManagedUrls;
}) {
	const gallery = showGalleryAssets(props.show);
	return (
		<View className="gap-7 pt-6 md:gap-9 md:pt-8">
			<ShowImageGallery divided={false} assets={gallery} managedUrls={props.managedUrls} />
			<ShowOverviewBody
				state={props.overview}
				divided={gallery.length > 0}
				refresh={props.refreshOverview}
				managedUrls={props.overviewManagedUrls}
			/>
		</View>
	);
}
