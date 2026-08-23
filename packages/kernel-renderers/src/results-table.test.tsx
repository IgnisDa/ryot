import { afterEach, describe, expect, it } from "@effect/vitest";
import {
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/client-sdk/testing";
import { screen, waitFor } from "@testing-library/dom";
import { Effect } from "effect";

import { resultsDataSources, resultsSettings } from "./fixtures/saved-view";
import ResultsTablePage from "./results-table";

describe("results table", () => {
	afterEach(disposePluginBridges);

	it.live("titles the screen with the saved view and renders its declared columns", () =>
		Effect.gen(function* () {
			const page = mountPluginPage(ResultsTablePage, {
				location: routeLocation("/v/reading-log", ""),
				page: savedViewPageContext({
					savedViewId: "view-table",
					settings: resultsSettings,
					rendererName: "results-table",
					dataSources: resultsDataSources,
					view: { icon: "table", name: "Reading Log" },
				}),
			});

			const answered = new Set<string>();
			yield* Effect.promise(() =>
				waitFor(() => {
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
										items: [{ note: "Finished", entityId: "book-1", occurredAt: "2026-08-12" }],
									},
								},
							},
						});
					}
				}),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(page.container?.textContent).toContain("1 result")),
			);

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("heading", { level: 1, name: "Reading Log" })).toBeTruthy(),
				),
			);
			expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
				"Note",
				"Occurred",
			]);
			expect(page.container?.textContent).toContain("End of Reading Log");
		}),
	);
});
