import { Match } from "effect";
import { type ReactNode, useState } from "react";

import { ShowOverview } from "./show-overview";
import type { ShowOverviewState } from "./show-overview-state";
import { ShowStatusMessage } from "./show-primitives";
import { ShowSummaryHeader } from "./show-summary-header";
import {
	showSummaryError,
	showSummaryUnavailable,
	type ShowSummaryState,
} from "./show-summary-state";
import { ShowTabBar, type ShowTabKey } from "./show-tabs";

export function ShowScreenContent(props: {
	readonly refresh: () => void;
	readonly episodes: ReactNode;
	readonly activity: ReactNode;
	readonly state: ShowSummaryState;
	readonly refreshOverview: () => void;
	readonly overview: ShowOverviewState;
}) {
	const { state } = props;
	const [activeTab, setActiveTab] = useState<ShowTabKey>("overview");
	if (state.status === "loading") {
		return (
			<ShowStatusMessage
				title="Loading show..."
				detail="Fetching the latest details for this show."
			/>
		);
	}
	if (state.status === "transport-error" || state.status === "malformed") {
		return <ShowStatusMessage {...showSummaryError(state)} onRetry={props.refresh} />;
	}
	if (state.status === "unavailable") {
		return <ShowStatusMessage {...showSummaryUnavailable(state.reason)} />;
	}
	return (
		<>
			<ShowSummaryHeader show={state.show} />
			<ShowTabBar activeTab={activeTab} onSelect={setActiveTab} />
			{Match.value(activeTab).pipe(
				Match.when("episodes", () => props.episodes),
				Match.when("activity", () => props.activity),
				Match.when("overview", () => (
					<ShowOverview
						show={state.show}
						overview={props.overview}
						refreshOverview={props.refreshOverview}
					/>
				)),
				Match.exhaustive,
			)}
		</>
	);
}
