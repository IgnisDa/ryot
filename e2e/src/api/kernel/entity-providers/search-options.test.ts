import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { ProviderSearchOptionsResult } from "@ryot-app/plugin-backend-sdk/provider";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel";
import {
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	fakeProviderSearchResult,
	getApiClient,
	installTestProvider,
	searchProviderEntities,
	uninstallTestProvider,
} from "~/fixtures/kernel";
import type { InstalledTestProvider } from "~/fixtures/kernel/sandbox-provider";
import { assertCondition, assertPresent, assertTaggedError } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";

const DYNAMIC_SEARCH_OPTIONS_SCHEMA = {
	unknownKeys: "strict",
	fields: {
		genres: {
			label: "Genres",
			type: "enum-array",
			description: "Genres to include",
			choices: { kind: "dynamic", source: "genres" },
		},
	},
} satisfies AppSchema;

const SEARCH_OPTIONS_RESULT = {
	sources: {
		genres: [
			{ value: "1", label: "Action" },
			{ value: "2", label: "Fantasy" },
		],
	},
} satisfies ProviderSearchOptionsResult;

const STATIC_SEARCH_OPTIONS_SCHEMA = {
	unknownKeys: "strict",
	fields: {
		language: {
			type: "enum",
			label: "Language",
			description: "Language to use",
			choices: { kind: "static", values: [{ value: "en", label: "English" }] },
		},
	},
} satisfies AppSchema;

const DYNAMIC_PLUGIN_SLUG = `provider-search-options-${crypto.randomUUID()}`;
const DYNAMIC_PROVIDER_SLUG = `dynamic-search-options-${crypto.randomUUID()}`;
const FAILING_PLUGIN_SLUG = `provider-search-options-failing-${crypto.randomUUID()}`;
const FAILING_PROVIDER_SLUG = `failing-search-options-${crypto.randomUUID()}`;
const STATIC_PLUGIN_SLUG = `provider-search-options-static-${crypto.randomUUID()}`;
const STATIC_PROVIDER_SLUG = `static-search-options-${crypto.randomUUID()}`;

let dynamicProvider: InstalledTestProvider;
let failingProvider: InstalledTestProvider;
let staticProvider: InstalledTestProvider;
let providerClient: Client;

beforeAll(() =>
	runPromise(
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			providerClient = client;
			dynamicProvider = yield* installTestProvider({
				client,
				slug: DYNAMIC_PROVIDER_SLUG,
				rootEntitySchemaSlug: "book",
				pluginSlug: DYNAMIC_PLUGIN_SLUG,
				searchOptions: SEARCH_OPTIONS_RESULT,
				searchOptionsSchema: DYNAMIC_SEARCH_OPTIONS_SCHEMA,
				details: fakeProviderDetailsResult({ name: "Dynamic Search Options Provider" }),
				search: fakeProviderSearchResult([
					{ title: "Action Book", externalId: "search-options-book-1" },
				]),
			});
			failingProvider = yield* installTestProvider({
				client,
				slug: FAILING_PROVIDER_SLUG,
				rootEntitySchemaSlug: "book",
				pluginSlug: FAILING_PLUGIN_SLUG,
				searchOptionsSchema: DYNAMIC_SEARCH_OPTIONS_SCHEMA,
				searchOptionsFailure: "search options fixture failure",
				details: fakeProviderDetailsResult({ name: "Failing Search Options Provider" }),
				search: fakeProviderSearchResult([
					{ title: "Fallback Book", externalId: "failing-search-options-book-1" },
				]),
			});
			staticProvider = yield* installTestProvider({
				client,
				slug: STATIC_PROVIDER_SLUG,
				rootEntitySchemaSlug: "book",
				pluginSlug: STATIC_PLUGIN_SLUG,
				searchOptionsSchema: STATIC_SEARCH_OPTIONS_SCHEMA,
				details: fakeProviderDetailsResult({ name: "Static Search Options Provider" }),
				search: fakeProviderSearchResult([
					{ title: "Static Book", externalId: "static-search-options-book-1" },
				]),
			});
		}),
	),
);

afterAll(() =>
	runPromise(
		Effect.gen(function* () {
			yield* uninstallTestProvider(staticProvider);
			yield* uninstallTestProvider(failingProvider);
			yield* uninstallTestProvider(dynamicProvider);
		}),
	),
);

describe("POST /entity-providers/search-options", () => {
	it.live("materializes dynamic enum-array choices with separate values and labels", () =>
		Effect.gen(function* () {
			const response = yield* providerClient.call((c) =>
				c.entityProviders.searchOptions({ payload: { providerId: dynamicProvider.providerId } }),
			);

			assertPresent(response.schema, "Expected a materialized search options schema");
			const genres = response.schema.fields.genres;
			assertPresent(genres, "Expected the genres search option");
			assertCondition(genres.type === "enum-array", "Expected an enum-array search option");
			assertCondition(genres.choices.kind === "static", "Expected materialized static choices");
			expect(genres.choices.values).toEqual(SEARCH_OPTIONS_RESULT.sources.genres);
			expect(genres.choices).not.toHaveProperty("source");
			assertPresent(dynamicProvider.searchOptionsScriptId, "Expected a search options script ID");
		}),
	);

	it.live("returns the static schema without a search-options provider operation", () =>
		Effect.gen(function* () {
			const response = yield* providerClient.call((c) =>
				c.entityProviders.searchOptions({ payload: { providerId: staticProvider.providerId } }),
			);

			expect(response.schema).toEqual(STATIC_SEARCH_OPTIONS_SCHEMA);
		}),
	);

	it.live("requires authentication", () =>
		Effect.gen(function* () {
			const client = getApiClient();
			const error = yield* Effect.flip(
				client.call((c) =>
					c.entityProviders.searchOptions({ payload: { providerId: dynamicProvider.providerId } }),
				),
			);

			assertTaggedError(error, "AuthUnauthorized");
		}),
	);
});

describe("POST /entity-providers/search — search option validation", () => {
	it.live("accepts a known dynamic choice value and rejects an unknown value", () =>
		Effect.gen(function* () {
			const search = yield* searchProviderEntities(providerClient, {
				page: 1,
				pageSize: 5,
				query: "known",
				options: { genres: ["1"] },
				providerId: dynamicProvider.providerId,
			});
			expect(search.items).toHaveLength(1);

			const error = yield* Effect.flip(
				searchProviderEntities(providerClient, {
					page: 1,
					pageSize: 5,
					query: "unknown",
					options: { genres: ["unknown"] },
					providerId: dynamicProvider.providerId,
				}),
			);
			assertTaggedError(error, "ProviderEntityBadRequest");
			expect(error.reason).toEqual({ code: "invalid-search-options" });
		}),
	);
});

describe("provider search-options execution failure", () => {
	it.live("keeps plain search available and returns stable BadRequest for filtered search", () =>
		Effect.gen(function* () {
			const plainSearch = yield* searchProviderEntities(providerClient, {
				page: 1,
				pageSize: 5,
				query: "plain",
				providerId: failingProvider.providerId,
			});
			expect(plainSearch.items).toHaveLength(1);

			const filteredSearchError = yield* Effect.flip(
				searchProviderEntities(providerClient, {
					page: 1,
					pageSize: 5,
					query: "filtered",
					options: { genres: ["1"] },
					providerId: failingProvider.providerId,
				}),
			);
			assertTaggedError(filteredSearchError, "ProviderEntityBadRequest");
			expect(filteredSearchError.reason).toEqual({ code: "search-options-unavailable" });

			const searchOptionsError = yield* Effect.flip(
				providerClient.call((c) =>
					c.entityProviders.searchOptions({ payload: { providerId: failingProvider.providerId } }),
				),
			);
			assertTaggedError(searchOptionsError, "ProviderEntityBadRequest");
			expect(searchOptionsError.reason).toEqual(filteredSearchError.reason);
		}),
	);
});
