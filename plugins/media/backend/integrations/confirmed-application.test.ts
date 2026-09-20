import { assert, expect, it, afterEach } from "@effect/vitest";
import { DateTime, Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { genericImportChunkSchema } from "@ryot-app/sandbox-sdk/imports";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { TestClock } from "effect/testing";

import {
	execution,
	hostSuccess,
	httpSuccess,
	integrationRecord,
} from "../../tests/backend/automations/automation-test-utils";
import { mediaFilesystem, mediaFilesystemKey } from "../imports/ingestion.test-support";
import reader from "../imports/read-batch.sandbox";
import writer, { manifest as writerManifest } from "../imports/write-chunks.sandbox";
import type { MediaIntegrationConfirmation } from "./schemas";
import spotify, { manifest as spotifyManifest } from "./yanks/spotify.sandbox";
import { runYoutubeMusicYank, manifest as youtubeManifest } from "./yanks/youtube-music.sandbox";

afterEach(() => Reflect.deleteProperty(globalThis, mediaFilesystemKey));
const confirmation = (
	confirmed: (typeof MediaIntegrationConfirmation.Type)["confirmed"],
): typeof MediaIntegrationConfirmation.Type => ({
	part: 0,
	confirmed,
	final: true,
	runId: "run",
	batchId: "batch",
	inputFingerprint: "fingerprint",
});

it.effect(
	"preserves play attribution through artifacts and generic chunks, confirms only committed plays, and replays a failed confirmation without extending retention",
	() =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse("2026-01-01T12:00:00Z"));
			const fs = mediaFilesystem({});
			const saved = new Map<string, number>();
			const ttls: number[] = [];
			let requests = 0;
			let failClaim = false;
			const host = defineSandboxTestHost(spotifyManifest, {
				log: () => hostSuccess(null),
				span: () => hostSuccess(null),
				getCurrentIntegration: () =>
					hostSuccess(integrationRecord({ lot: "yank", provider: "spotify" })),
				getOAuthAccessToken: () =>
					hostSuccess({ accessToken: "token", expiresAt: "2026-01-02T00:00:00Z" }),
				getPersistentValue: (key) =>
					Effect.gen(function* () {
						const now = DateTime.toEpochMillis(yield* DateTime.now);
						return (saved.get(key) ?? 0) > now ? true : null;
					}),
				httpCall: () => {
					requests++;
					return httpSuccess({
						items: [0, 1, 2, 0].map((index) => ({
							played_at: `2026-01-01T11:0${index}:00Z`,
							track: { id: "track", name: "Song", duration_ms: 60000 },
						})),
					});
				},
				claimPersistentValue: (key, _value, ttl) =>
					Effect.gen(function* () {
						if (failClaim) {
							failClaim = false;
							return yield* Effect.fail({ message: "claim write failed" });
						}
						if (saved.has(key)) {
							return { value: true, claimed: false as const };
						}
						ttls.push(ttl);
						saved.set(key, DateTime.toEpochMillis(yield* DateTime.now) + ttl * 1000);
						return { claimed: true as const };
					}),
			});
			const output = yield* runSandboxTestScript(spotify, {}, host, {
				...execution,
				startedAt: "2026-01-01T12:00:00Z",
			});
			expect(output).toEqual({
				chunkFiles: ["records.jsonl"],
				advancedAt: "2026-01-01T12:00:00.000Z",
			});
			expect(saved.size).toBe(0);
			const source = yield* fs.records();
			expect(source).toHaveLength(3);
			const bytes = fs.scratch.get("records.jsonl");
			assert(bytes);
			fs.files.set("records", bytes);
			const prepared = yield* reader.run({
				offset: 0,
				itemIndex: 0,
				dedupKey: null,
				ingestionArtifacts: { runId: "run", captures: { records: "records" } },
			});
			const batch = fs.scratch.get("batch.json");
			assert(batch);
			fs.files.set("batch", batch);
			yield* writer.run(
				{
					...prepared.batch,
					ownershipSyncedAt: "2026-01-01T12:00:00Z",
					ingestionArtifacts: { runId: "run", captures: { batch: "batch" } },
					integration: { importRunId: "run", integrationId: "integration-1" },
					populationResults: prepared.batch.entityGroups.map((_group, index) => ({
						index,
						entityId: "music",
						status: "completed" as const,
					})),
				},
				defineSandboxTestHost(writerManifest, {
					log: () => hostSuccess(null),
					getPluginConfig: () => hostSuccess({}),
					executeRyotql: () => Effect.die("Complete plays must not use progress admission"),
					getCurrentIntegration: () => Effect.die("Complete plays must not load progress settings"),
				}),
			);
			const chunk = yield* Schema.decodeEffect(Schema.fromJsonString(genericImportChunkSchema))(
				new TextDecoder().decode(fs.scratch.get("writes.json")),
			);
			const events = chunk.items.flatMap((item) => item.events);
			expect(events.map((event) => event.attribution)).toEqual(
				source.flatMap(({ group }) => group?.events.map((event) => event.attribution) ?? []),
			);
			const first = events[0];
			const skipped = events[1];
			assert(first?.attribution && skipped?.attribution);
			const confirmed = confirmation([
				{
					reason: null,
					result: "created",
					operationId: first.operationId,
					attribution: first.attribution,
				},
				{
					result: "skipped",
					operationId: skipped.operationId,
					attribution: skipped.attribution,
					reason: { key: null, code: "event-policy" },
				},
			]);
			failClaim = true;
			expect(
				(yield* Effect.exit(
					runSandboxTestScript(spotify, { ingestionConfirmation: confirmed }, host, execution),
				))._tag,
			).toBe("Failure");
			expect(saved.size).toBe(0);
			yield* TestClock.adjust("1 hour");
			expect(
				yield* runSandboxTestScript(spotify, { ingestionConfirmation: confirmed }, host, execution),
			).toEqual({ chunkFiles: [] });
			yield* runSandboxTestScript(spotify, { ingestionConfirmation: confirmed }, host, execution);
			expect(saved.size).toBe(1);
			expect(ttls).toEqual([30 * 24 * 60 * 60 - 3600]);
			expect(requests).toBe(1);
			yield* runSandboxTestScript(spotify, {}, host, execution);
			expect(yield* fs.records()).toHaveLength(2);
		}),
);

it.effect(
	"keeps YouTube Music daily advancement provisional until confirmed, retries skips at 35, and completes directly in the final local-day window",
	() =>
		Effect.gen(function* () {
			const fs = mediaFilesystem({});
			const saved = new Map<string, number>();
			let fetched = 0;
			let historyDay = "January 1, 2026";
			const host = defineSandboxTestHost(youtubeManifest, {
				log: () => hostSuccess(null),
				span: () => hostSuccess(null),
				httpCall: () => Effect.die("Injected history owns fetching"),
				getPersistentValue: (key) =>
					Effect.gen(function* () {
						return (saved.get(key) ?? 0) > DateTime.toEpochMillis(yield* DateTime.now)
							? true
							: null;
					}),
				getCurrentIntegration: () =>
					hostSuccess(
						integrationRecord({
							lot: "yank",
							provider: "youtube_music",
							providerSpecifics: { timezone: "UTC", authCookie: "cookie" },
						}),
					),
				claimPersistentValue: (key, _value, ttl) =>
					Effect.gen(function* () {
						if (saved.has(key)) {
							return { value: true, claimed: false as const };
						}
						saved.set(key, DateTime.toEpochMillis(yield* DateTime.now) + ttl * 1000);
						return { claimed: true as const };
					}),
			});
			const factory = () =>
				Effect.succeed({
					getHistory: () => {
						fetched++;
						return Effect.succeed({
							contents: {
								singleColumnBrowseResultsRenderer: {
									tabs: [
										{
											tabRenderer: {
												content: {
													sectionListRenderer: {
														contents: [
															{
																musicShelfRenderer: {
																	title: { runs: [{ text: historyDay }] },
																	contents: ["a", "b"].map((videoId) => ({
																		musicResponsiveListItemRenderer: {
																			playlistItemData: { videoId },
																			flexColumns: [
																				{
																					musicResponsiveListItemFlexColumnRenderer: {
																						text: { runs: [{ text: videoId }] },
																					},
																				},
																			],
																		},
																	})),
																},
															},
														],
													},
												},
											},
										},
									],
								},
							},
						});
					},
				});
			const collect = Effect.fnUntraced(function* (startedAt: string) {
				yield* TestClock.setTime(Date.parse(startedAt));
				yield* runYoutubeMusicYank({}, host, { ...execution, startedAt }, factory);
				return (yield* fs.records()).flatMap(({ group }) => group?.events ?? []);
			});
			const initial = yield* collect("2026-01-01T12:00:00Z");
			expect(initial.map((event) => event.properties["progressPercent"])).toEqual([35, 35]);
			expect(saved.size).toBe(0);
			const confirmed = confirmation(
				initial.flatMap((event, index) =>
					event.operationId && event.attribution
						? [
								{
									reason: null,
									operationId: event.operationId,
									attribution: event.attribution,
									result: index === 0 ? ("created" as const) : ("skipped" as const),
								},
							]
						: [],
				),
			);
			yield* runYoutubeMusicYank({ ingestionConfirmation: confirmed }, host, execution, factory);
			yield* runYoutubeMusicYank({ ingestionConfirmation: confirmed }, host, execution, factory);
			expect(fetched).toBe(1);
			expect(saved.size).toBe(1);
			expect(
				(yield* collect("2026-01-01T12:05:00Z")).map(
					(event) => event.properties["progressPercent"],
				),
			).toEqual([100, 35]);
			const final = yield* collect("2026-01-01T23:50:00Z");
			expect(final.map((event) => event.properties["progressPercent"])).toEqual([100, 100]);
			yield* runYoutubeMusicYank(
				{
					ingestionConfirmation: confirmation(
						final.flatMap((event) =>
							event.operationId && event.attribution
								? [
										{
											reason: null,
											result: "created" as const,
											operationId: event.operationId,
											attribution: event.attribution,
										},
									]
								: [],
						),
					),
				},
				host,
				execution,
				factory,
			);
			expect(yield* collect("2026-01-01T23:55:00Z")).toEqual([]);
			expect([...saved.values()]).toEqual(Array(4).fill(Date.parse("2026-01-02T00:00:00Z")));
			historyDay = "January 2, 2026";
			expect(
				(yield* collect("2026-01-02T12:00:00Z")).map(
					(event) => event.properties["progressPercent"],
				),
			).toEqual([35, 35]);
			yield* runYoutubeMusicYank({ ingestionConfirmation: confirmed }, host, execution, factory);
			expect(saved.size).toBe(4);
			expect(
				(yield* collect("2026-01-02T12:05:00Z")).map(
					(event) => event.properties["progressPercent"],
				),
			).toEqual([35, 35]);
		}),
);
