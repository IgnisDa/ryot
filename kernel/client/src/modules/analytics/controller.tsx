import { useIdentifyUser, useTrackPageViews } from "./state";

export function AnalyticsController() {
	useIdentifyUser();
	useTrackPageViews();

	return null;
}
