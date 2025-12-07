import { describe, expect, it } from "bun:test";

import integrationPushHelperCode from "../shared/integration-push.txt";
import sonarrPushScriptCode from "./sonarr-push.txt";
import { hostFailure, hostSuccess, httpSuccess, runTriggerScript } from "./test-utils";

const sonarrCode = `${integrationPushHelperCode}\n\n${sonarrPushScriptCode}`;

type HttpCall = { url: string; method: string; options: Record<string, unknown> };

const showEntity = {
	name: "Severance",
	externalId: "371980",
	entitySchemaId: "es_show",
	sandboxScriptId: "script_show_tvdb",
};

const sonarrIntegration = {
	id: "integration_1",
	providerSpecifics: {
		tagIds: 5,
		profileId: "2",
		kind: "sonarr",
		apiKey: "sonarr-key",
		rootFolderPath: "/tv",
		baseUrl: "http://sonarr.local/",
		syncCollectionIds: ["collection_1"],
	},
};

const tvdbProviders = [
	{ name: "TMDB", scriptId: "script_show_tmdb" },
	{ name: "TVDB", scriptId: "script_show_tvdb" },
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
}) => ({
	listIntegrations: () => hostSuccess(options.integrations ?? []),
	getEntity: () => (options.entity ? hostSuccess(options.entity) : hostFailure()),
	getEntitySchema: () => hostSuccess({ providers: tvdbProviders }),
});

const userPreferences = () => () => ({ success: true, data: { disableIntegrations: false } });

const createHttpCall = (calls: HttpCall[]) => (method: unknown, url: unknown, options: unknown) => {
	calls.push({
		method: String(method),
		url: String(url),
		// oxlint-disable-next-line no-unsafe-type-assertion
		options: (options ?? {}) as Record<string, unknown>,
	});
	return httpSuccess({});
};

describe("sonarr-push sandbox script", () => {
	it("adds a TVDB show to Sonarr and wraps the single tag id in an array", async () => {
		const httpCalls: HttpCall[] = [];

		await runTriggerScript(
			sonarrCode,
			createTrigger({ entitySchemaSlug: "show", entityId: "show_1" }),
			{
				...createHostFunctions({ entity: showEntity, integrations: [sonarrIntegration] }),
				getUserPreferences: userPreferences(),
				httpCall: createHttpCall(httpCalls),
			},
		);

		expect(httpCalls).toHaveLength(1);
		expect(httpCalls[0]?.url).toBe("http://sonarr.local/api/v3/series");
		expect(JSON.parse(String(httpCalls[0]?.options.body))).toEqual({
			tags: [5],
			tvdbId: 371980,
			monitored: true,
			qualityProfileId: 2,
			rootFolderPath: "/tv",
			addOptions: { searchForMissingEpisodes: true },
		});
	});

	it("no-ops when the added entity is not a show", async () => {
		const httpCalls: HttpCall[] = [];

		await runTriggerScript(
			sonarrCode,
			createTrigger({ entitySchemaSlug: "movie", entityId: "movie_1" }),
			{
				...createHostFunctions({ entity: showEntity, integrations: [sonarrIntegration] }),
				getUserPreferences: userPreferences(),
				httpCall: createHttpCall(httpCalls),
			},
		);

		expect(httpCalls).toHaveLength(0);
	});

	it("no-ops when the show entity is not sourced from TVDB", async () => {
		const httpCalls: HttpCall[] = [];

		await runTriggerScript(
			sonarrCode,
			createTrigger({ entitySchemaSlug: "show", entityId: "show_1" }),
			{
				...createHostFunctions({
					integrations: [sonarrIntegration],
					entity: { ...showEntity, sandboxScriptId: "script_show_tmdb" },
				}),
				getUserPreferences: userPreferences(),
				httpCall: createHttpCall(httpCalls),
			},
		);

		expect(httpCalls).toHaveLength(0);
	});
});
