import { describe, expect, it } from "@effect/vitest";
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
		tagIds: [5, 8],
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
		properties: { relationshipId: "rel-1", relationshipProperties: {}, ...properties },
		subject: { id: "collection-1", name: "Collection", entitySchemaSlug: "collection" },
	});

const createHttpCall =
	(calls: HttpCall[]): SonarrHost["httpCall"] =>
	(method, url, options) => {
		calls.push({ url, method, options: toRecord(options) });
		return httpSuccess({});
	};

const createLog =
	(batches: (readonly LogEntry[])[]): SonarrHost["log"] =>
	(entries) =>
		Effect.sync(() => {
			batches.push(entries);
			return null;
		});

const createHost = (options: {
	httpCall: SonarrHost["httpCall"];
	log?: SonarrHost["log"];
	entity?: ReturnType<typeof entityRecord> | null;
	integrations?: ReturnType<typeof integrationRecord>[];
}) =>
	defineSandboxTestHost(manifest, {
		httpCall: options.httpCall,
		getEntitySchemas: () => hostSuccess([schema]),
		log: options.log ?? (() => Effect.succeed(null)),
		listIntegrations: () => hostSuccess(options.integrations ?? []),
		getUserPreferences: () => hostSuccess({ allowNsfw: false, disableIntegrations: false }),
		executeRyotql: () =>
			options.entity ? hostSuccess(ryotqlRows("entities", [options.entity])) : hostFailure(),
	});

describe("sonarr-push sandbox script", () => {
	it("adds a TVDB show with the configured Sonarr tag ids", () => {
		const calls: HttpCall[] = [];
		const host = createHost({
			entity: showEntity,
			httpCall: createHttpCall(calls),
			integrations: [sonarrIntegration],
		});
		return Effect.runPromise(
			definition
				.run(createAutomation({ entityId: "show-1", entitySchemaSlug: "show" }), host, execution)
				.pipe(
					Effect.map(() => {
						expect(calls).toHaveLength(1);
						expect(calls[0]?.url).toBe("http://sonarr.local/api/v3/series");
						expect(JSON.parse(String(calls[0]?.options["body"]))).toEqual({
							tags: [5, 8],
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
						createAutomation({ entityId: "movie-1", entitySchemaSlug: "movie" }),
						createHost({ httpCall, entity: showEntity, integrations: [sonarrIntegration] }),
						execution,
					),
					definition.run(
						createAutomation({ entityId: "show-1", entitySchemaSlug: "show" }),
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

	it.effect("treats an expected Sonarr HTTP failure as non-fatal", () =>
		Effect.gen(function* () {
			const warnings: (readonly LogEntry[])[] = [];
			const host = createHost({
				entity: showEntity,
				log: createLog(warnings),
				integrations: [sonarrIntegration],
				httpCall: () => httpFailure("already exists"),
			});
			const result = yield* definition.run(
				createAutomation({ entityId: "show-1", entitySchemaSlug: "show" }),
				host,
				execution,
			);
			expect(result).toBeNull();
			expect(warnings).toEqual([
				[
					{
						level: "warning",
						message: "Sonarr push failed",
						attributes: { error: "already exists" },
					},
				],
			]);
		}),
	);
});
