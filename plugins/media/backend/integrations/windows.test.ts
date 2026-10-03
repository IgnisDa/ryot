import { afterEach, assert, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { TestClock } from "effect/testing";

import {
	execution,
	hostSuccess,
	httpSuccess,
	integrationRecord,
} from "../../tests/backend/automations/automation-test-utils";
import { mediaFilesystem, resetMediaFilesystem } from "../imports/ingestion.test-support";
import plex, { manifest } from "./yanks/plex.sandbox";
import { runYoutubeMusicYank, manifest as youtubeManifest } from "./yanks/youtube-music.sandbox";

afterEach(resetMediaFilesystem);
it.effect(
	"retains the YouTube Music collection day across captured windows without fetching history or reading changed settings again",
	() =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse("2026-01-01T12:00:00Z"));
			const fs = mediaFilesystem({});
			let settingsReads = 0;
			let fetched = 0;
			const host = defineSandboxTestHost(youtubeManifest, {
				log: () => hostSuccess(null),
				span: () => hostSuccess(null),
				getPersistentValue: () => hostSuccess(null),
				httpCall: () => Effect.die("Injected history owns fetching"),
				claimPersistentValue: () => Effect.die("Collection must not claim source completion"),
				getCurrentIntegration: () => {
					settingsReads++;
					return hostSuccess(
						integrationRecord({
							providerSpecifics: {
								authCookie: "cookie",
								timezone: settingsReads === 1 ? "UTC" : "Not/AZone",
							},
						}),
					);
				},
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
																	title: { runs: [{ text: "January 1, 2026" }] },
																	contents: Array.from({ length: 130 }, (_, index) => ({
																		musicResponsiveListItemRenderer: {
																			playlistItemData: { videoId: String(index) },
																			flexColumns: [
																				{
																					musicResponsiveListItemFlexColumnRenderer: {
																						text: { runs: [{ text: String(index) }] },
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
			const first = yield* runYoutubeMusicYank(
				{},
				host,
				{ ...execution, startedAt: "2026-01-01T12:00:00Z" },
				factory,
			);
			expect(yield* fs.records()).toHaveLength(100);
			assert(first.carryFile);
			const carry = fs.scratch.get(first.carryFile);
			assert(carry);
			fs.files.set("carry", carry.slice());
			yield* TestClock.adjust("14 hours");
			const final = yield* runYoutubeMusicYank(
				{ ingestionArtifacts: { runId: "run", captures: { carry: "durable-carry" } } },
				host,
				{ ...execution, startedAt: "2026-01-02T02:00:00Z" },
				factory,
			);
			expect(final.carryFile).toBeNull();
			const records = yield* fs.records();
			expect(records).toHaveLength(30);
			expect(records.map((record) => record.itemIndex)).toEqual(
				Array.from({ length: 30 }, (_, index) => 100 + index),
			);
			expect(
				records.every((record) => record.group?.events[0]?.occurredAt === "2026-01-01T12:00:00Z"),
			).toBe(true);
			expect(settingsReads).toBe(1);
			expect(fetched).toBe(1);
		}),
);
it.live(
	"captures a library larger than the activity scratch budget through bounded durable windows without refetching its listing",
	() =>
		Effect.gen(function* () {
			const fs = mediaFilesystem({});
			const requests: string[] = [];
			const host = defineSandboxTestHost(manifest, {
				getCurrentIntegration: () =>
					hostSuccess(
						integrationRecord({
							providerSpecifics: { token: "token", baseUrl: "https://plex.test" },
						}),
					),
				httpCall: (_method, url) => {
					requests.push(url);
					return url.endsWith("/library/sections")
						? httpSuccess({ MediaContainer: { Directory: [{ key: "movies", type: "movie" }] } })
						: httpSuccess({
								MediaContainer: {
									Metadata: Array.from({ length: 60 }, (_, index) => ({
										ratingKey: index,
										lastViewedAt: 1767225600,
										title: "\u0000".repeat(8000),
										Guid: [{ id: `tmdb://${index}` }],
									})),
								},
							});
				},
			});
			let total = 0;
			let windows = 0;
			for (;;) {
				const output = yield* runSandboxTestScript(
					plex,
					windows
						? { ingestionArtifacts: { runId: "run", captures: { carry: "durable-carry" } } }
						: {},
					host,
					execution,
				);
				const records = fs.scratch.get("records.jsonl");
				assert(records);
				total += records.length;
				expect(records.length).toBeLessThan(256 * 1024);
				windows++;
				if (!output.carryFile) {
					break;
				}
				const carry = fs.scratch.get(output.carryFile);
				assert(carry);
				expect(carry.length).toBeLessThanOrEqual(4 * 1024 * 1024);
				expect(carry.length + records.length).toBeLessThanOrEqual(5 * 1024 * 1024);
				fs.files.set("carry", carry.slice());
			}
			expect(total).toBeGreaterThan(5 * 1024 * 1024);
			expect(windows).toBe(60);
			expect(requests).toEqual([
				"https://plex.test/library/sections",
				"https://plex.test/library/sections/movies/all?includeGuids=1",
			]);
		}),
);

it.live(
	"captures large episode sets once and preserves equal-time source ordering and operation identities across continuation windows",
	() =>
		Effect.gen(function* () {
			const fs = mediaFilesystem({});
			const requests: string[] = [];
			const host = defineSandboxTestHost(manifest, {
				getCurrentIntegration: () =>
					hostSuccess(
						integrationRecord({
							providerSpecifics: { token: "token", baseUrl: "https://plex.test" },
						}),
					),
				httpCall: (_method, url) => {
					requests.push(url);
					if (url.endsWith("/library/sections")) {
						return httpSuccess({ MediaContainer: { Directory: [{ key: "shows", type: "show" }] } });
					}
					if (url.includes("allLeaves")) {
						return httpSuccess({
							MediaContainer: {
								Metadata: Array.from({ length: 300 }, (_, index) => ({
									parentIndex: 1,
									index: index + 1,
									lastViewedAt: 1767225600,
									title: `Episode ${index}`,
									ratingKey: `episode-${index}`,
								})),
							},
						});
					}
					return httpSuccess({
						MediaContainer: {
							Metadata: [
								{
									title: "Show",
									ratingKey: "show",
									lastViewedAt: 1767225600,
									Guid: [{ id: "tmdb://42" }],
								},
							],
						},
					});
				},
			});
			const indexes: number[] = [];
			const operations: string[] = [];
			for (let window = 0; ; window++) {
				const output = yield* runSandboxTestScript(
					plex,
					window
						? { ingestionArtifacts: { runId: "run", captures: { carry: "durable-carry" } } }
						: {},
					host,
					execution,
				);
				for (const record of yield* fs.records()) {
					indexes.push(record.eventIndex);
					const event = record.group?.events[0];
					assert(event?.operationId);
					operations.push(event.operationId);
				}
				if (!output.carryFile) {
					break;
				}
				const carry = fs.scratch.get(output.carryFile);
				assert(carry);
				fs.files.set("carry", carry.slice());
			}
			expect(indexes).toEqual(Array.from({ length: 300 }, (_, index) => index));
			expect(new Set(operations).size).toBe(300);
			expect(requests).toHaveLength(3);
		}),
);
