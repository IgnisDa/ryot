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
import definition, { manifest } from "./sonarr-push.sandbox";

type SonarrHost = SandboxHost<typeof manifest.capabilities>;
type HttpCall = { url: string; method: string; options: Record<string, unknown> };

const showEntity = entityRecord({
	id: "show-1",
	name: "Severance",
	externalId: "371980",
	entitySchemaSlug: "es-show",
	providerId: "script-show-tvdb",
});

const sonarrIntegration = integrationRecord({
	provider: "sonarr",
	providerSpecifics: {
		tagIds: 5,
		profileId: "2",
		apiKey: "sonarr-key",
		rootFolderPath: "/tv",
		baseUrl: "http://sonarr.local/",
		syncCollectionIds: ["collection-1"],
	},
});

const schema = entitySchemaRecord({
	id: "es-show",
	providers: [
		{ name: "TMDB", providerId: "script-show-tmdb" },
		{ name: "TVDB", providerId: "script-show-tvdb" },
	],
});

const createAutomation = (properties: Record<string, string>) =>
	eventAutomationContext({
		eventSchemaSlug: "add-entity-to-collection",
		subject: { id: "collection-1", name: "Collection", entitySchemaSlug: "collection" },
		properties: { relationshipId: "rel-1", relationshipProperties: {}, ...properties },
	});

const createHttpCall =
	(calls: HttpCall[]): SonarrHost["httpCall"] =>
	(method, url, options) => {
		calls.push({ url, method, options: toRecord(options) });
		return httpSuccess({});
	};

const createHost = (options: {
	httpCall: SonarrHost["httpCall"];
	entity?: ReturnType<typeof entityRecord> | null;
	integrations?: ReturnType<typeof integrationRecord>[];
}) =>
	defineSandboxTestHost(manifest, {
		httpCall: options.httpCall,
		getEntitySchemas: () => hostSuccess([schema]),
		listIntegrations: () => hostSuccess(options.integrations ?? []),
		getUserPreferences: () => hostSuccess({ isNsfw: false, disableIntegrations: false }),
		executeQueryEngine: () =>
			options.entity ? hostSuccess(queryEngineRows([options.entity])) : hostFailure(),
	});

describe("sonarr-push sandbox script", () => {
	it("adds a TVDB show and wraps the single Sonarr tag id in an array", () => {
		const calls: HttpCall[] = [];
		const host = createHost({
			entity: showEntity,
			integrations: [sonarrIntegration],
			httpCall: createHttpCall(calls),
		});
		return Effect.runPromise(
			definition
				.run(createAutomation({ entitySchemaSlug: "show", entityId: "show-1" }), host, execution)
				.pipe(
					Effect.map(() => {
						expect(calls).toHaveLength(1);
						expect(calls[0]?.url).toBe("http://sonarr.local/api/v3/series");
						expect(JSON.parse(String(calls[0]?.options["body"]))).toEqual({
							tags: [5],
							tvdbId: 371980,
							monitored: true,
							qualityProfileId: 2,
							rootFolderPath: "/tv",
							addOptions: { searchForMissingEpisodes: true },
						});
						return undefined;
					}),
				),
		);
	});

	it("no-ops for non-shows and non-TVDB entities", () => {
		const calls: HttpCall[] = [];
		const httpCall = createHttpCall(calls);
		return Effect.runPromise(
			Effect.all(
				[
					definition.run(
						createAutomation({ entitySchemaSlug: "movie", entityId: "movie-1" }),
						createHost({ entity: showEntity, integrations: [sonarrIntegration], httpCall }),
						execution,
					),
					definition.run(
						createAutomation({ entitySchemaSlug: "show", entityId: "show-1" }),
						createHost({
							httpCall,
							integrations: [sonarrIntegration],
							entity: entityRecord({ ...showEntity, providerId: "script-show-tmdb" }),
						}),
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

	it("treats an expected Sonarr HTTP failure as non-fatal", () => {
		const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const host = createHost({
			entity: showEntity,
			integrations: [sonarrIntegration],
			httpCall: () => httpFailure("already exists", 400),
		});
		return Effect.runPromise(
			definition
				.run(createAutomation({ entitySchemaSlug: "show", entityId: "show-1" }), host, execution)
				.pipe(
					Effect.map((result) => {
						expect(result).toBeNull();
						expect(warning).toHaveBeenCalledWith("Sonarr push failed: already exists");
						warning.mockRestore();
						return undefined;
					}),
				),
		);
	});
});
