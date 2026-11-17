import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	AnalyticsReport,
	AnalyticsSection,
	analyticsSectionKey,
	entitledReportingSelection,
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
	useEntitlement,
	useRyot,
	useT,
	useUserPreferences,
} from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { EmptyState, QueryStatus, SegmentedControl } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useContext } from "react";

import { AnalyticsControls } from "./analytics-controls";

export default function AnalyticsPage() {
	const page = usePageContext();
	const isActiveScreen = useContext(ActiveScreenContext);
	const ryot = useRyot();
	const location = usePluginLocation();
	const t = useT();
	const sections = useAnalyticsSections();
	const preferences = useUserPreferences();
	const pro = useEntitlement("pro");
	const { compact, safeAreaBottom } = useRyotViewport();
	const selection = entitledReportingSelection(
		parseReportingSearch(location.search),
		pro.data ?? [],
	);
	const selectionParams = reportingSearchParams(selection);
	const requested = new URLSearchParams(location.search).get("section");
	const active =
		sections.find((section) => analyticsSectionKey(section) === requested) ?? sections[0];
	const updateSelection = (next: ReportingSelection) =>
		ryot.navigation.pageSearch.push(reportingSearchParams(next));
	const sectionNav =
		active !== undefined && sections.length > 1 ? (
			<div className="max-w-full min-w-0 overflow-x-auto">
				<SegmentedControl
					optionClassName="px-3"
					value={analyticsSectionKey(active)}
					label={t(kernelMessage("renderer.analytics.sections"))}
					onChange={(key) => ryot.navigation.pageSearch.push({ section: key })}
					options={sections.map((section) => ({
						label: t(section.name),
						value: analyticsSectionKey(section),
						content: (
							<>
								<AppIcon size={16} name={section.icon} />
								{t(section.name)}
							</>
						),
					}))}
				/>
			</div>
		) : null;
	const content = (timeZone: TimeZone) =>
		active === undefined ? (
			<EmptyState
				icon={<AppIcon size={18} name="chart-column" />}
				title={t(kernelMessage("renderer.analytics.empty-title"))}
				description={t(kernelMessage("renderer.analytics.empty-description"))}
			/>
		) : (
			<section className="min-w-0" aria-label={t(active.name)}>
				<AnalyticsReport
					key={JSON.stringify([analyticsSectionKey(active), selection, timeZone])}
					subtitle={t(kernelMessage("renderer.analytics.report-subtitle", { zone: timeZone }))}
					title={t(kernelMessage("renderer.analytics.report-title", { section: t(active.name) }))}
				>
					<AnalyticsSection
						timeZone={timeZone}
						registration={active}
						selection={selection}
						key={analyticsSectionKey(active)}
					/>
				</AnalyticsReport>
			</section>
		);
	return (
		<PluginScreenFrame
			titleIcon={<AppIcon size={22} name={page.view?.icon ?? "chart-column"} />}
			title={page.view ? page.view.name : kernelMessage("definition.saved-view.analytics")}
		>
			<div
				style={{ paddingBottom: safeAreaBottom + 48 }}
				className="mx-auto grid w-full max-w-5xl gap-5 p-4"
			>
				<QueryStatus query={preferences} onRetry={preferences.refetch}>
					{({ timeZone, weekStart }) => (
						<AnalyticsControls
							compact={compact}
							timeZone={timeZone}
							leading={sectionNav}
							weekStart={weekStart}
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
