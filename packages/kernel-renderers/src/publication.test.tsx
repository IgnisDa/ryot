import { afterEach, describe, expect } from "bun:test";

import { PublicationId } from "@ryot-app/contract/schema/brands";
import { ClientPageContext, type PluginRyotQLOutcome } from "@ryot-app/plugin-client-contract";
import {
	disposePluginBridges,
	mountPluginPage,
	routeLocation,
} from "@ryot-app/plugin-client-sdk/testing";
import { castNumber, column, jsonPath, table } from "@ryot-app/ryotql";
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

const openPublication = (search = "") => {
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
			const { queries } = message.document;
			const reply = (
				data: Extract<PluginRyotQLOutcome, { readonly outcome: "success" }>["response"]["data"],
			) => page.replyQuery(message.requestId, { outcome: "success", response: { data } });
			const schemas = queries["schemas"];
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
			} else if (queries["entityBrowser"] !== undefined) {
				const where = JSON.stringify(queries["entityBrowser"].where ?? null);
				const requested = entities.filter(
					({ __entityBrowserId }) =>
						!where.includes('"type":"in"') || where.includes(__entityBrowserId),
				);
				reply({ entityBrowser: rowsResult(requested) });
			} else if (queries["entityBrowserCount"] !== undefined) {
				reply({
					entityBrowserCount: { pageInfo, type: "aggregate", items: [{ count: entities.length }] },
				});
			} else if (queries["item"] !== undefined) {
				reply({ item: rowsResult([{ pages: 320 }]) });
			} else if (queries["links"] !== undefined) {
				reply({
					links: rowsResult([{ targetEntityId: "entity-beta", sourceEntityId: "entity-alpha" }]),
				});
			}
		},
	});
	return page;
};

describe("publication renderer", () => {
	afterEach(disposePluginBridges);

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
