import { describe, expect, it } from "vitest";

import {
	hostFailure,
	hostSuccess,
	httpSuccess,
	readScriptFile,
	runTriggerScript,
	toRecord,
} from "./test-utils";

const getRadarrCode = () =>
	Promise.all([
		readScriptFile("../shared/integration-push.txt"),
		readScriptFile("./radarr-push.txt"),
	]).then(([helperCode, scriptCode]) => `${helperCode}\n\n${scriptCode}`);

const runRadarrScript = (
	context: unknown,
	hostFunctions: Record<string, (...args: Array<unknown>) => unknown>,
) => getRadarrCode().then((code) => runTriggerScript(code, context, hostFunctions));

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

const createHostFunctions = (options: {
	integrations?: unknown[];
	entity?: Record<string, unknown> | null;
	providers?: Array<{ name: string; scriptId: string }>;
}) => ({
	listIntegrations: () => hostSuccess(options.integrations ?? []),
	getEntity: () => (options.entity ? hostSuccess(options.entity) : hostFailure()),
	getEntitySchema: () => hostSuccess({ providers: options.providers ?? tmdbProviders }),
});

const userPreferences =
	(disableIntegrations = false) =>
	() => ({ success: true, data: { disableIntegrations } });

const createHttpCall = (calls: HttpCall[]) => (method: unknown, url: unknown, options: unknown) => {
	calls.push({
		url: String(url),
		method: String(method),
		options: toRecord(options),
	});
	return httpSuccess({});
};

describe("radarr-push sandbox script", () => {
	it("adds a TMDB movie to each matching Radarr integration", () => {
		const httpCalls: HttpCall[] = [];

		return runRadarrScript(createTrigger({ entitySchemaSlug: "movie", entityId: "movie_1" }), {
			...createHostFunctions({ entity: movieEntity, integrations: [radarrIntegration] }),
			getUserPreferences: userPreferences(),
			httpCall: createHttpCall(httpCalls),
		}).then(() => {
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
			return undefined;
		});
	});

	it("no-ops when the added entity is not a movie", () => {
		const httpCalls: HttpCall[] = [];

		return runRadarrScript(createTrigger({ entitySchemaSlug: "show", entityId: "show_1" }), {
			...createHostFunctions({ entity: movieEntity, integrations: [radarrIntegration] }),
			getUserPreferences: userPreferences(),
			httpCall: createHttpCall(httpCalls),
		}).then(() => {
			expect(httpCalls).toHaveLength(0);
			return undefined;
		});
	});

	it("no-ops when the movie entity is not sourced from TMDB", () => {
		const httpCalls: HttpCall[] = [];

		return runRadarrScript(createTrigger({ entitySchemaSlug: "movie", entityId: "movie_1" }), {
			...createHostFunctions({
				integrations: [radarrIntegration],
				entity: { ...movieEntity, sandboxScriptId: "script_movie_tvdb" },
			}),
			getUserPreferences: userPreferences(),
			httpCall: createHttpCall(httpCalls),
		}).then(() => {
			expect(httpCalls).toHaveLength(0);
			return undefined;
		});
	});

	it("no-ops when the collection is not in any integration's sync collections", () => {
		const httpCalls: HttpCall[] = [];

		return runRadarrScript(createTrigger({ entitySchemaSlug: "movie", entityId: "movie_1" }), {
			...createHostFunctions({
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
			getUserPreferences: userPreferences(),
			httpCall: createHttpCall(httpCalls),
		}).then(() => {
			expect(httpCalls).toHaveLength(0);
			return undefined;
		});
	});

	it("no-ops when integrations are disabled for the user", () => {
		const httpCalls: HttpCall[] = [];

		return runRadarrScript(createTrigger({ entitySchemaSlug: "movie", entityId: "movie_1" }), {
			...createHostFunctions({ entity: movieEntity, integrations: [radarrIntegration] }),
			httpCall: createHttpCall(httpCalls),
			getUserPreferences: userPreferences(true),
		}).then(() => {
			expect(httpCalls).toHaveLength(0);
			return undefined;
		});
	});
});
