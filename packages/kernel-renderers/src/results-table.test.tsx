import { afterEach, describe, expect, it } from "@effect/vitest";
import {
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { Effect, Schema } from "effect";

import { resultsDataSources, resultsSettings } from "./fixtures/saved-view";
import ResultsTablePage from "./results-table";

const filteredSettings = {
	...resultsSettings,
	filterFields: [{ key: "note", type: "text", label: "Note", field: "note", kind: "value" }],
};

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const noteRule = { value: "Fin", field: "note", operator: "contains" };

const mountFiltered = (search = "") =>
	mountPluginPage(ResultsTablePage, {
		location: routeLocation("/v/reading-log", search),
		page: savedViewPageContext({
			savedViewId: "view-table",
			settings: filteredSettings,
			rendererName: "results-table",
			dataSources: resultsDataSources,
			view: { icon: "table", name: "Reading Log" },
		}),
	});

const filtersUpdates = (page: ReturnType<typeof mountPluginPage>) =>
	page
		.clientMessages()
		.flatMap((message) => (message.type === "page-search" ? [message] : []))
		.map(({ update }) => update["filters"]);

const answerRows = (
	page: ReturnType<typeof mountPluginPage>,
	requestId: string,
	items: readonly { readonly note: string }[],
) =>
	page.replyQuery(requestId, {
		outcome: "success",
		response: {
			data: {
				resultsTable: {
					type: "rows",
					pageInfo: { limit: 10, hasMore: false, nextCursor: null },
					items: items.map(({ note }) => ({ note, entityId: "book-1", occurredAt: "2026-08-12" })),
				},
			},
		},
	});

const nextRequest = (page: ReturnType<typeof mountPluginPage>, count: number) =>
	Effect.promise(() =>
		waitFor(() => {
			const requests = page.queryRequests("resultsTable");
			expect(requests).toHaveLength(count);
			const request = requests[count - 1];
			if (request === undefined) {
				throw new Error("Missing request");
			}
			return request;
		}),
	);

describe("results table", () => {
	afterEach(disposePluginBridges);

	it.live("applies a rule to the URL and the next query, then clears it from its chip", () =>
		Effect.gen(function* () {
			const page = mountFiltered();
			answerRows(page, (yield* nextRequest(page, 1)).requestId, [{ note: "Finished" }]);
			yield* Effect.promise(() =>
				waitFor(() => screen.getByRole("button", { name: "Filters, 0 active filters" })),
			);
			fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
			yield* Effect.promise(() => waitFor(() => screen.getByRole("dialog", { name: "Filters" })));
			fireEvent.click(screen.getByRole("button", { name: /^Add filter/ }));
			fireEvent.click(
				yield* Effect.promise(() => waitFor(() => screen.getByRole("radio", { name: "Note" }))),
			);
			fireEvent.change(
				yield* Effect.promise(() =>
					waitFor(() => screen.getByRole("textbox", { name: "Note value" })),
				),
				{ target: { value: "Fin" } },
			);
			yield* Effect.promise(() =>
				waitFor(() => {
					const encoded = filtersUpdates(page).at(-1);
					expect(typeof encoded).toBe("string");
					expect(decodeJson(Buffer.from(String(encoded), "base64url").toString("utf8"))).toEqual(
						noteRule,
					);
				}),
			);

			page.navigate(
				routeLocation(
					"/v/reading-log",
					`filters=${Buffer.from(encodeJson(noteRule)).toString("base64url")}`,
				),
			);
			const filtered = yield* nextRequest(page, 2);
			expect(encodeJson(filtered.document)).toContain("Fin");
			answerRows(page, filtered.requestId, [{ note: "Finished" }]);
			yield* Effect.promise(() =>
				waitFor(() => screen.getByRole("button", { name: "Filters, 1 active filter" })),
			);
			fireEvent.click(screen.getByRole("button", { name: "Close filters" }));
			expect(screen.getByRole("group", { name: "Active filters" }).textContent).toContain(
				"Note contains Fin",
			);

			fireEvent.click(screen.getByRole("button", { name: "Remove Note filter" }));
			yield* Effect.promise(() => waitFor(() => expect(filtersUpdates(page).at(-1)).toBeNull()));
		}),
	);

	it.live("offers Clear filters when the filter matches nothing", () =>
		Effect.gen(function* () {
			const page = mountFiltered(
				`filters=${Buffer.from(encodeJson(noteRule)).toString("base64url")}`,
			);
			answerRows(page, (yield* nextRequest(page, 1)).requestId, []);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(screen.getByRole("heading", { name: "No matches in Reading Log" })).toBeTruthy(),
				),
			);
			fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
			yield* Effect.promise(() => waitFor(() => expect(filtersUpdates(page).at(-1)).toBeNull()));
		}),
	);

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
