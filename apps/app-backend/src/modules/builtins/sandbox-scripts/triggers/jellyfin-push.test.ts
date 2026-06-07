import { describe, expect, it } from "vitest";

import integrationPushHelperCode from "../script-helpers/integration-push.sandbox.js" with { type: "text" };
import jellyfinPushScriptCode from "./jellyfin-push.sandbox.js" with { type: "text" };
import {
	hostFailure,
	hostSuccess,
	httpFailure,
	httpSuccess,
	runTriggerScript,
	toRecord,
	wrapWithPushHelpers,
} from "./test-utils";

const jellyfinCode = wrapWithPushHelpers(integrationPushHelperCode, jellyfinPushScriptCode);

const runJellyfinScript = (
	context: unknown,
	hostFunctions: Record<string, (...args: Array<unknown>) => unknown>,
) => runTriggerScript(jellyfinCode, context, hostFunctions);

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

const createHostFunctions = (options: {
	integrations?: unknown[];
	entity?: Record<string, unknown>;
}) => ({
	listIntegrations: () => hostSuccess(options.integrations ?? []),
	getEntity: () => (options.entity ? hostSuccess(options.entity) : hostFailure()),
	getEntitySchema: () => hostSuccess({ providers: tmdbProviders }),
});

const userPreferences =
	(disableIntegrations = false) =>
	() => ({ success: true, data: { disableIntegrations } });

const createHttpCall = (calls: HttpCall[], items: unknown[]) => {
	return (method: unknown, url: unknown, options: unknown) => {
		const stringUrl = String(url);
		calls.push({
			url: stringUrl,
			method: String(method),
			options: toRecord(options),
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
	it("authenticates and marks the matching item as played", () => {
		const httpCalls: HttpCall[] = [];
		const items = [{ Id: "jf-item-1", Name: "The Matrix", ProviderIds: { Tmdb: "603" } }];

		return runJellyfinScript(createTrigger(), {
			...createHostFunctions({ entity: movieEntity, integrations: [jellyfinIntegration] }),
			getUserPreferences: userPreferences(),
			httpCall: createHttpCall(httpCalls, items),
		}).then(() => {
			const markCall = httpCalls.find((call) => call.url.includes("/PlayedItems/"));
			expect(markCall?.method).toBe("POST");
			expect(markCall?.url).toBe("http://jellyfin.local/Users/jf-user/PlayedItems/jf-item-1");
			expect(markCall?.options.headers).toEqual({ "X-Emby-Token": "jf-token" });
			return undefined;
		});
	});

	it("no-ops when the item cannot be found in Jellyfin", () => {
		const httpCalls: HttpCall[] = [];

		return runJellyfinScript(createTrigger(), {
			...createHostFunctions({ entity: movieEntity, integrations: [jellyfinIntegration] }),
			getUserPreferences: userPreferences(),
			httpCall: createHttpCall(httpCalls, []),
		}).then(() => {
			expect(httpCalls.some((call) => call.url.includes("/PlayedItems/"))).toBe(false);
			return undefined;
		});
	});

	it("no-ops when the completed entity is not a movie or show", () => {
		const httpCalls: HttpCall[] = [];

		return runJellyfinScript(createTrigger({ entitySchemaSlug: "book", entityId: "book_1" }), {
			...createHostFunctions({ entity: movieEntity, integrations: [jellyfinIntegration] }),
			getUserPreferences: userPreferences(),
			httpCall: createHttpCall(httpCalls, []),
		}).then(() => {
			expect(httpCalls).toHaveLength(0);
			return undefined;
		});
	});

	it("no-ops when integrations are disabled for the user", () => {
		const httpCalls: HttpCall[] = [];

		return runJellyfinScript(createTrigger(), {
			...createHostFunctions({ entity: movieEntity, integrations: [jellyfinIntegration] }),
			httpCall: createHttpCall(httpCalls, []),
			getUserPreferences: userPreferences(true),
		}).then(() => {
			expect(httpCalls).toHaveLength(0);
			return undefined;
		});
	});
});
