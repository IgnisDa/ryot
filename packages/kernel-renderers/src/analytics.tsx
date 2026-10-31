import {
	AnalyticsSection,
	analyticsSectionKey,
	parseReportingSearch,
	reportingSearchParams,
	type ReportingSelection,
	type TimeZone,
	useAnalyticsSections,
	usePageContext,
	usePluginLocation,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	ActiveScreenContext,
	useReportingPreferences,
	useRyot,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { QueryStatus, SegmentedControl } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useContext } from "react";

import { AnalyticsControls } from "./analytics-controls";
import { CollectionAnalytics } from "./collection-analytics";

export default function AnalyticsPage() {
	const page = usePageContext();
	const isActiveScreen = useContext(ActiveScreenContext);
	const ryot = useRyot();
	const location = usePluginLocation();
	const sections = useAnalyticsSections();
	const preferences = useReportingPreferences();
	const { compact, safeAreaBottom } = useRyotViewport();
	const selection = parseReportingSearch(location.search);
	const selectionParams = reportingSearchParams(selection);
	const requested = new URLSearchParams(location.search).get("section");
	const active = sections.find((section) => analyticsSectionKey(section) === requested);
	const updateSelection = (next: ReportingSelection) =>
		ryot.navigation.pageSearch.push(reportingSearchParams(next));
	const sectionNav =
		sections.length > 0 ? (
			<div className="max-w-full min-w-0 overflow-x-auto">
				<SegmentedControl
					optionClassName="px-3"
					label="Analytics sections"
					value={active === undefined ? "" : analyticsSectionKey(active)}
					onChange={(key) => ryot.navigation.pageSearch.push({ section: key === "" ? null : key })}
					options={[
						{
							value: "",
							label: "Collections",
							content: (
								<>
									<AppIcon size={16} name="folders" />
									Collections
								</>
							),
						},
						...sections.map((section) => ({
							label: section.name,
							value: analyticsSectionKey(section),
							content: (
								<>
									<AppIcon size={16} name={section.icon} />
									{section.name}
								</>
							),
						})),
					]}
				/>
			</div>
		) : null;
	const content = (timeZone: TimeZone) =>
		active === undefined ? (
			<CollectionAnalytics timeZone={timeZone} selection={selection} />
		) : (
			<section className="min-w-0" aria-label={active.name}>
				<AnalyticsSection
					timeZone={timeZone}
					registration={active}
					selection={selection}
					key={analyticsSectionKey(active)}
				/>
			</section>
		);
	return (
		<PluginScreenFrame
			title={page.view?.name ?? "Analytics"}
			titleIcon={<AppIcon size={22} name={page.view?.icon ?? "chart-column"} />}
		>
			<div
				style={{ paddingBottom: safeAreaBottom + 48 }}
				className="mx-auto grid w-full max-w-5xl gap-5 p-4"
			>
				<QueryStatus
					query={preferences}
					label="reporting preferences"
					onRetry={preferences.refetch}
				>
					{({ timeZone }) => (
						<AnalyticsControls
							compact={compact}
							timeZone={timeZone}
							leading={sectionNav}
							selection={selection}
							onSelectionChange={updateSelection}
							key={Object.values(selectionParams).join("|")}
						/>
					)}
				</QueryStatus>
				{isActiveScreen && preferences.data !== undefined
					? content(preferences.data.timeZone)
					: null}
			</div>
		</PluginScreenFrame>
	);
}
