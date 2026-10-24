import { type AnalyticsSectionProps, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, StatusMessage, tabId, Tabs, useValueChange } from "@ryot-app/plugin-ui-sdk";
import { type ReactNode, useId, useMemo, useState } from "react";

import { MediaAnalyticsCharts } from "./charts";
import {
	analyticsCalendarInput,
	type AnalyticsInput,
	analyticsInput,
	type MediaConsumptionReport,
	periodCaption,
	type RankingsRecordsProps,
	type RecordsDrillRequest,
	type Reported,
	type SummaryChartsProps,
} from "./model";
import { mediaAnalyticsReportQuery, mediaAnalyticsStatsQuery } from "./queries";
import { MediaAnalyticsRankings } from "./rankings";
import { MediaAnalyticsRecords } from "./records";
import { MediaAnalyticsSummary } from "./summary";

type AnalyticsTab = "charts" | "rankings";

export default function MediaAnalyticsSection(props: AnalyticsSectionProps) {
	const { compact } = useRyotViewport();
	const { timeZone, selection } = props;
	const ownerKey = props.owner.pluginId;
	const input = useMemo(
		() => analyticsInput({ timeZone, selection, owner: { kind: "local", pluginId: ownerKey } }),
		[ownerKey, selection, timeZone],
	);
	const report = useRyotQuery(mediaAnalyticsReportQuery, input);
	const [tabState, setTabState] = useState<{
		readonly ownerId: string;
		readonly value: AnalyticsTab;
	}>({ value: "charts", ownerId: ownerKey });
	useValueChange(ownerKey, (ownerId) => setTabState({ ownerId, value: "charts" }));

	if (report.data === undefined) {
		return report.isError ? (
			<StatusMessage tone="error" action={{ label: "Retry report", onClick: report.refetch }}>
				Media analytics could not be loaded.
			</StatusMessage>
		) : (
			<StatusMessage tone="pending">Loading media analytics…</StatusMessage>
		);
	}

	const tab = tabState.ownerId === ownerKey ? tabState.value : "charts";
	let readinessNotice: ReactNode = null;
	if (report.data.processing === "pending") {
		readinessNotice = (
			<StatusMessage tone="pending">
				Media history repair is pending. These analytics are not final.
			</StatusMessage>
		);
	} else if (report.data.processing === "failed") {
		readinessNotice = (
			<StatusMessage tone="error">
				Media history repair failed. These analytics may be incomplete.
			</StatusMessage>
		);
	}
	return (
		<div className={compact ? "grid min-w-0 gap-4" : "grid min-w-0 gap-6"}>
			{report.isError ? (
				<StatusMessage tone="error" action={{ label: "Retry report", onClick: report.refetch }}>
					Media analytics could not be refreshed. The last loaded report is still shown.
				</StatusMessage>
			) : null}
			{readinessNotice}
			<MediaAnalyticsContent
				tab={tab}
				input={input}
				key={ownerKey}
				compact={compact}
				ownerKey={ownerKey}
				report={report.data}
				onTabChange={(value) => setTabState({ value, ownerId: ownerKey })}
			/>
		</div>
	);
}

function MediaAnalyticsContent(props: {
	readonly compact: boolean;
	readonly ownerKey: string;
	readonly tab: AnalyticsTab;
	readonly input: AnalyticsInput;
	readonly report: Reported<MediaConsumptionReport>;
	readonly onTabChange: (value: AnalyticsTab) => void;
}) {
	const [request, setRequest] = useState<null | RecordsDrillRequest>(null);
	const panelId = useId();
	const scopeKey = JSON.stringify({
		owner: props.ownerKey,
		timeZone: props.input.timeZone,
		selection: props.input.selection,
	});
	useValueChange(scopeKey, () => setRequest(null));

	const statsInput = useMemo(
		() => analyticsCalendarInput(props.input, props.report.reporting),
		[props.input, props.report.reporting],
	);
	const stats = useRyotQuery(mediaAnalyticsStatsQuery, statsInput);
	useValueChange(props.report.processing, (processing) => {
		if (processing === "ready") {
			stats.refetch();
		}
	});

	const summaryChartsProps: SummaryChartsProps = {
		input: props.input,
		report: props.report,
		...(stats.data === undefined ? {} : { stats: stats.data }),
		onDrill: setRequest,
	};
	const rankingsProps: RankingsRecordsProps = {
		input: props.input,
		onDrill: setRequest,
		report: props.report,
	};
	const openAllRecords = () =>
		setRequest({
			title: "All contributing records",
			selection: props.report.reporting.selection,
			periodCaption: periodCaption(props.report.reporting.resolved.current),
		});
	let statsNotice: ReactNode = null;
	if (stats.data === undefined) {
		statsNotice = stats.isError ? (
			<StatusMessage tone="error" action={{ onClick: stats.refetch, label: "Retry breakdowns" }}>
				Media analytics breakdowns could not be loaded.
			</StatusMessage>
		) : (
			<StatusMessage tone="pending">Loading media analytics breakdowns…</StatusMessage>
		);
	} else if (stats.isError) {
		statsNotice = (
			<StatusMessage tone="error" action={{ onClick: stats.refetch, label: "Retry breakdowns" }}>
				Media analytics breakdowns could not be refreshed. The last loaded breakdowns are still
				shown.
			</StatusMessage>
		);
	}

	return (
		<div className={props.compact ? "grid min-w-0 gap-4" : "grid min-w-0 gap-6"}>
			{statsNotice}
			<MediaAnalyticsSummary {...summaryChartsProps} />
			<div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
				<Tabs
					value={props.tab}
					panelId={panelId}
					label="Media analytics"
					onChange={props.onTabChange}
					options={[
						{ value: "charts", label: "Charts" },
						{ value: "rankings", label: "Rankings" },
					]}
				/>
				<Button variant="link" onClick={openAllRecords}>
					View contributing records
				</Button>
			</div>
			<div id={panelId} role="tabpanel" aria-labelledby={tabId(panelId, props.tab)}>
				{props.tab === "charts" ? (
					<MediaAnalyticsCharts {...summaryChartsProps} />
				) : (
					<MediaAnalyticsRankings {...rankingsProps} />
				)}
			</div>
			{request === null ? null : (
				<MediaAnalyticsRecords
					request={request}
					input={props.input}
					report={props.report}
					onClose={() => setRequest(null)}
				/>
			)}
		</div>
	);
}
