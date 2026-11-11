import { afterEach, describe, expect } from "bun:test";

import type { RowsResult } from "@ryot-app/contract/modules/ryotql/language";
import type { ClientPageContext } from "@ryot-app/plugin-client-contract";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { PluginId } from "@ryot-app/plugin-client-sdk/plugin";
import {
	disposePluginBridges,
	mountPluginPage,
	pluginContributor,
	routeLocation,
} from "@ryot-app/plugin-client-sdk/testing";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";
import { arrayContaining, objectContaining } from "@ryot-app/testing/matchers";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import CollectionRecommendationsPage from "./page";

afterEach(disposePluginBridges);

const pluginId = PluginId.make("media-owner");
const path = "/collections/col-1/recommendations";

const openPage = (search = "") =>
	mountPluginPage(CollectionRecommendationsPage, {
		location: routeLocation(path, search),
		page: {
			view: null,
			settings: {},
			dataSources: null,
			route: { params: { collectionId: "col-1" } },
			target: { path, search, kind: "plugin-route", packageId: PLUGIN_PACKAGE_ID },
			renderer: { pluginId, kind: "plugin", exportName: "media-collection-recommendations" },
			contributors: [pluginContributor({ pluginId, name: "Media", packageId: PLUGIN_PACKAGE_ID })],
		} satisfies ClientPageContext,
	});

type Page = ReturnType<typeof openPage>;

const rows = (items: RowsResult["items"], nextCursor: null | string = null): RowsResult => ({
	items,
	type: "rows",
	pageInfo: { limit: 30, nextCursor, hasMore: nextCursor !== null },
});

const recommendation = (id: string, overrides: RowsResult["items"][number] = {}) => ({
	id,
	images: null,
	suggestedBy: 1,
	name: `Title ${id}`,
	schemaSlug: "movie",
	isInMediaLibrary: false,
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
	relatedPopulationStatus: { state: "succeeded", availability: "complete" },
	...overrides,
});

const request = (page: Page, name: string, index = 0) =>
	Effect.promise(() =>
		waitFor(() => {
			const found = page.queryRequests(name)[index];
			if (found === undefined) {
				throw new Error(`${name} request ${index} was not issued`);
			}
			return found;
		}),
	);

const answerSources = (page: Page, sourceCount: null | number) =>
	Effect.gen(function* () {
		const sources = yield* request(page, "sources");
		page.replyQuery(sources.requestId, {
			outcome: "success",
			response: {
				data: {
					sources: { type: "aggregate", items: [{ count: sourceCount ?? 0 }] },
					collection: rows(sourceCount === null ? [] : [{ id: "col-1", name: "Shelf" }]),
				},
			},
		});
	});

const answerRecommendations = (
	page: Page,
	items: RowsResult["items"],
	input: { readonly index?: number; readonly nextCursor?: string } = {},
) =>
	Effect.gen(function* () {
		const found = yield* request(page, "recommendations", input.index);
		page.replyQuery(found.requestId, {
			outcome: "success",
			response: { data: { recommendations: rows(items, input.nextCursor ?? null) } },
		});
		return found;
	});

describe("collection recommendations page", () => {
	it.live(
		"shows ranked recommendations from the collection and loads further pages",
		() =>
			Effect.gen(function* () {
				const page = openPage();
				yield* answerSources(page, 3);
				yield* answerRecommendations(
					page,
					[
						recommendation("a", { suggestedBy: 2, schemaSlug: "video-game" }),
						recommendation("b", { isInMediaLibrary: true }),
					],
					{ nextCursor: "next" },
				);
				const first = yield* Effect.promise(() =>
					screen.findByRole("link", { name: "Open Title a" }),
				);
				expect(first.textContent).toContain("video game · Suggested by 2");
				expect(screen.getByRole("link", { name: "Open Title b" }).textContent).not.toContain(
					"Suggested by",
				);
				expect(screen.getByRole("img", { name: "In your library" })).toBeTruthy();
				expect(screen.getByText("Suggested by 3 titles in this collection")).toBeTruthy();
				expect(screen.getByRole("link", { name: "From Shelf" })).toBeTruthy();

				fireEvent.click(screen.getByRole("button", { name: "Load more" }));
				const next = yield* answerRecommendations(page, [recommendation("c")], { index: 1 });
				expect(bindTestRequest(next.request).queries["recommendations"]?.output).toMatchObject({
					pagination: { after: "next" },
				});
				yield* Effect.promise(() => screen.findByRole("link", { name: "Open Title c" }));
			}),
		testTimeout,
	);

	it.live(
		"explains a collection whose titles have no suggestions without querying candidates",
		() =>
			Effect.gen(function* () {
				const page = openPage();
				yield* answerSources(page, 0);
				yield* Effect.promise(() => screen.findByText("No suggestions yet"));
				expect(page.queryRequests("recommendations")).toHaveLength(0);
				expect(screen.queryByRole("search")).toBeNull();
			}),
		testTimeout,
	);

	it.live(
		"explains when every suggestion is already in the collection",
		() =>
			Effect.gen(function* () {
				const page = openPage();
				yield* answerSources(page, 2);
				yield* answerRecommendations(page, []);
				yield* Effect.promise(() => screen.findByText("Nothing new to recommend"));
			}),
		testTimeout,
	);

	it.live(
		"searches from the page address and clears an unmatched search",
		() =>
			Effect.gen(function* () {
				const page = openPage("search=dune");
				yield* answerSources(page, 2);
				const found = yield* answerRecommendations(page, []);
				expect(bindTestRequest(found.request).queries["recommendations"]?.where).toMatchObject({
					predicates: arrayContaining([
						objectContaining({ type: "contains", right: { value: "dune", type: "literal" } }),
					]),
				});
				yield* Effect.promise(() => screen.findByText("No recommendations match “dune”"));
				fireEvent.click(screen.getByText("Clear search", { selector: "button" }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(page.clientMessages()).toContainEqual<unknown>({
							mode: "replace",
							type: "page-search",
							update: { search: null },
						}),
					),
				);
			}),
		testTimeout,
	);

	it.live(
		"reports a missing collection",
		() =>
			Effect.gen(function* () {
				const page = openPage();
				yield* answerSources(page, null);
				yield* Effect.promise(() => screen.findByText("Collection unavailable"));
				expect(page.queryRequests("recommendations")).toHaveLength(0);
			}),
		testTimeout,
	);
});
