import { ShowOverview } from "./show-overview";
import { ShowStatusMessage } from "./show-primitives";
import { ShowSummaryHeader } from "./show-summary-header";
import {
	showSummaryError,
	showSummaryUnavailable,
	type ShowSummaryState,
} from "./show-summary-state";
import { ShowTabBar } from "./show-tabs";

export function ShowScreenContent(props: {
	readonly refresh: () => void;
	readonly state: ShowSummaryState;
	readonly managedUrls: ReadonlyMap<string, string>;
}) {
	const { state } = props;
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
			<ShowSummaryHeader show={state.show} managedUrls={props.managedUrls} />
			<ShowTabBar activeTab="overview" />
			<ShowOverview show={state.show} />
		</>
	);
}
