import { describe, expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { LogEntry, ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";

import {
	entityRecord,
	entitySchemaRecord,
	eventAutomationContext,
	hostFailure,
	hostSuccess,
	httpFailure,
	httpSuccess,
	integrationRecord,
	ryotqlRows,
	toRecord,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./jellyfin-push.sandbox";

type HttpCall = { url: string; method: string; options: Record<string, unknown> };
type JellyfinHost = Pick<
	ScriptHost,
	| "log"
	| "httpCall"
	| "executeRyotql"
	| "getEntitySchemas"
	| "listIntegrations"
	| "getUserPreferences"
>;

const movieEntity = entityRecord({
	id: "movie-1",
	externalId: "603",
	name: "The Matrix",
	entitySchemaSlug: "es-movie",
	providerId: "script-movie-tmdb",
});

const jellyfinIntegration = integrationRecord({
	provider: "jellyfin_push",
	providerSpecifics: { username: "ryot", password: "secret", baseUrl: "http://jellyfin.local" },
});

const schema = entitySchemaRecord({
	id: "es-movie",
	providers: [{ name: "TMDB", providerId: "script-movie-tmdb" }],
});

const createAutomation = (overrides: Parameters<typeof eventAutomationContext>[0] = {}) =>
	eventAutomationContext({
		properties: {},
		entityId: "movie-1",
		entitySchemaSlug: "movie",
		eventSchemaSlug: "complete",
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
			return playedFailure ? httpFailure("already played") : httpSuccess({});
		}
		return httpFailure();
	};

const createLog =
	(batches: (readonly LogEntry[])[]): JellyfinHost["log"] =>
	(entries) =>
		Effect.sync(() => {
			batches.push(entries);
			return null;
		});

const createHost = (options: {
	log?: JellyfinHost["log"];
	disableIntegrations?: boolean;
	httpCall: JellyfinHost["httpCall"];
	entity?: ReturnType<typeof entityRecord>;
	integrations?: ReturnType<typeof integrationRecord>[];
}) =>
	defineSandboxTestHost(manifest, {
		httpCall: options.httpCall,
		getEntitySchemas: () => hostSuccess([schema]),
		log: options.log ?? (() => Effect.succeed(null)),
		listIntegrations: () => hostSuccess(options.integrations ?? []),
		getUserPreferences: () =>
			hostSuccess({ disableIntegrations: options.disableIntegrations ?? false }),
		executeRyotql: () => {
			return options.entity ? hostSuccess(ryotqlRows("entities", [options.entity])) : hostFailure();
		},
	});

describe("jellyfin-push sandbox script", () => {
	it("does not contact Jellyfin for a completion created by history correction", () => {
		const calls: HttpCall[] = [];
		const host = createHost({
			entity: movieEntity,
			integrations: [jellyfinIntegration],
			httpCall: createHttpCall(calls, []),
		});
		return Effect.runPromise(
			definition
				.run(createAutomation({ properties: { completionSilent: true } }), host)
				.pipe(Effect.tap(() => Effect.sync(() => expect(calls).toEqual([])))),
		);
	});

	it("authenticates and marks the matching item as played", () => {
		const calls: HttpCall[] = [];
		const host = createHost({
			entity: movieEntity,
			integrations: [jellyfinIntegration],
			httpCall: createHttpCall(calls, [
				{ Id: "jf-item-1", Name: "The Matrix", ProviderIds: { Tmdb: "603" } },
			]),
		});
		return Effect.runPromise(
			definition.run(createAutomation(), host).pipe(
				Effect.map(() => {
					const markCall = calls.find((call) => call.url.includes("/PlayedItems/"));
					expect(markCall?.method).toBe("POST");
					expect(markCall?.url).toBe("http://jellyfin.local/Users/jf-user/PlayedItems/jf-item-1");
					expect(markCall?.options["headers"]).toEqual({ "X-Emby-Token": "jf-token" });
					return undefined;
				}),
			),
		);
	});

	it("no-ops when the item is absent, the entity is unsupported, or integrations are disabled", () => {
		const calls: HttpCall[] = [];
		const httpCall = createHttpCall(calls, []);
		return Effect.runPromise(
			Effect.all(
				[
					definition.run(
						createAutomation(),
						createHost({ httpCall, entity: movieEntity, integrations: [jellyfinIntegration] }),
					),
					definition.run(
						createAutomation({ entityId: "book-1", entitySchemaSlug: "book" }),
						createHost({ httpCall, entity: movieEntity, integrations: [jellyfinIntegration] }),
					),
					definition.run(
						createAutomation(),
						createHost({
							httpCall,
							entity: movieEntity,
							disableIntegrations: true,
							integrations: [jellyfinIntegration],
						}),
					),
				],
				{ concurrency: "unbounded" },
			).pipe(
				Effect.map(() => {
					expect(calls.some((call) => call.url.includes("/PlayedItems/"))).toBe(false);
					return undefined;
				}),
			),
		);
	});

	it.effect("treats a played-item HTTP failure as non-fatal", () =>
		Effect.gen(function* () {
			const calls: HttpCall[] = [];
			const warnings: (readonly LogEntry[])[] = [];
			const host = createHost({
				entity: movieEntity,
				log: createLog(warnings),
				integrations: [jellyfinIntegration],
				httpCall: createHttpCall(
					calls,
					[{ Id: "jf-item-1", Name: "The Matrix", ProviderIds: { Tmdb: "603" } }],
					true,
				),
			});
			const result = yield* definition.run(createAutomation(), host);
			expect(result).toBeNull();
			expect(warnings).toEqual([
				[
					{
						level: "warning",
						message: "Jellyfin push failed",
						attributes: { error: "already played" },
					},
				],
			]);
		}),
	);
});
