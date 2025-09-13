import { describe, expect, it } from "bun:test";

import integrationPushHelperCode from "../shared/integration-push.txt";
import radarrPushScriptCode from "./radarr-push.txt";
import { appApiFailure, appApiSuccess, httpSuccess, runTriggerScript } from "./test-utils";

const radarrCode = `${integrationPushHelperCode}\n\n${radarrPushScriptCode}`;

type HttpCall = { url: string; method: string; options: Record<string, unknown> };

const movieEntity = {
	externalId: "603",
	name: "The Matrix",
	entitySchemaId: "es_movie",
	sandboxScriptId: "script_movie_tmdb",
};

const radarrIntegration = {
	id: "integration_1",
	providerSpecifics: {
		profileId: "4",
		kind: "radarr",
		tagIds: [3, 7],
		apiKey: "radarr-key",
		rootFolderPath: "/movies",
		baseUrl: "http://radarr.local",
		syncCollectionIds: ["collection_1"],
	},
};

const tmdbProviders = [
	{ name: "TVDB", scriptId: "script_movie_tvdb" },
	{ name: "TMDB", scriptId: "script_movie_tmdb" },
];

const createTrigger = (properties: Record<string, unknown>) => ({
	trigger: {
		entityId: "collection_1",
		entitySchemaSlug: "collection",
		eventSchemaSlug: "add-entity-to-collection",
		properties: { relationshipId: "rel_1", relationshipProperties: {}, ...properties },
	},
});

const createAppApiCall = (options: {
	integrations?: unknown[];
	entity?: Record<string, unknown> | null;
	providers?: Array<{ name: string; scriptId: string }>;
}) => {
	const appApiCall = (_method: unknown, path: unknown) => {
		const stringPath = String(path);
		if (stringPath.startsWith("/api/integrations?")) {
			return appApiSuccess(options.integrations ?? []);
		}
		if (stringPath.startsWith("/api/entities/")) {
			return options.entity ? appApiSuccess(options.entity) : appApiFailure();
		}
		if (stringPath.startsWith("/api/entity-schemas/")) {
			return appApiSuccess({ providers: options.providers ?? tmdbProviders });
		}
		return appApiFailure();
	};
	return appApiCall;
};

const userPreferences =
	(disableIntegrations = false) =>
	() => ({
		success: true,
		data: { disableIntegrations },
	});

const createHttpCall = (calls: HttpCall[]) => (method: unknown, url: unknown, options: unknown) => {
	calls.push({
		method: String(method),
		url: String(url),
		// oxlint-disable-next-line no-unsafe-type-assertion
		options: (options ?? {}) as Record<string, unknown>,
	});
	return httpSuccess({});
};

describe("radarr-push sandbox script", () => {
	it("adds a TMDB movie to each matching Radarr integration", async () => {
		const httpCalls: HttpCall[] = [];

		await runTriggerScript(
			radarrCode,
			createTrigger({ entitySchemaSlug: "movie", entityId: "movie_1" }),
			{
				getUserPreferences: userPreferences(),
				httpCall: createHttpCall(httpCalls),
				appApiCall: createAppApiCall({ entity: movieEntity, integrations: [radarrIntegration] }),
			},
		);

		expect(httpCalls).toHaveLength(1);
		expect(httpCalls[0]?.method).toBe("POST");
		expect(httpCalls[0]?.url).toBe("http://radarr.local/api/v3/movie");
		expect(httpCalls[0]?.options.headers).toEqual({
			"X-Api-Key": "radarr-key",
			"Content-Type": "application/json",
		});
		expect(JSON.parse(String(httpCalls[0]?.options.body))).toEqual({
			tmdbId: 603,
			tags: [3, 7],
			monitored: true,
			qualityProfileId: 4,
			rootFolderPath: "/movies",
			addOptions: { searchForMovie: true },
		});
	});

	it("no-ops when the added entity is not a movie", async () => {
		const httpCalls: HttpCall[] = [];

		await runTriggerScript(
			radarrCode,
			createTrigger({ entitySchemaSlug: "show", entityId: "show_1" }),
			{
				getUserPreferences: userPreferences(),
				httpCall: createHttpCall(httpCalls),
				appApiCall: createAppApiCall({ entity: movieEntity, integrations: [radarrIntegration] }),
			},
		);

		expect(httpCalls).toHaveLength(0);
	});

	it("no-ops when the movie entity is not sourced from TMDB", async () => {
		const httpCalls: HttpCall[] = [];

		await runTriggerScript(
			radarrCode,
			createTrigger({ entitySchemaSlug: "movie", entityId: "movie_1" }),
			{
				getUserPreferences: userPreferences(),
				httpCall: createHttpCall(httpCalls),
				appApiCall: createAppApiCall({
					integrations: [radarrIntegration],
					entity: { ...movieEntity, sandboxScriptId: "script_movie_tvdb" },
				}),
			},
		);

		expect(httpCalls).toHaveLength(0);
	});

	it("no-ops when the collection is not in any integration's sync collections", async () => {
		const httpCalls: HttpCall[] = [];

		await runTriggerScript(
			radarrCode,
			createTrigger({ entitySchemaSlug: "movie", entityId: "movie_1" }),
			{
				getUserPreferences: userPreferences(),
				httpCall: createHttpCall(httpCalls),
				appApiCall: createAppApiCall({
					entity: movieEntity,
					integrations: [
						{
							...radarrIntegration,
							providerSpecifics: {
								...radarrIntegration.providerSpecifics,
								syncCollectionIds: ["other"],
							},
						},
					],
				}),
			},
		);

		expect(httpCalls).toHaveLength(0);
	});

	it("no-ops when integrations are disabled for the user", async () => {
		const httpCalls: HttpCall[] = [];

		await runTriggerScript(
			radarrCode,
			createTrigger({ entitySchemaSlug: "movie", entityId: "movie_1" }),
			{
				httpCall: createHttpCall(httpCalls),
				getUserPreferences: userPreferences(true),
				appApiCall: createAppApiCall({ entity: movieEntity, integrations: [radarrIntegration] }),
			},
		);

		expect(httpCalls).toHaveLength(0);
	});
});
