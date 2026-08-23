import { describe, expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { LogEntry, SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";

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
	ryotqlRows,
	toRecord,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./jellyfin-push.sandbox";

type JellyfinHost = SandboxHost<typeof manifest.capabilities>;
type HttpCall = { url: string; method: string; options: Record<string, unknown> };

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
		eventSchemaSlug: "complete",
		properties: { completionMode: "just_now" },
		subject: { id: "movie-1", name: "The Matrix", entitySchemaSlug: "movie" },
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
	disableIntegrations?: boolean;
	httpCall: JellyfinHost["httpCall"];
	log?: JellyfinHost["log"];
	entity?: ReturnType<typeof entityRecord>;
	integrations?: ReturnType<typeof integrationRecord>[];
}) =>
	defineSandboxTestHost(manifest, {
		httpCall: options.httpCall,
		log: options.log ?? (() => Effect.succeed(null)),
		getEntitySchemas: () => hostSuccess([schema]),
		listIntegrations: () => hostSuccess(options.integrations ?? []),
		executeRyotql: () =>
			options.entity ? hostSuccess(ryotqlRows("entities", [options.entity])) : hostFailure(),
		getUserPreferences: () =>
			hostSuccess({ allowNsfw: false, disableIntegrations: options.disableIntegrations ?? false }),
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
		return Effect.runPromise(
			definition.run(createAutomation(), host, execution).pipe(
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
						createHost({ entity: movieEntity, integrations: [jellyfinIntegration], httpCall }),
						execution,
					),
					definition.run(
						createAutomation({ subject: { id: "book-1", name: "Book", entitySchemaSlug: "book" } }),
						createHost({ entity: movieEntity, integrations: [jellyfinIntegration], httpCall }),
						execution,
					),
					definition.run(
						createAutomation(),
						createHost({
							httpCall,
							entity: movieEntity,
							disableIntegrations: true,
							integrations: [jellyfinIntegration],
						}),
						execution,
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
				integrations: [jellyfinIntegration],
				httpCall: createHttpCall(
					calls,
					[{ Id: "jf-item-1", Name: "The Matrix", ProviderIds: { Tmdb: "603" } }],
					true,
				),
				log: createLog(warnings),
			});
			const result = yield* definition.run(createAutomation(), host, execution);
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
