import { describe, expect, it } from "bun:test";

import integrationPushHelperCode from "../shared/integration-push.txt";
import jellyfinPushScriptCode from "./jellyfin-push.txt";
import {
	appApiFailure,
	appApiSuccess,
	httpFailure,
	httpSuccess,
	runTriggerScript,
} from "./test-utils";

const jellyfinCode = `${integrationPushHelperCode}\n\n${jellyfinPushScriptCode}`;

type HttpCall = { url: string; method: string; options: Record<string, unknown> };

const movieEntity = {
	externalId: "603",
	name: "The Matrix",
	entitySchemaId: "es_movie",
	sandboxScriptId: "script_movie_tmdb",
};

const jellyfinIntegration = {
	id: "integration_1",
	providerSpecifics: {
		username: "ryot",
		password: "secret",
		kind: "jellyfin_push",
		baseUrl: "http://jellyfin.local",
	},
};

const tmdbProviders = [{ name: "TMDB", scriptId: "script_movie_tmdb" }];

const createTrigger = (overrides: Record<string, unknown> = {}) => ({
	trigger: {
		entityId: "movie_1",
		entitySchemaSlug: "movie",
		eventSchemaSlug: "complete",
		properties: { completionMode: "just_now" },
		...overrides,
	},
});

const createAppApiCall = (options: {
	integrations?: unknown[];
	entity?: Record<string, unknown>;
}) => {
	return (_method: unknown, path: unknown) => {
		const stringPath = String(path);
		if (stringPath.startsWith("/api/integrations?")) {
			return appApiSuccess(options.integrations ?? []);
		}
		if (stringPath.startsWith("/api/entities/")) {
			return options.entity ? appApiSuccess(options.entity) : appApiFailure();
		}
		if (stringPath.startsWith("/api/entity-schemas/")) {
			return appApiSuccess({ providers: tmdbProviders });
		}
		return appApiFailure();
	};
};

const userPreferences =
	(disableIntegrations = false) =>
	() => ({
		success: true,
		data: { disableIntegrations },
	});

const createHttpCall = (calls: HttpCall[], items: unknown[]) => {
	return (method: unknown, url: unknown, options: unknown) => {
		const stringUrl = String(url);
		calls.push({
			url: stringUrl,
			method: String(method),
			// oxlint-disable-next-line no-unsafe-type-assertion
			options: (options ?? {}) as Record<string, unknown>,
		});

		if (stringUrl.endsWith("/Users/AuthenticateByName")) {
			return httpSuccess({ AccessToken: "jf-token", User: { Id: "jf-user" } });
		}
		if (stringUrl.includes("/Items?")) {
			return httpSuccess({ Items: items });
		}
		if (stringUrl.includes("/PlayedItems/")) {
			return httpSuccess({});
		}
		return httpFailure();
	};
};

describe("jellyfin-push sandbox script", () => {
	it("authenticates and marks the matching item as played", async () => {
		const httpCalls: HttpCall[] = [];
		const items = [{ Id: "jf-item-1", Name: "The Matrix", ProviderIds: { Tmdb: "603" } }];

		await runTriggerScript(jellyfinCode, createTrigger(), {
			getUserPreferences: userPreferences(),
			httpCall: createHttpCall(httpCalls, items),
			appApiCall: createAppApiCall({ entity: movieEntity, integrations: [jellyfinIntegration] }),
		});

		const markCall = httpCalls.find((call) => call.url.includes("/PlayedItems/"));
		expect(markCall?.method).toBe("POST");
		expect(markCall?.url).toBe("http://jellyfin.local/Users/jf-user/PlayedItems/jf-item-1");
		expect(markCall?.options.headers).toEqual({ "X-Emby-Token": "jf-token" });
	});

	it("no-ops when the item cannot be found in Jellyfin", async () => {
		const httpCalls: HttpCall[] = [];

		await runTriggerScript(jellyfinCode, createTrigger(), {
			getUserPreferences: userPreferences(),
			httpCall: createHttpCall(httpCalls, []),
			appApiCall: createAppApiCall({ entity: movieEntity, integrations: [jellyfinIntegration] }),
		});

		expect(httpCalls.some((call) => call.url.includes("/PlayedItems/"))).toBe(false);
	});

	it("no-ops when the completed entity is not a movie or show", async () => {
		const httpCalls: HttpCall[] = [];

		await runTriggerScript(
			jellyfinCode,
			createTrigger({ entitySchemaSlug: "book", entityId: "book_1" }),
			{
				getUserPreferences: userPreferences(),
				httpCall: createHttpCall(httpCalls, []),
				appApiCall: createAppApiCall({ entity: movieEntity, integrations: [jellyfinIntegration] }),
			},
		);

		expect(httpCalls).toHaveLength(0);
	});

	it("no-ops when integrations are disabled for the user", async () => {
		const httpCalls: HttpCall[] = [];

		await runTriggerScript(jellyfinCode, createTrigger(), {
			httpCall: createHttpCall(httpCalls, []),
			getUserPreferences: userPreferences(true),
			appApiCall: createAppApiCall({ entity: movieEntity, integrations: [jellyfinIntegration] }),
		});

		expect(httpCalls).toHaveLength(0);
	});
});
