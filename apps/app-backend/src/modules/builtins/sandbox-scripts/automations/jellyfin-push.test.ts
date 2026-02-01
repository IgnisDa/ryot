import type { JsonValue, SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import {
	eventAutomationContext,
	entityRecord,
	entitySchemaRecord,
	execution,
	hostFailure,
	hostSuccess,
	httpFailure,
	httpSuccess,
	integrationRecord,
	toRecord,
} from "./automation-test-utils";
import definition, { manifest } from "./jellyfin-push.sandbox";

type JellyfinHost = SandboxHost<typeof manifest.capabilities>;
type HttpCall = { url: string; method: string; options: Record<string, unknown> };

const movieEntity = entityRecord({
	id: "movie-1",
	externalId: "603",
	name: "The Matrix",
	entitySchemaId: "es-movie",
	sandboxScriptId: "script-movie-tmdb",
});

const jellyfinIntegration = integrationRecord({
	provider: "jellyfin_push",
	providerSpecifics: { username: "ryot", password: "secret", baseUrl: "http://jellyfin.local" },
});

const schema = entitySchemaRecord({
	id: "es-movie",
	providers: [{ name: "TMDB", scriptId: "script-movie-tmdb" }],
});

const createAutomation = (overrides: Parameters<typeof eventAutomationContext>[0] = {}) =>
	eventAutomationContext({
		eventSchemaSlug: "complete",
		subject: { id: "movie-1", name: "The Matrix", entitySchemaSlug: "movie" },
		properties: { completionMode: "just_now" },
		...overrides,
	});

const createHttpCall =
	(calls: HttpCall[], items: JsonValue[], playedFailure = false): JellyfinHost["httpCall"] =>
	(method, url, options) => {
		calls.push({ url, method, options: toRecord(options) });
		if (url.endsWith("/Users/AuthenticateByName")) {
			return httpSuccess({ AccessToken: "jf-token", User: { Id: "jf-user" } });
		}
		if (url.includes("/Items?")) {
			return httpSuccess({ Items: items });
		}
		if (url.includes("/PlayedItems/")) {
			return playedFailure ? httpFailure("already played", 409) : httpSuccess({});
		}
		return httpFailure();
	};

const createHost = (options: {
	disableIntegrations?: boolean;
	httpCall: JellyfinHost["httpCall"];
	entity?: ReturnType<typeof entityRecord>;
	integrations?: ReturnType<typeof integrationRecord>[];
}) =>
	defineSandboxTestHost(manifest, {
		httpCall: options.httpCall,
		getEntity: () => (options.entity ? hostSuccess(options.entity) : hostFailure()),
		getEntitySchema: () => hostSuccess(schema),
		listIntegrations: () => hostSuccess(options.integrations ?? []),
		getUserPreferences: () =>
			hostSuccess({ isNsfw: false, disableIntegrations: options.disableIntegrations ?? false }),
	});

describe("jellyfin-push sandbox script", () => {
	it("authenticates and marks the matching item as played", () => {
		const calls: HttpCall[] = [];
		const host = createHost({
			entity: movieEntity,
			integrations: [jellyfinIntegration],
			httpCall: createHttpCall(calls, [
				{ Id: "jf-item-1", Name: "The Matrix", ProviderIds: { Tmdb: "603" } },
			]),
		});
		return runSandboxTestDriver(
			definition.drivers.automation,
			createAutomation(),
			host,
			execution,
		).then(() => {
			const markCall = calls.find((call) => call.url.includes("/PlayedItems/"));
			expect(markCall?.method).toBe("POST");
			expect(markCall?.url).toBe("http://jellyfin.local/Users/jf-user/PlayedItems/jf-item-1");
			expect(markCall?.options["headers"]).toEqual({ "X-Emby-Token": "jf-token" });
			return undefined;
		});
	});

	it("no-ops when the item is absent, the entity is unsupported, or integrations are disabled", () => {
		const calls: HttpCall[] = [];
		const httpCall = createHttpCall(calls, []);
		return Promise.all([
			runSandboxTestDriver(
				definition.drivers.automation,
				createAutomation(),
				createHost({ entity: movieEntity, integrations: [jellyfinIntegration], httpCall }),
				execution,
			),
			runSandboxTestDriver(
				definition.drivers.automation,
				createAutomation({
					subject: { id: "book-1", name: "Book", entitySchemaSlug: "book" },
				}),
				createHost({ entity: movieEntity, integrations: [jellyfinIntegration], httpCall }),
				execution,
			),
			runSandboxTestDriver(
				definition.drivers.automation,
				createAutomation(),
				createHost({
					httpCall,
					entity: movieEntity,
					disableIntegrations: true,
					integrations: [jellyfinIntegration],
				}),
				execution,
			),
		]).then(() => {
			expect(calls.some((call) => call.url.includes("/PlayedItems/"))).toBe(false);
			return undefined;
		});
	});

	it("treats a played-item HTTP failure as non-fatal", () => {
		const calls: HttpCall[] = [];
		const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const host = createHost({
			entity: movieEntity,
			integrations: [jellyfinIntegration],
			httpCall: createHttpCall(
				calls,
				[{ Id: "jf-item-1", Name: "The Matrix", ProviderIds: { Tmdb: "603" } }],
				true,
			),
		});
		return runSandboxTestDriver(
			definition.drivers.automation,
			createAutomation(),
			host,
			execution,
		).then((result) => {
			expect(result).toBeNull();
			expect(warning).toHaveBeenCalledWith("Jellyfin push failed: already played");
			warning.mockRestore();
			return undefined;
		});
	});
});
