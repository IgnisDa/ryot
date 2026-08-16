import type { SearchProviderEntitiesResponse } from "@ryot-app/contract/modules/provider-entities/schemas";
import { EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { describe, expect, it } from "vitest";

import {
	buildSearchPayload,
	createProviderSearchState,
	hasMoreProviderSearchResults,
	type ProviderSearchEvent,
	type ProviderSearchState,
	providerSearchReducer,
} from "./search-controller";

const providerId = SandboxProviderId.make("provider-1");

const response = (
	externalIds: readonly string[],
	nextPage: number | null | undefined,
): SearchProviderEntitiesResponse => ({
	providerId,
	providerName: "Provider",
	rootEntitySchemaSlug: EntitySchemaSlug.make("book"),
	details: nextPage === undefined ? undefined : { totalItems: 42, nextPage },
	items: externalIds.map((externalId) => ({ externalId, title: externalId })),
});

const reduce = (state: ProviderSearchState, ...events: readonly ProviderSearchEvent[]) =>
	events.reduce(providerSearchReducer, state);

const searched = (query: string) =>
	reduce(
		createProviderSearchState(),
		{ type: "query-changed", query },
		{ type: "search-requested" },
	);

describe("provider search controller", () => {
	it("initializes with an optional query and preserves normal query replacement", () => {
		expect(createProviderSearchState().query).toBe("");

		const initial = createProviderSearchState("dune");
		expect(initial.query).toBe("dune");

		const cleared = providerSearchReducer(initial, { type: "query-changed", query: "" });
		expect(cleared.query).toBe("");
		expect(cleared.items).toEqual([]);

		const replaced = providerSearchReducer(cleared, {
			query: "foundation",
			type: "query-changed",
		});
		expect(replaced.query).toBe("foundation");
		expect(replaced.items).toEqual([]);
	});

	it("replaces items on a fresh search and appends on the next page", () => {
		const first = searched("dune");
		expect(first.status).toBe("loading");

		const loaded = providerSearchReducer(first, {
			type: "response-received",
			token: first.operation?.token ?? -1,
			response: response(["a", "b"], 2),
		});
		expect(loaded.status).toBe("ready");
		expect(loaded.items.map((item) => item.externalId)).toEqual(["a", "b"]);
		expect(hasMoreProviderSearchResults(loaded)).toBe(true);

		const loadingMore = providerSearchReducer(loaded, { type: "next-page-requested" });
		expect(loadingMore.status).toBe("loading-more");
		expect(loadingMore.operation?.page).toBe(2);

		const appended = providerSearchReducer(loadingMore, {
			type: "response-received",
			token: loadingMore.operation?.token ?? -1,
			response: response(["c"], null),
		});
		expect(appended.items.map((item) => item.externalId)).toEqual(["a", "b", "c"]);
		expect(hasMoreProviderSearchResults(appended)).toBe(false);

		const restarted = providerSearchReducer(appended, { type: "search-requested" });
		const replaced = providerSearchReducer(restarted, {
			type: "response-received",
			token: restarted.operation?.token ?? -1,
			response: response(["z"], null),
		});
		expect(replaced.items.map((item) => item.externalId)).toEqual(["z"]);
	});

	it("drops a response whose operation token is no longer current", () => {
		const loading = searched("dune");
		const stale = loading.operation?.token ?? -1;
		const restarted = providerSearchReducer(loading, { type: "search-requested" });

		expect(restarted.operation?.token).not.toBe(stale);
		expect(
			providerSearchReducer(restarted, {
				token: stale,
				type: "response-received",
				response: response(["stale"], null),
			}),
		).toBe(restarted);
		expect(
			providerSearchReducer(restarted, {
				token: stale,
				type: "request-failed",
			}),
		).toBe(restarted);

		const failed = providerSearchReducer(restarted, {
			type: "request-failed",
			token: restarted.operation?.token ?? -1,
		});
		expect(failed.status).toBe("failed");
	});

	it("keeps the generation stable across search status changes", () => {
		const changed = providerSearchReducer(createProviderSearchState(), {
			type: "query-changed",
			query: "dune",
		});
		const loading = providerSearchReducer(changed, { type: "search-requested" });
		const ready = providerSearchReducer(loading, {
			type: "response-received",
			token: loading.operation?.token ?? -1,
			response: response(["a"], 2),
		});
		const loadingMore = providerSearchReducer(ready, { type: "next-page-requested" });
		const failed = providerSearchReducer(loadingMore, {
			type: "request-failed",
			token: loadingMore.operation?.token ?? -1,
		});

		expect(loading.generation).toBe(changed.generation);
		expect(ready.generation).toBe(changed.generation);
		expect(loadingMore.generation).toBe(changed.generation);
		expect(failed.generation).toBe(changed.generation);
		expect(loadingMore.operation?.token).not.toBe(loading.operation?.token);
	});

	it("clears results when the provider, query, or options change", () => {
		const loaded = providerSearchReducer(searched("dune"), {
			type: "response-received",
			response: response(["a"], 2),
			token: searched("dune").operation?.token ?? -1,
		});
		expect(loaded.items).toHaveLength(1);

		for (const event of [
			{ type: "provider-changed" },
			{ type: "options-changed" },
			{ type: "query-changed", query: "other" },
		] satisfies readonly ProviderSearchEvent[]) {
			const cleared = providerSearchReducer(loaded, event);
			expect(cleared.items).toEqual([]);
			expect(cleared.status).toBe("idle");
			expect(cleared.nextPage).toBeUndefined();
			expect(cleared.operation).toBeUndefined();
			expect(cleared.generation).toBeGreaterThan(loaded.generation);
		}

		expect(providerSearchReducer(loaded, { type: "query-changed", query: "dune" })).toBe(loaded);
	});

	it("issues nothing for a blank query and refuses a next page without one", () => {
		for (const query of ["", "   "]) {
			const state = searched(query);
			expect(state.status).toBe("idle");
			expect(state.operation).toBeUndefined();
		}

		const idle = createProviderSearchState();
		expect(providerSearchReducer(idle, { type: "next-page-requested" })).toBe(idle);

		const loading = searched("dune");
		expect(providerSearchReducer(loading, { type: "next-page-requested" })).toBe(loading);
	});

	it("derives hasMore from the details next page", () => {
		const state = searched("dune");
		const withDetails = (nextPage: number | null | undefined) =>
			providerSearchReducer(state, {
				type: "response-received",
				token: state.operation?.token ?? -1,
				response: response(["a"], nextPage),
			});

		expect(hasMoreProviderSearchResults(withDetails(3))).toBe(true);
		expect(hasMoreProviderSearchResults(withDetails(null))).toBe(false);
		expect(hasMoreProviderSearchResults(withDetails(undefined))).toBe(false);
	});

	it("omits the entire options property when no option values remain", () => {
		const input = { page: 2, providerId, query: "dune" };

		expect(buildSearchPayload({ ...input, options: {} })).toEqual({
			page: 2,
			providerId,
			pageSize: 20,
			query: "dune",
		});
		expect(Object.hasOwn(buildSearchPayload({ ...input }), "options")).toBe(false);
		expect(buildSearchPayload({ ...input, options: { region: "us" } }).options).toEqual({
			region: "us",
		});
	});
});
