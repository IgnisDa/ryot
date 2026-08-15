import { useTrackPageViews } from "./state";

export function AnalyticsController() {
	useTrackPageViews();

	return null;
}
