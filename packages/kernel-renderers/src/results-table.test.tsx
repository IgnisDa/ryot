// @vitest-environment jsdom
import {
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/client-sdk/testing";
import { screen, waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import { resultsDataSources, resultsSettings } from "./fixtures/saved-view";
import ResultsTablePage from "./results-table";

describe("results table", () => {
	afterEach(disposePluginBridges);

	it("titles the screen with the saved view and renders its declared columns", async () => {
		const page = mountPluginPage(ResultsTablePage, {
			location: routeLocation("/v/reading-log", ""),
			page: savedViewPageContext({
				savedViewId: "view-table",
				settings: resultsSettings,
				rendererName: "results-table",
				dataSources: resultsDataSources,
				view: { name: "Reading Log", icon: "table" },
			}),
		});

		const answered = new Set<string>();
		await waitFor(() => {
			const pending = page
				.queryRequests("resultsTable")
				.filter(({ requestId }) => !answered.has(requestId));
			expect(pending.length).toBeGreaterThan(0);
			for (const request of pending) {
				answered.add(request.requestId);
				page.replyQuery(request.requestId, {
					outcome: "success",
					response: {
						data: {
							resultsTable: {
								type: "rows",
								pageInfo: { limit: 10, hasMore: false, nextCursor: null },
								items: [{ entityId: "book-1", note: "Finished", occurredAt: "2026-08-12" }],
							},
						},
					},
				});
			}
		});
		await waitFor(() => expect(page.container?.textContent).toContain("1 result"));

		await waitFor(() =>
			expect(screen.getByRole("heading", { level: 1, name: "Reading Log" })).toBeTruthy(),
		);
		expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
			"Note",
			"Occurred",
		]);
		expect(page.container?.textContent).toContain("End of Reading Log");
	});
});
