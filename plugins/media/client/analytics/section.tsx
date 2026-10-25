import {
	type AnalyticsSectionProps,
	periodCaption,
	type Reported,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	QueryStatus,
	StatusMessage,
	tabId,
	Tabs,
	useValueChange,
} from "@ryot-app/plugin-ui-sdk";
import { useId, useMemo, useState } from "react";

import { MediaAnalyticsCharts } from "./charts";
import {
	analyticsCalendarInput,
	type AnalyticsInput,
	analyticsInput,
	type MediaConsumptionReport,
	type RankingsRecordsProps,
	type RecordsDrillRequest,
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
	const [tab, setTab] = useState<AnalyticsTab>("charts");
	return (
		<QueryStatus query={report} label="media analytics" onRetry={report.refetch}>
			{(data) => (
				<div className={compact ? "grid min-w-0 gap-4" : "grid min-w-0 gap-6"}>
					<ReadinessNotice processing={data.processing} />
					<MediaAnalyticsContent
						tab={tab}
						input={input}
						report={data}
						compact={compact}
						onTabChange={setTab}
					/>
				</div>
			)}
		</QueryStatus>
	);
}

function ReadinessNotice(props: { readonly processing: MediaConsumptionReport["processing"] }) {
	if (props.processing === "pending") {
		return (
			<StatusMessage tone="pending">
				Media history repair is pending. These analytics are not final.
			</StatusMessage>
		);
	}
	return props.processing === "failed" ? (
		<StatusMessage tone="error">
			Media history repair failed. These analytics may be incomplete.
		</StatusMessage>
	) : null;
}

function MediaAnalyticsContent(props: {
	readonly compact: boolean;
	readonly tab: AnalyticsTab;
	readonly input: AnalyticsInput;
	readonly report: Reported<MediaConsumptionReport>;
	readonly onTabChange: (value: AnalyticsTab) => void;
}) {
	const [request, setRequest] = useState<null | RecordsDrillRequest>(null);
	const panelId = useId();
	const scopeKey = JSON.stringify({
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
	return (
		<div className={props.compact ? "grid min-w-0 gap-4" : "grid min-w-0 gap-6"}>
			<QueryStatus query={stats} onRetry={stats.refetch} label="media analytics breakdowns" />
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
