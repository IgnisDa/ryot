import {
	parseReportingSearch,
	reportingSearchParams,
	type ReportingSelection,
} from "@ryot-app/contract/modules/analytics/reporting";
import { stableStringify } from "@ryot-app/ts-utils/json";

export const analyticsSection = (pluginId: string, slug: string) => `${pluginId}/${slug}`;

export const analyticsSearch = (
	selection: ReportingSelection,
	extra: Readonly<Record<string, string>> = {},
) => {
	const search = new URLSearchParams(extra);
	for (const [key, value] of Object.entries(reportingSearchParams(selection))) {
		if (value !== null) {
			search.set(key, value);
		}
	}
	return search;
};

export const hasAnalyticsSelection = (url: URL, selection: ReportingSelection) =>
	url.pathname === "/v/k/analytics" &&
	stableStringify(parseReportingSearch(url.search)) === stableStringify(selection);

export const hasAnalyticsLocation = (url: URL, selection: ReportingSelection, section: string) =>
	hasAnalyticsSelection(url, selection) && url.searchParams.get("section") === section;
