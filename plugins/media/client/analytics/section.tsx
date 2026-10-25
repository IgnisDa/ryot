import {
	type AnalyticsSectionProps,
	periodCaption,
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
	type AnalyticsInput,
	analyticsInput,
	type MediaAnalyticsProcessing,
	type RecordsDrillRequest,
	type SummaryChartsProps,
} from "./model";
import { mediaAnalyticsSummaryQuery } from "./queries";
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
	const summary = useRyotQuery(mediaAnalyticsSummaryQuery, input);
	const [tab, setTab] = useState<AnalyticsTab>("charts");
	return (
		<QueryStatus query={summary} label="media analytics" onRetry={summary.refetch}>
			{(data) => (
				<div className={compact ? "grid min-w-0 gap-4" : "grid min-w-0 gap-6"}>
					<ReadinessNotice processing={data.processing} />
					<MediaAnalyticsContent
						tab={tab}
						input={input}
						summary={data}
						compact={compact}
						onTabChange={setTab}
					/>
				</div>
			)}
		</QueryStatus>
	);
}

function ReadinessNotice(props: { readonly processing: MediaAnalyticsProcessing }) {
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
	readonly summary: SummaryChartsProps["summary"];
	readonly onTabChange: (value: AnalyticsTab) => void;
}) {
	const [request, setRequest] = useState<null | RecordsDrillRequest>(null);
	const panelId = useId();
	const scopeKey = JSON.stringify({
		timeZone: props.input.timeZone,
		selection: props.input.selection,
	});
	useValueChange(scopeKey, () => setRequest(null));
	const childProps: SummaryChartsProps = {
		input: props.input,
		onDrill: setRequest,
		summary: props.summary,
	};
	const openAllRecords = () =>
		setRequest({
			title: "All contributing records",
			selection: props.summary.reporting.selection,
			periodCaption: periodCaption(props.summary.reporting.resolved.current),
		});
	return (
		<div className={props.compact ? "grid min-w-0 gap-4" : "grid min-w-0 gap-6"}>
			<MediaAnalyticsSummary {...childProps} />
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
					<MediaAnalyticsCharts {...childProps} />
				) : (
					<MediaAnalyticsRankings {...childProps} />
				)}
			</div>
			{request === null ? null : (
				<MediaAnalyticsRecords
					request={request}
					input={props.input}
					summary={props.summary}
					onClose={() => setRequest(null)}
				/>
			)}
		</div>
	);
}
