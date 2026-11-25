import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { mediaCopiesRecipe } from "@ryot-app/media-plugin/shared/media-copy-recipes";
import { startFakeHttpServerScoped } from "@ryot-app/testing/fake-http-server";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createIntegration,
	deleteIntegration,
	listIntegrationImportRuns,
	markEntityPopulated,
	pollImportRunUntilTerminal,
} from "~/fixtures/kernel";
import { pollUntil } from "~/fixtures/kernel/polling";
import {
	findMediaEntitySchema,
	insertOwnedCopy,
	mediaRecipes,
	randomNumericExternalId,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
import { assertCompleted, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const digitalVersion = (id: string, width: number, interlaced?: boolean) => ({
	Id: id,
	MediaStreams: [{ Width: width, Type: "Video", IsInterlaced: interlaced }],
});

describe("Media server inventory", () => {
	it.live(
		"reconciles missing versions only after a complete scan and preserves manual copies",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { schema, pluginId } = yield* findMediaEntitySchema(client, "movie");
				const provider = requirePresent(
					schema.providers.find(({ providerSlug }) => providerSlug === "movie.tmdb"),
					"Expected TMDB movie provider",
				);
				const externalId = yield* randomNumericExternalId;
				const title = yield* seedMediaEntity({
					externalId,
					userId: null,
					properties: {},
					entitySchemaSlug: schema.id,
					name: "Copy inventory fixture",
					providerId: provider.providerId,
				});
				yield* markEntityPopulated(title.id);
				yield* insertOwnedCopy(client, title.id);

				const movie = {
					Type: "Movie",
					Id: "original",
					Name: title.name,
					ProviderIds: { Tmdb: externalId },
				};
				let phase: "first" | "partial" | "complete" = "first";
				const upstream = yield* startFakeHttpServerScoped((url) => {
					if (url.pathname !== "/Items") {
						return new Response(null, { status: 404 });
					}
					const versions = [digitalVersion("hd", 1920, phase === "complete" ? undefined : false)];
					if (phase === "first") {
						versions.push(digitalVersion("uhd", 3840));
					}
					const items = [{ ...movie, MediaSources: versions }];
					if (phase === "partial") {
						items.push({ ...movie, MediaSources: [], Id: "unavailable" });
					}
					return Response.json({ Items: items, TotalRecordCount: items.length });
				});
				const integration = yield* Effect.acquireRelease(
					createIntegration(client, {
						minimumProgress: 2,
						maximumProgress: 95,
						provider: { slug: "jellyfin_inventory", owner: definitionOwner(pluginId) },
						providerSpecifics: {
							apiKey: "test-key",
							userId: "test-user",
							baseUrl: upstream.url,
							kind: "jellyfin_inventory",
						},
					}),
					({ id }) => deleteIntegration(client, id).pipe(Effect.asVoid, Effect.orDie),
				);
				const seen = new Set<string>();
				const sync = Effect.gen(function* () {
					yield* client.call((contract) => contract.integrations.sync());
					const runId = yield* pollUntil(
						"new inventory run",
						listIntegrationImportRuns(client, integration.id, undefined, 100).pipe(
							Effect.map(({ items }) => items.find(({ id }) => !seen.has(id))?.id ?? null),
						),
					);
					seen.add(runId);
					return yield* pollImportRunUntilTerminal(client, runId);
				});
				const inventory = mediaRecipes.execute(
					client,
					mediaCopiesRecipe({ pluginId, kind: "local" }),
					{ entityId: title.id },
				);
				const copies = inventory.pipe(
					Effect.map(({ items }) =>
						items.map(({ properties }) => properties.resolution ?? properties.origin).sort(),
					),
				);
				const scanType = inventory.pipe(
					Effect.map(
						({ items }) =>
							items.find(({ properties }) => properties.resolution === "1080")?.properties.scanType,
					),
				);

				assertCompleted(yield* sync, "first Jellyfin inventory scan");
				expect(yield* copies).toEqual(["1080", "2160", "manual"]);
				expect(yield* scanType).toBe("progressive");
				phase = "partial";
				yield* sync;
				expect(yield* copies).toEqual(["1080", "2160", "manual"]);
				phase = "complete";
				assertCompleted(yield* sync, "complete Jellyfin inventory scan");
				expect(yield* copies).toEqual(["1080", "manual"]);
				expect(yield* scanType).toBeUndefined();
			}),
	);
});
