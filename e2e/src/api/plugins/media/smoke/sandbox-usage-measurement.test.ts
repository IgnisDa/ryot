import { Effect } from "effect";

import {
	createAuthenticatedClient,
	enqueueProviderEntityImport,
	findBuiltinSchemaBySlug,
	pollProviderEntityImportResult,
	searchProviderEntities,
} from "~/fixtures/kernel";
import { assertCompleted, assertCondition, assertPresent } from "~/support/assertions";
import { describe, it } from "~/support/effect-test";

const RUN_MEASUREMENT = process.env.RUN_SANDBOX_USAGE_MEASUREMENT === "1";

const workloads = [
	{ schema: "book", query: "The Hobbit", provider: "OpenLibrary" },
	{ schema: "anime", provider: "Anilist", query: "Cowboy Bebop" },
	{ schema: "manga", query: "Berserk", provider: "Anilist" },
	{ schema: "manga", query: "Berserk", provider: "MangaUpdates" },
	{ schema: "audiobook", provider: "Audible", query: "Project Hail Mary" },
	{ schema: "music", provider: "MusicBrainz", query: "Bohemian Rhapsody" },
	{ schema: "music", provider: "YouTube Music", query: "Bohemian Rhapsody" },
] as const;

describe.skipIf(!RUN_MEASUREMENT)("sandbox usage measurement (real external APIs)", () => {
	for (const workload of workloads) {
		it.live(
			`searches and imports ${workload.provider} ${workload.schema} results`,
			() =>
				Effect.gen(function* () {
					const { client } = yield* createAuthenticatedClient();
					const { schema } = yield* findBuiltinSchemaBySlug(client, workload.schema);
					const provider = schema.providers.find(
						(candidate) => candidate.name === workload.provider,
					);
					assertPresent(provider, `Expected the ${workload.provider} ${workload.schema} provider`);
					const search = yield* searchProviderEntities(client, {
						page: 1,
						pageSize: 10,
						query: workload.query,
						providerId: provider.providerId,
					});
					assertCondition(search.items.length > 0, `${workload.provider} returned no results`);
					for (const item of search.items.slice(0, 3)) {
						const { jobId } = yield* enqueueProviderEntityImport(client, {
							externalId: item.externalId,
							providerId: search.providerId,
						});
						assertCompleted(
							yield* pollProviderEntityImportResult(client, jobId),
							`${workload.provider} import`,
						);
					}
				}),
			300_000,
		);
	}
});
