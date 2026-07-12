import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot/sandbox-sdk/testing";
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
	queryEngineRows,
	toRecord,
} from "./automation-test-utils";
import definition, { manifest } from "./radarr-push.sandbox";

type RadarrHost = SandboxHost<typeof manifest.capabilities>;
type HttpCall = { url: string; method: string; options: Record<string, unknown> };

const movieEntity = entityRecord({
	id: "movie-1",
	externalId: "603",
	name: "The Matrix",
	entitySchemaSlug: "es-movie",
	providerId: "script-movie-tmdb",
});

const radarrIntegration = integrationRecord({
	provider: "radarr",
	providerSpecifics: {
		profileId: "4",
		tagIds: [3, 7],
		apiKey: "radarr-key",
		rootFolderPath: "/movies",
		baseUrl: "http://radarr.local",
		syncCollectionIds: ["collection-1"],
	},
});

const schema = entitySchemaRecord({
	id: "es-movie",
	providers: [
		{ name: "TVDB", providerId: "script-movie-tvdb" },
		{ name: "TMDB", providerId: "script-movie-tmdb" },
	],
});

const createAutomation = (properties: Record<string, string>) =>
	eventAutomationContext({
		eventSchemaSlug: "add-entity-to-collection",
		subject: { id: "collection-1", name: "Collection", entitySchemaSlug: "collection" },
		properties: { relationshipId: "rel-1", relationshipProperties: {}, ...properties },
	});

const createHttpCall =
	(calls: HttpCall[]): RadarrHost["httpCall"] =>
	(method, url, options) => {
		calls.push({ url, method, options: toRecord(options) });
		return httpSuccess({});
	};

const createHost = (options: {
	disableIntegrations?: boolean;
	httpCall: RadarrHost["httpCall"];
	entity?: ReturnType<typeof entityRecord> | null;
	integrations?: ReturnType<typeof integrationRecord>[];
}) =>
	defineSandboxTestHost(manifest, {
		httpCall: options.httpCall,
		getEntitySchemas: () => hostSuccess([schema]),
		listIntegrations: () => hostSuccess(options.integrations ?? []),
		executeQueryEngine: () =>
			options.entity ? hostSuccess(queryEngineRows([options.entity])) : hostFailure(),
		getUserPreferences: () =>
			hostSuccess({ isNsfw: false, disableIntegrations: options.disableIntegrations ?? false }),
	});

describe("radarr-push sandbox script", () => {
	it("adds a TMDB movie to each matching Radarr integration", () => {
		const calls: HttpCall[] = [];
		const host = createHost({
			entity: movieEntity,
			httpCall: createHttpCall(calls),
			integrations: [radarrIntegration],
		});
		return Effect.runPromise(
			definition
				.run(createAutomation({ entitySchemaSlug: "movie", entityId: "movie-1" }), host, execution)
				.pipe(
					Effect.map(() => {
						expect(calls).toHaveLength(1);
						expect(calls[0]?.method).toBe("POST");
						expect(calls[0]?.url).toBe("http://radarr.local/api/v3/movie");
						expect(calls[0]?.options["headers"]).toEqual({
							"X-Api-Key": "radarr-key",
							"Content-Type": "application/json",
						});
						expect(JSON.parse(String(calls[0]?.options["body"]))).toEqual({
							tmdbId: 603,
							tags: [3, 7],
							monitored: true,
							qualityProfileId: 4,
							rootFolderPath: "/movies",
							addOptions: { searchForMovie: true },
						});
						return undefined;
					}),
				),
		);
	});

	it("no-ops for non-movies, non-TMDB entities, and unmatched collections", () => {
		const calls: HttpCall[] = [];
		const httpCall = createHttpCall(calls);
		const base = { integrations: [radarrIntegration], httpCall };
		const unmatched = integrationRecord({
			provider: "radarr",
			providerSpecifics: {
				tagIds: [3, 7],
				profileId: "4",
				apiKey: "radarr-key",
				rootFolderPath: "/movies",
				syncCollectionIds: ["other"],
				baseUrl: "http://radarr.local",
			},
		});
		return Effect.runPromise(
			Effect.all(
				[
					definition.run(
						createAutomation({ entitySchemaSlug: "show", entityId: "show-1" }),
						createHost({ ...base, entity: movieEntity }),
						execution,
					),
					definition.run(
						createAutomation({ entitySchemaSlug: "movie", entityId: "movie-1" }),
						createHost({
							...base,
							entity: entityRecord({ ...movieEntity, providerId: "script-movie-tvdb" }),
						}),
						execution,
					),
					definition.run(
						createAutomation({ entitySchemaSlug: "movie", entityId: "movie-1" }),
						createHost({ entity: movieEntity, httpCall, integrations: [unmatched] }),
						execution,
					),
				],
				{ concurrency: "unbounded" },
			).pipe(
				Effect.map(() => {
					expect(calls).toHaveLength(0);
					return undefined;
				}),
			),
		);
	});

	it("honors the user's disabled-integration preference", () => {
		const calls: HttpCall[] = [];
		const host = createHost({
			entity: movieEntity,
			disableIntegrations: true,
			httpCall: createHttpCall(calls),
			integrations: [radarrIntegration],
		});
		return Effect.runPromise(
			definition
				.run(createAutomation({ entitySchemaSlug: "movie", entityId: "movie-1" }), host, execution)
				.pipe(
					Effect.map(() => {
						expect(calls).toHaveLength(0);
						return undefined;
					}),
				),
		);
	});

	it("treats an expected Radarr HTTP failure as non-fatal", () => {
		const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const host = createHost({
			entity: movieEntity,
			integrations: [radarrIntegration],
			httpCall: () => httpFailure("already exists"),
		});
		return Effect.runPromise(
			definition
				.run(createAutomation({ entitySchemaSlug: "movie", entityId: "movie-1" }), host, execution)
				.pipe(
					Effect.map((result) => {
						expect(result).toBeNull();
						expect(warning).toHaveBeenCalledWith("Radarr push failed: already exists");
						warning.mockRestore();
						return undefined;
					}),
				),
		);
	});
});
