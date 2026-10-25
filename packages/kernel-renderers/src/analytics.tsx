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
import { Button, QueryStatus } from "@ryot-app/plugin-ui-sdk";
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
	const content = (timeZone: TimeZone) =>
		active === undefined ? (
			<CollectionAnalytics timeZone={timeZone} selection={selection} />
		) : (
			<section aria-label={active.name}>
				<h2 className="mb-4 text-xl font-semibold">{active.name}</h2>
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
				className="mx-auto grid w-full max-w-5xl gap-6 p-4"
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
							selection={selection}
							onSelectionChange={updateSelection}
							key={Object.values(selectionParams).join("|")}
						/>
					)}
				</QueryStatus>
				{sections.length > 0 && (
					<nav aria-label="Analytics sections" className="flex flex-wrap gap-2">
						<Button
							aria-pressed={active === undefined}
							variant={active === undefined ? "primary" : "ghost"}
							onClick={() => ryot.navigation.pageSearch.push({ section: null })}
						>
							<AppIcon size={18} name="folders" />
							Collection reviews
						</Button>
						{sections.map((section) => (
							<Button
								aria-pressed={section === active}
								key={analyticsSectionKey(section)}
								variant={section === active ? "primary" : "ghost"}
								onClick={() =>
									ryot.navigation.pageSearch.push({ section: analyticsSectionKey(section) })
								}
							>
								<AppIcon size={18} name={section.icon} />
								{section.name}
							</Button>
						))}
					</nav>
				)}
				{isActiveScreen && preferences.data !== undefined
					? content(preferences.data.timeZone)
					: null}
			</div>
		</PluginScreenFrame>
	);
}
