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
import { kernelPublicationPage } from "@ryot-app/ryotql-recipes/publication-browse";
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
	presentationFields: [],
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
} as const;

const recipe = kernelPublicationPage({ schemas: [browse] });

const entities = [browserRow("entity-alpha", "Alpha"), browserRow("entity-beta", "Beta")];

const openPublication = (
	search = "",
	options: {
		readonly hasMore?: boolean;
		readonly missingItem?: boolean;
		readonly manualControls?: boolean;
		readonly mode?: "live" | "snapshot";
	} = {},
) => {
	const page: ReturnType<typeof mountPluginPage> = mountPluginPage(PublicationPage, {
		location: routeLocation("/", search),
		page: ClientPageContext.make({
			contributors: [],
			dataSources: null,
			route: { params: {} },
			view: { icon: "book", name: "Reading list" },
			renderer: { kind: "kernel", name: "Publication" },
			target: { kind: "publication", publicationId: PublicationId.make("publication-1") },
			settings: {
				itemCount: 2,
				ownerName: "Ada",
				browser: recipe.settings,
				mode: options.mode ?? "live",
				description: "Books I loved",
				itemDetails: recipe.itemDetails,
			},
		}),
		onClientMessage: (message) => {
			if (message.type !== "ryotql-request") {
				return;
			}
			if (message.action === "page-describe") {
				if (options.manualControls) {
					return;
				}
				page.replyQuery(message.requestId, {
					outcome: "success",
					response: { sort: [], filter: [], parameters: { fields: {} } },
				});
				return;
			}
			if (message.action !== "page-execute") {
				throw new Error("Publication sent a non-page execution");
			}
			const selected = message.request.query;
			const reply = (data: RyotQLResponse["data"]) =>
				page.replyQuery(message.requestId, { outcome: "success", response: { data } });
			if (selected === "items") {
				reply({
					items: {
						...rowsResult(entities),
						pageInfo: {
							...pageInfo,
							hasMore: options.hasMore ?? false,
							nextCursor: options.hasMore ? "next" : null,
						},
					},
				});
			} else if (selected === "count") {
				reply({ count: { pageInfo, type: "aggregate", items: [{ count: entities.length }] } });
			} else if (selected === "item") {
				reply({
					item: rowsResult(
						options.missingItem
							? []
							: [{ ...entities[0], [recipe.itemDetails[0]?.field ?? "missing"]: 320 }],
					),
				});
			} else if (selected === "linked") {
				reply({ linked: rowsResult([entities[1] ?? {}]) });
			} else {
				throw new Error(`Unexpected publication query ${selected}`);
			}
		},
	});
	return {
		...page,
		queryRequests: (name: string) =>
			page
				.clientMessages()
				.filter(
					(message) =>
						message.type === "ryotql-request" &&
						message.action === "page-execute" &&
						message.request.query === name,
				),
	};
};

describe("publication renderer", () => {
	afterEach(disposePluginBridges);

	it.live(
		"retains URL controls while metadata is pending or failed and retries the filtered count by name",
		() =>
			Effect.gen(function* () {
				const filter = { value: 300, field: "pages", operator: "gte" } as const;
				const search = `sort=name-desc&filters=${encodeFilterParam(filter)}`;
				const page = openPublication(search, { hasMore: true, manualControls: true });
				const descriptions = () =>
					page
						.clientMessages()
						.filter(
							(message) => message.type === "ryotql-request" && message.action === "page-describe",
						);
				yield* Effect.promise(() => waitFor(() => expect(descriptions()).toHaveLength(1)));
				expect(screen.getByText("Loading publication...")).toBeTruthy();
				expect(page.queryRequests("items")).toHaveLength(0);
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
				expect(page.queryRequests("items")).toHaveLength(0);
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
				expect(page.queryRequests("items")[0]).toMatchObject({
					request: { filter, query: "items", sort: "name-desc" },
				});
				fireEvent.click(screen.getByRole("button", { name: "Count all" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("count")).toHaveLength(1)),
				);
				const count = page.queryRequests("count")[0];
				if (count?.type !== "ryotql-request" || count.action !== "page-execute") {
					throw new Error("Missing count request");
				}
				expect(count.request).toMatchObject({ filter, query: "count" });
				expect(count.request).not.toHaveProperty("source");
				yield* Effect.promise(() => screen.findByText("2 of 2 results"));
			}),
		testTimeout,
	);

	it.live(
		"continues live results through the named items query",
		() =>
			Effect.gen(function* () {
				const page = openPublication("search=Alpha", { hasMore: true });
				const more = yield* Effect.promise(() =>
					screen.findByRole("button", { name: /Load more/ }),
				);
				fireEvent.click(more);
				yield* Effect.promise(() =>
					waitFor(() => expect(page.queryRequests("items")).toHaveLength(2)),
				);
				expect(page.queryRequests("items")[1]).toMatchObject({
					action: "page-execute",
					request: {
						query: "items",
						arguments: { search: "Alpha" },
						pages: { items: { limit: 24, after: "next" } },
					},
				});
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
				expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
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
	it.live(
		"shows only the captured first page without server-dependent controls or links",
		() =>
			Effect.gen(function* () {
				const page = openPublication(
					"item=entity-alpha&search=ignored&sort=name-desc&filters=ignored",
					{ hasMore: true, mode: "snapshot" },
				);
				yield* Effect.promise(() => screen.findByText("Beta"));
				expect(
					screen.getByText(
						"This snapshot shows only the first page captured when it was published.",
					),
				).toBeTruthy();
				expect(screen.queryByRole("searchbox")).toBeNull();
				expect(screen.queryByRole("button", { name: "Filters" })).toBeNull();
				expect(screen.queryByRole("button", { name: /Load more/ })).toBeNull();
				expect(screen.queryByRole("link")).toBeNull();
				expect(
					page.clientMessages().filter((message) => message.type === "ryotql-request"),
				).toMatchObject([{ action: "page-execute", request: { query: "items" } }]);
				const request = page.queryRequests("items")[0];
				if (request?.type !== "ryotql-request" || request.action !== "page-execute") {
					throw new Error("Missing snapshot request");
				}
				expect(request.request).toEqual({ query: "items" });
			}),
		testTimeout,
	);
	it.live(
		"does not read linked items or fallback entities when the selected item is outside the source",
		() =>
			Effect.gen(function* () {
				const page = openPublication("item=other", { missingItem: true });
				yield* Effect.promise(() => screen.findByText("This item is not part of this page."));
				expect(page.queryRequests("linked")).toHaveLength(0);
				expect(
					page.clientMessages().filter((message) => message.type === "ryotql-request"),
				).toMatchObject([
					{ action: "page-execute", request: { query: "item", arguments: { entityId: "other" } } },
				]);
			}),
		testTimeout,
	);
});
