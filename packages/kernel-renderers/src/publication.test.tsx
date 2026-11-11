import { afterEach, describe, expect } from "bun:test";

import type { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import { PublicationId } from "@ryot-app/contract/schema/brands";
import { ClientPageContext } from "@ryot-app/plugin-client-contract";
import {
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
} from "@ryot-app/plugin-client-sdk/testing";
import { castNumber, column, jsonPath, table } from "@ryot-app/ryotql";
import { encodeFilterParam } from "@ryot-app/ryotql-recipes/filters";
import { requireInlineDocument } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { browserRow } from "./fixtures/saved-view";
import PublicationPage from "./publication";

const subject = table("entity", "subject");
const pageInfo = { limit: 100, hasMore: false, nextCursor: null };
const rowsResult = (items: readonly Record<string, unknown>[]) => ({
	items,
	pageInfo,
	type: "rows" as const,
});

const browse = {
	slug: "item",
	pluginId: "fixture",
	browse: {
		fields: [
			{
				key: "pages",
				kind: "value",
				type: "number",
				label: "Pages",
				expression: castNumber(jsonPath(column(subject, "properties"), "pages")),
			},
		],
	},
};

const entities = [browserRow("entity-alpha", "Alpha"), browserRow("entity-beta", "Beta")];

const openPublication = (
	search = "",
	options: { readonly hasMore?: boolean; readonly manualControls?: boolean } = {},
) => {
	const page: ReturnType<typeof mountPluginPage> = mountPluginPage(PublicationPage, {
		location: routeLocation("/", search),
		page: ClientPageContext.make({
			contributors: [],
			dataSources: null,
			route: { params: {} },
			view: { icon: "book", name: "Reading list" },
			renderer: { kind: "kernel", name: "Publication" },
			settings: { itemCount: 2, ownerName: "Ada", description: "Books I loved" },
			target: { kind: "publication", publicationId: PublicationId.make("publication-1") },
		}),
		onClientMessage: (message) => {
			if (message.type !== "ryotql-request") {
				return;
			}
			if (message.action === "describe") {
				if (options.manualControls) {
					return;
				}
				page.replyQuery(message.requestId, {
					outcome: "success",
					response: { sort: [], filter: [], parameters: { fields: {} } },
				});
				return;
			}
			const { queries } = requireInlineDocument(message.request);
			const selected = message.request.source.query;
			const selectedQueries = Object.fromEntries(
				Object.entries(queries).filter(([name]) => selected === undefined || selected === name),
			);
			const reply = (data: RyotQLResponse["data"]) =>
				page.replyQuery(message.requestId, { outcome: "success", response: { data } });
			const schemas = selectedQueries["schemas"];
			if (schemas?.output.type === "aggregate") {
				reply({
					schemas: {
						pageInfo,
						type: "aggregate",
						items: [{ count: 2, slug: "item", pluginId: "fixture" }],
					},
				});
			} else if (schemas !== undefined) {
				reply({ schemas: rowsResult([browse]) });
			} else if (selectedQueries["source"] !== undefined) {
				const ids = message.request.arguments?.["ids"];
				const requested = entities.filter(
					({ __entityBrowserId }) => !Array.isArray(ids) || ids.includes(__entityBrowserId),
				);
				reply({
					source: {
						...rowsResult(requested),
						pageInfo: {
							...pageInfo,
							hasMore: options.hasMore ?? false,
							nextCursor: options.hasMore ? "next" : null,
						},
					},
				});
			} else if (selectedQueries["count"] !== undefined) {
				reply({ count: { pageInfo, type: "aggregate", items: [{ count: entities.length }] } });
			} else if (selectedQueries["item"] !== undefined) {
				reply({ item: rowsResult([{ pages: 320 }]) });
			} else if (selectedQueries["links"] !== undefined) {
				reply({ links: rowsResult([{ entityId: "entity-beta" }]) });
			}
		},
	});
	return page;
};

describe("publication renderer", () => {
	afterEach(disposePluginBridges);

	it.live(
		"retains URL controls while metadata is pending or failed and retries the filtered count with its full source",
		() =>
			Effect.gen(function* () {
				const filter = { value: 300, field: "pages", operator: "gte" } as const;
				const search = `sort=name-desc&filters=${encodeFilterParam(filter)}`;
				const page = openPublication(search, { hasMore: true, manualControls: true });
				const descriptions = () =>
					page
						.clientMessages()
						.filter(
							(message) => message.type === "ryotql-request" && message.action === "describe",
						);
				yield* Effect.promise(() => waitFor(() => expect(descriptions()).toHaveLength(1)));
				expect(screen.getByText("Loading publication...")).toBeTruthy();
				expect(page.queryRequests("source")).toHaveLength(0);
				expect(
					page.clientMessages().filter((message) => message.type === "page-search"),
				).toHaveLength(0);
				const first = descriptions()[0];
				if (first === undefined) {
					throw new Error("Missing metadata request");
				}
				page.replyQuery(first.requestId, { outcome: "failure", reason: "query-failed" });
				yield* Effect.promise(() =>
					screen.findByText("The publication controls could not be loaded."),
				);
				expect(page.queryRequests("source")).toHaveLength(0);
				fireEvent.click(screen.getByRole("button", { name: "Try again" }));
				yield* Effect.promise(() => waitFor(() => expect(descriptions()).toHaveLength(2)));
				const retry = descriptions()[1];
				if (retry === undefined) {
					throw new Error("Missing metadata retry");
				}
				page.replyQuery(retry.requestId, {
					outcome: "success",
					response: {
						parameters: { fields: {} },
						filter: [
							{ key: "pages", kind: "value", type: "number", field: "pages", label: "Pages" },
						],
						sort: [
							{
								key: "name",
								label: "Name",
								ascending: "A–Z",
								descending: "Z–A",
								defaultDirection: "asc",
							},
						],
					},
				});
				yield* Effect.promise(() => screen.findByRole("button", { name: "Count all" }));
				expect(page.queryRequests("source")[0]?.request).toMatchObject({
					filter,
					sort: "name-desc",
					source: { kind: "inline", query: "source" },
				});
				fireEvent.click(screen.getByRole("button", { name: "Count all" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("count")).toHaveLength(1)),
				);
				const count = page.queryRequests("count")[0];
				if (count === undefined) {
					throw new Error("Missing count request");
				}
				expect(count.request).toMatchObject({ filter, source: { kind: "inline", query: "count" } });
				const document = requireInlineDocument(count.request);
				expect(document.queries["source"]).toBeDefined();
				expect(document.queries["count"]).toBeDefined();
				expect(document.controls?.filter).toMatchObject({
					kind: "browse",
					alias: "subject",
					schemas: [{ slug: "item", owner: { kind: "local", pluginId: "fixture" } }],
				});
				yield* Effect.promise(() => screen.findByText("2 of 2 results"));
			}),
		testTimeout,
	);

	it.live(
		"opens an item independently of pending browser control metadata",
		() =>
			Effect.gen(function* () {
				const page = openPublication("item=entity-alpha", { manualControls: true });
				yield* Effect.promise(() => screen.findByRole("heading", { level: 1, name: "Alpha" }));
				expect(screen.queryByText("Loading publication...")).toBeNull();
				expect(page.queryRequests("count")).toHaveLength(0);
			}),
		testTimeout,
	);

	it.live(
		"introduces the published items with the owner's description and name without selection",
		() =>
			Effect.gen(function* () {
				openPublication();
				yield* Effect.promise(() => screen.findByText("Books I loved"));
				expect(screen.getByText("Ada")).toBeTruthy();
				expect(screen.getByText("2 items")).toBeTruthy();
				yield* Effect.promise(() => screen.findByText("Beta"));
				expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
			}),
		testTimeout,
	);

	it.live(
		"shows a published item with its values and the published items linked to it",
		() =>
			Effect.gen(function* () {
				const page = openPublication("item=entity-alpha");
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("heading", { level: 1, name: "Alpha" })).toBeTruthy(),
					),
				);
				yield* Effect.promise(() => screen.findByText("320"));
				expect(screen.getByText("Pages")).toBeTruthy();
				const related = yield* Effect.promise(() =>
					screen.findByRole("region", { name: "Related" }),
				);
				yield* Effect.promise(() => waitFor(() => expect(related.textContent).toContain("Beta")));
				fireEvent.click(screen.getByRole("button", { name: "All items" }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(page.clientMessages()).toContainEqual<unknown>({ type: "navigate-back" }),
					),
				);
			}),
		testTimeout,
	);
});
