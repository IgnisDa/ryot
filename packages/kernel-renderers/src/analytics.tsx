import {
	AnalyticsSection,
	analyticsSectionKey,
	parseReportingSearch,
	reportingSearchParams,
	type ReportingSelection,
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
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { type ReactNode, useContext } from "react";

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
	let content: ReactNode;
	if (!isActiveScreen) {
		content = null;
	} else if (preferences.data === undefined) {
		content = preferences.error ? (
			<StatusMessage tone="error" action={{ label: "Retry", onClick: preferences.refetch }}>
				Could not load reporting preferences.
			</StatusMessage>
		) : (
			<StatusMessage tone="pending">Loading reporting preferences…</StatusMessage>
		);
	} else if (active === undefined) {
		content = <CollectionAnalytics selection={selection} timeZone={preferences.data.timeZone} />;
	} else {
		content = (
			<section aria-label={active.name}>
				<h2 className="mb-4 text-xl font-semibold">{active.name}</h2>
				<AnalyticsSection
					registration={active}
					selection={selection}
					key={analyticsSectionKey(active)}
					timeZone={preferences.data.timeZone}
				/>
			</section>
		);
	}
	return (
		<PluginScreenFrame
			title={page.view?.name ?? "Analytics"}
			titleIcon={<AppIcon size={22} name={page.view?.icon ?? "chart-column"} />}
		>
			<div
				style={{ paddingBottom: safeAreaBottom + 48 }}
				className="mx-auto grid w-full max-w-5xl gap-6 p-4"
			>
				{preferences.data !== undefined && preferences.error && (
					<StatusMessage tone="error" action={{ label: "Retry", onClick: preferences.refetch }}>
						Reporting preferences refresh failed. The last loaded time zone,{" "}
						{preferences.data.timeZone}, is being used.
					</StatusMessage>
				)}
				{preferences.data !== undefined && (
					<AnalyticsControls
						compact={compact}
						selection={selection}
						onSelectionChange={updateSelection}
						timeZone={preferences.data.timeZone}
						key={Object.values(selectionParams).join("|")}
					/>
				)}
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
				{content}
			</div>
		</PluginScreenFrame>
	);
}
