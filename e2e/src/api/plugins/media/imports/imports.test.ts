import { EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { mediaPlugin } from "@ryot-app/media-plugin";
import { stringContaining } from "@ryot-app/testing/matchers";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect, Schema } from "effect";

import {
	createAuthenticatedClient,
	fakeProviderDetailsResult,
	getGlobalEntityByProvenance,
	getImportRun,
	listEventsForEntity,
	listEventSlugs,
	pollImportRunUntilTerminal,
	shippedPluginTestProviders,
	uploadImportFile,
	waitForEventSlugs,
} from "~/fixtures/kernel";
import {
	findMediaEntitySchema,
	queryInMediaLibraryRelationship,
	seedGlobalShowEpisodeTree,
	seedMediaEntity,
} from "~/fixtures/plugins/media";
import { assertCompleted } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it, runPromise } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";
import { startIsolatedHarness } from "~/support/isolated-harness";

describe("Watcharr Show Import E2E (episode resolution)", () => {
	it.live(
		"attaches per-episode history to the episode entity and drops unresolvable locators",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { pluginId } = yield* findMediaEntitySchema(client, "show");

				// Pre-seed an already-populated show → season → episode tree so the import
				// resolves the episode positionally without any external provider calls.
				const { tmdbId, showId, episodeId } = yield* seedGlobalShowEpisodeTree(client, {
					showName: "Test Show",
				});

				// One resolvable watched episode (S1E2) and one unresolvable locator (S1E99).
				const watcharrExport = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))([
					{
						rating: 4,
						activity: [],
						thoughts: "",
						pinned: false,
						status: "WATCHING",
						content: { type: "tv", title: "Test Show", tmdbId: Number(tmdbId) },
						watchedEpisodes: [
							{
								seasonNumber: 1,
								episodeNumber: 2,
								status: "FINISHED",
								createdAt: "2026-01-01T00:00:00Z",
							},
							{
								seasonNumber: 1,
								episodeNumber: 99,
								status: "FINISHED",
								createdAt: "2026-01-01T00:00:00Z",
							},
						],
					},
				]);
				const uploadToken = yield* uploadImportFile(
					client,
					watcharrExport,
					"watcharr.json",
					"application/json",
				);
				const created = yield* client.call((c) =>
					c.imports.createRun({
						payload: {
							uploadToken,
							source: { slug: "watcharr", owner: { pluginId, kind: "plugin" } },
						},
					}),
				);
				const completedRun = yield* pollImportRunUntilTerminal(client, created.id);
				const membership = yield* queryInMediaLibraryRelationship(client, showId, "show");
				expect(
					membership.data.entity?.type === "rows" ? membership.data.entity.items : [],
				).toHaveLength(1);

				expect(completedRun).toMatchObject({ status: "completed", failureReason: null });
				expect(completedRun.activities.every(({ state }) => state === "completed")).toBe(true);

				// The resolvable episode's progress lands on the episode, never the show.
				const episodeEvents = yield* waitForEventSlugs(client, episodeId, "progress");
				const showEvents = yield* listEventSlugs(client, showId);
				expect(episodeEvents).toContain(EventSchemaSlug.make("progress"));
				expect(showEvents).not.toContain("progress");
				const reviews = yield* listEventsForEntity(client, showId, undefined, 20, {
					eventSchemaSlug: "review",
				});
				expect(reviews.map(({ properties }) => properties)).toMatchObject([{ rating: 40 }]);

				// The unresolvable locator is reported as a failure, not mis-attached.
				const runWithFailures = yield* getImportRun(client, created.id, undefined, 20);
				expect(
					runWithFailures.issues.items.some(
						({ data }) => data.reason.code === "provider-resolution-failed",
					),
				).toBe(true);
			}),
	);
});

describe("Jellyfin import completion dates", () => {
	it.live("imports an undated watched episode without inventing a completion date", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginId } = yield* findMediaEntitySchema(client, "show");
			const { tmdbId, episodeId } = yield* seedGlobalShowEpisodeTree(client, {
				showName: "Undated Jellyfin Show",
			});
			const server = yield* startFakeHttpServerScoped((url) => {
				if (url.pathname === "/Users/AuthenticateByName") {
					return Response.json({ AccessToken: "fixture-token", User: { Id: "fixture-user" } });
				}
				if (url.pathname === "/Shows/fixture-series/Episodes") {
					return Response.json({
						Items: [
							{
								IndexNumber: 2,
								Name: "Episode",
								ParentIndexNumber: 1,
								Id: "fixture-episode",
								UserData: { LastPlayedDate: null },
							},
						],
					});
				}
				if (url.pathname === "/Users/fixture-user/Items") {
					return Response.json({
						Items:
							url.searchParams.get("IncludeItemTypes") === "Series"
								? [
										{
											Id: "fixture-series",
											Name: "Undated Jellyfin Show",
											ProviderIds: { Tmdb: tmdbId },
										},
									]
								: [],
					});
				}
				return new Response("Unexpected fixture request", { status: 404 });
			});
			const created = yield* client.call((c) =>
				c.imports.createRun({
					payload: {
						apiUrl: server.url,
						username: "fixture-user",
						password: "fixture-password",
						source: { slug: "jellyfin", owner: { pluginId, kind: "plugin" } },
					},
				}),
			);
			assertCompleted(
				yield* pollImportRunUntilTerminal(client, created.id),
				"Undated Jellyfin import",
			);
			const completions = yield* listEventsForEntity(client, episodeId, undefined, 20, {
				eventSchemaSlug: "complete",
			});
			expect(completions.map(({ properties }) => properties)).toMatchObject([
				{ dateUnknown: true },
			]);
			expect(completions[0]?.properties["completionMode"]).toBeUndefined();
		}),
	);
});

describe("Media history import of an unpopulated show", () => {
	let harness: undefined | Effect.Success<ReturnType<typeof startIsolatedHarness>>;
	let target: Effect.Success<ReturnType<typeof startIsolatedHarness>>["target"];
	let media: Effect.Success<ReturnType<typeof shippedPluginTestProviders>>;

	beforeAll(() =>
		runPromise(
			Effect.gen(function* () {
				harness = yield* startIsolatedHarness("Media History Import");
				target = harness.target;
				media = yield* shippedPluginTestProviders(mediaPlugin.metadata.packageId, target);
			}),
		),
	);

	afterAll(() => runPromise(harness?.stop ?? Effect.void));

	it.live("fetches the show, records the listed episode, and reports the unlisted one", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient(target);
			const { pluginId } = yield* findMediaEntitySchema(client, "show");
			const suffix = yield* randomUuid;
			const showExternalId = `history-show-${suffix}`;
			const episodeExternalId = `history-episode-${suffix}`;
			const provider = yield* media.attachProvider({
				rootEntitySchemaSlug: "show",
				details: fakeProviderDetailsResult({
					name: "History Show",
					properties: { productionStatus: "Ended" },
					childEntities: [
						{
							name: "Season 2",
							entitySchemaSlug: "show-season",
							properties: { seasonNumber: 2 },
							externalId: `history-season-${suffix}`,
							childEntities: [
								{
									name: "Episode 1",
									externalId: episodeExternalId,
									entitySchemaSlug: "show-episode",
									properties: { seasonNumber: 2, episodeNumber: 1 },
								},
							],
						},
					],
				}),
			});
			yield* seedMediaEntity({
				target,
				properties: {},
				name: "History Show",
				entitySchemaSlug: "show",
				externalId: showExternalId,
				providerId: provider.providerId,
			});
			const document = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))([
				{
					title: "History Show",
					entitySchemaSlug: "show",
					externalId: showExternalId,
					providerSlug: provider.providerSlug,
					events: [
						{
							eventSchemaSlug: "complete",
							occurredAt: "2024-01-02T00:00:00.000Z",
							episode: { type: "show", seasonNumber: 2, episodeNumber: 1 },
							properties: { sourceRun: "seen:listed", calendarDate: "2024-01-02" },
						},
						{
							eventSchemaSlug: "complete",
							occurredAt: "2024-01-03T00:00:00.000Z",
							episode: { type: "show", seasonNumber: 9, episodeNumber: 1 },
							properties: { dateUnknown: true, sourceRun: "seen:unlisted" },
						},
					],
				},
			]);
			const uploadToken = yield* uploadImportFile(
				client,
				document,
				"media-history.json",
				"application/json",
			);
			const created = yield* client.call((c) =>
				c.imports.createRun({
					payload: {
						uploadToken,
						source: { slug: "media-history", owner: { pluginId, kind: "plugin" } },
					},
				}),
			);
			assertCompleted(
				yield* pollImportRunUntilTerminal(client, created.id),
				"Media history import",
			);

			const episode = yield* getGlobalEntityByProvenance(client, {
				externalId: episodeExternalId,
				providerId: provider.providerId,
				entitySchemaSlug: "show-episode",
			});
			yield* waitForEventSlugs(client, episode.id, "complete");
			const completions = yield* listEventsForEntity(client, episode.id, undefined, 20, {
				eventSchemaSlug: "complete",
			});
			expect(completions.map(({ properties }) => properties)).toMatchObject([
				{ calendarDate: "2024-01-02", sourceRun: stringContaining('"seen:listed"]') },
			]);

			const run = yield* getImportRun(client, created.id, undefined, 20);
			expect(
				run.issues.items.flatMap(({ data }) =>
					data.reason.code === "provider-resolution-failed" ? [data.recordKind] : [],
				),
			).toEqual(["complete"]);
		}),
	);
});
