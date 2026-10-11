import { describe, expect, it } from "@effect/vitest";
import { EventId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type {
	CreateEventItem,
	DomainSandboxHostMethodMap,
} from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import type { MediaActivityEntry } from "../../shared/media-activity-operations";
import { execution } from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./media-activity-log.sandbox";

type CreateEventOptions = NonNullable<Parameters<DomainSandboxHostMethodMap["createEvents"]>[1]>;

const submittedAt = "2026-03-10T09:00:00.000Z";

const page = (items: readonly unknown[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 500, hasMore: false, nextCursor: null },
});

const written = (items: readonly CreateEventItem[]) => ({
	count: items.length,
	outcomes: items.map((_, index) => ({
		index,
		status: "written" as const,
		eventId: EventId.make(`event-${index}`),
	})),
});

const recordingHost = (input: {
	readonly failSettings?: "read" | "write" | undefined;
	readonly settings?: Record<string, JsonValue> | undefined;
	readonly schemaSlug?: string | undefined;
	readonly memberCount?: number | undefined;
	readonly createEvents?: (index: number) => ReturnType<typeof failure> | undefined;
}) => {
	const creates: (readonly CreateEventItem[])[] = [];
	const options: (CreateEventOptions | undefined)[] = [];
	const patches: Record<string, JsonValue>[] = [];
	const logs: unknown[] = [];
	const host = defineSandboxTestHost(manifest, {
		log: (entries) =>
			Effect.sync(() => {
				logs.push(...entries);
				return null;
			}),
		getUserSettings: () =>
			input.failSettings === "read"
				? Effect.fail({ message: "Settings unavailable" })
				: Effect.succeed(input.settings ?? {}),
		createEvents: (items, identity) =>
			Effect.suspend(() => {
				creates.push(items);
				options.push(identity);
				return input.createEvents?.(creates.length - 1) ?? Effect.succeed(written(items));
			}),
		updateUserSettings: (patch) =>
			input.failSettings === "write"
				? Effect.fail({ message: "Settings rejected" })
				: Effect.sync(() => {
						patches.push(patch);
						return { saved: true as const };
					}),
		executeRyotql: (document) =>
			Effect.succeed({
				data:
					"members" in document.queries
						? {
								members: page(
									Array.from({ length: input.memberCount ?? 0 }, (_, index) => ({
										id: `member-${index}`,
									})),
								),
							}
						: {
								target: page(
									input.schemaSlug === undefined ? [] : [{ schemaSlug: input.schemaSlug }],
								),
							},
			}),
	});
	return { host, logs, creates, options, patches };
};

const failure = (count: number) =>
	Effect.fail({
		message: "Event creation failed",
		data: {
			count,
			partial: true,
			outcomes: Array.from({ length: count }, (_, index) => ({
				index,
				status: "written" as const,
				eventId: EventId.make(`event-${index}`),
			})),
		},
	});

const run = (
	input: { readonly entry: MediaActivityEntry; readonly submittedAt?: string },
	host: ReturnType<typeof recordingHost>["host"],
) =>
	runSandboxTestScript(
		definition,
		{ submittedAt, submissionId: "submission", ...input },
		host,
		execution,
	);

const rejects = (
	expectedTag: "SchemaError" | "MediaActivityRejectedError",
	entry: MediaActivityEntry,
	host: Parameters<typeof run>[1],
) =>
	Effect.gen(function* () {
		const result = yield* Effect.result(run({ entry }, host));
		expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: expectedTag } });
	});

const episodeId = (index: number) => `episode-${String(index).padStart(3, "0")}`;

const episodeIds = (count: number) => Array.from({ length: count }, (_, index) => episodeId(index));

describe("media activity log", () => {
	it.live("writes one complete event at submission time with source and time spent", () =>
		Effect.gen(function* () {
			const { host, creates, options } = recordingHost({ schemaSlug: "movie" });
			expect(
				yield* run(
					{
						entry: {
							timeSpent: 95,
							kind: "complete",
							entityId: "movie-1",
							when: { kind: "now" },
							consumedOn: " Netflix ",
						},
					},
					host,
				),
			).toEqual({ count: 1, status: "saved" });
			expect(creates).toEqual([
				[
					{
						entityId: "movie-1",
						occurredAt: submittedAt,
						eventSchemaSlug: "complete",
						properties: { timeSpent: 95, consumedOn: "Netflix" },
					},
				],
			]);
			expect(options).toEqual([{ submittedAt, idempotencyKey: "submission:0" }]);
		}),
	);

	it.live("writes picked dates as the occurrence and the start", () =>
		Effect.gen(function* () {
			const { host, creates } = recordingHost({ schemaSlug: "book" });
			yield* run(
				{
					entry: {
						kind: "complete",
						entityId: "book-1",
						when: {
							kind: "date",
							startedOn: "2026-02-01T12:00:00.000Z",
							finishedOn: "2026-02-20T12:00:00.000Z",
						},
					},
				},
				host,
			);
			expect(creates).toEqual([
				[
					{
						entityId: "book-1",
						eventSchemaSlug: "complete",
						occurredAt: "2026-02-20T12:00:00.000Z",
						properties: { startedOn: "2026-02-01T12:00:00.000Z" },
					},
				],
			]);
		}),
	);

	it.live("marks an unknown date and records it at submission time", () =>
		Effect.gen(function* () {
			const { host, creates } = recordingHost({ schemaSlug: "movie" });
			yield* run(
				{ entry: { kind: "complete", entityId: "movie-1", when: { kind: "unknown" } } },
				host,
			);
			expect(creates).toEqual([
				[
					{
						entityId: "movie-1",
						occurredAt: submittedAt,
						eventSchemaSlug: "complete",
						properties: { dateUnknown: true },
					},
				],
			]);
		}),
	);

	it.live("accepts today picked before local noon and rejects out-of-order dates", () =>
		Effect.gen(function* () {
			const accepted = recordingHost({ schemaSlug: "movie" });
			expect(
				yield* run(
					{
						entry: {
							kind: "complete",
							entityId: "movie-1",
							when: { kind: "date", startedOn: submittedAt, finishedOn: submittedAt },
						},
					},
					accepted.host,
				),
			).toEqual({ count: 1, status: "saved" });

			const rejected = recordingHost({ schemaSlug: "movie" });
			yield* rejects(
				"SchemaError",
				{
					kind: "complete",
					entityId: "movie-1",
					when: { kind: "date", finishedOn: "2026-03-10T09:00:00.001Z" },
				},
				rejected.host,
			);
			yield* rejects(
				"SchemaError",
				{
					kind: "complete",
					entityId: "movie-1",
					when: {
						kind: "date",
						startedOn: "2026-03-02T12:00:00.000Z",
						finishedOn: "2026-03-01T12:00:00.000Z",
					},
				},
				rejected.host,
			);
			yield* rejects(
				"SchemaError",
				{
					kind: "episodes",
					parentEntityId: "show-1",
					episodeEntityIds: ["episode-1"],
					when: { kind: "date", finishedOn: "2026-04-01T12:00:00.000Z" },
				},
				rejected.host,
			);
			expect(rejected.creates).toEqual([]);
		}),
	);

	it.live("writes a percent progress event, or none for just started", () =>
		Effect.gen(function* () {
			const { host, creates } = recordingHost({ schemaSlug: "book" });
			yield* run(
				{
					entry: {
						kind: "progress",
						entityId: "book-1",
						progressPercent: 40,
						consumedOn: "Kindle",
					},
				},
				host,
			);
			yield* run({ entry: { kind: "progress", entityId: "book-1" } }, host);
			expect(creates).toEqual([
				[
					{
						entityId: "book-1",
						eventSchemaSlug: "progress",
						properties: { progressPercent: 40, consumedOn: "Kindle" },
					},
				],
				[{ properties: {}, entityId: "book-1", eventSchemaSlug: "progress" }],
			]);
		}),
	);

	it.live("writes anime and manga positions without a percent", () =>
		Effect.gen(function* () {
			const anime = recordingHost({ schemaSlug: "anime" });
			yield* run({ entry: { position: 7, kind: "progress", entityId: "anime-1" } }, anime.host);
			expect(anime.creates).toEqual([
				[{ entityId: "anime-1", eventSchemaSlug: "progress", properties: { animeEpisode: 7 } }],
			]);
			const manga = recordingHost({ schemaSlug: "manga" });
			yield* run({ entry: { position: 113, kind: "progress", entityId: "manga-1" } }, manga.host);
			expect(manga.creates).toEqual([
				[{ entityId: "manga-1", eventSchemaSlug: "progress", properties: { mangaChapter: 113 } }],
			]);
		}),
	);

	it.live("rejects progress shapes the schema does not carry without writing", () =>
		Effect.gen(function* () {
			const anime = recordingHost({ schemaSlug: "anime" });
			yield* rejects(
				"MediaActivityRejectedError",
				{ kind: "progress", entityId: "anime-1", progressPercent: 50 },
				anime.host,
			);
			yield* rejects(
				"MediaActivityRejectedError",
				{ kind: "progress", entityId: "anime-1" },
				anime.host,
			);
			yield* rejects(
				"SchemaError",
				{ position: 2, kind: "progress", entityId: "anime-1", progressPercent: 50 },
				anime.host,
			);
			const book = recordingHost({ schemaSlug: "book" });
			yield* rejects(
				"MediaActivityRejectedError",
				{ position: 2, kind: "progress", entityId: "book-1" },
				book.host,
			);
			const show = recordingHost({ schemaSlug: "show" });
			yield* rejects(
				"MediaActivityRejectedError",
				{ kind: "progress", entityId: "show-1", progressPercent: 50 },
				show.host,
			);
			yield* rejects(
				"MediaActivityRejectedError",
				{ kind: "complete", entityId: "show-1", when: { kind: "now" } },
				show.host,
			);
			const missing = recordingHost({});
			yield* rejects(
				"MediaActivityRejectedError",
				{ kind: "progress", entityId: "gone", progressPercent: 50 },
				missing.host,
			);
			yield* rejects(
				"MediaActivityRejectedError",
				{ kind: "status", entityId: "gone", status: "dropped" },
				missing.host,
			);
			for (const { creates } of [anime, book, show, missing]) {
				expect(creates).toEqual([]);
			}
		}),
	);

	it.live("writes a status event without properties, including on a show parent", () =>
		Effect.gen(function* () {
			const { host, creates } = recordingHost({ schemaSlug: "show" });
			yield* run({ entry: { kind: "status", status: "on_hold", entityId: "show-1" } }, host);
			expect(creates).toEqual([
				[{ properties: {}, entityId: "show-1", eventSchemaSlug: "on_hold" }],
			]);
		}),
	);

	it.live("writes one complete event per episode in a deterministic order", () =>
		Effect.gen(function* () {
			const { host, creates } = recordingHost({ memberCount: 3, schemaSlug: "show" });
			yield* run(
				{
					entry: {
						kind: "episodes",
						consumedOn: "Disney+",
						parentEntityId: "show-1",
						when: { kind: "unknown" },
						episodeEntityIds: ["episode-3", "episode-1", "episode-2"],
					},
				},
				host,
			);
			expect(creates).toEqual([
				["episode-1", "episode-2", "episode-3"].map((entityId) => ({
					entityId,
					occurredAt: submittedAt,
					eventSchemaSlug: "complete",
					properties: { dateUnknown: true, consumedOn: "Disney+" },
				})),
			]);
		}),
	);

	it.live("splits many episodes into chunks with derived keys and reproduces them on retry", () =>
		Effect.gen(function* () {
			const ids = episodeIds(250);
			const entry: MediaActivityEntry = {
				kind: "episodes",
				when: { kind: "now" },
				parentEntityId: "podcast-1",
				episodeEntityIds: Array.from({ length: 250 }, (_, index) => episodeId(249 - index)),
			};
			const first = recordingHost({ memberCount: 250, schemaSlug: "podcast" });
			expect(yield* run({ entry }, first.host)).toEqual({ count: 250, status: "saved" });
			expect(first.creates.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
			expect(first.creates.flat().map(({ entityId }) => entityId)).toEqual(ids);
			expect(first.options).toEqual([
				{ submittedAt, idempotencyKey: "submission:0" },
				{ submittedAt, idempotencyKey: "submission:1" },
				{ submittedAt, idempotencyKey: "submission:2" },
			]);
			const retry = recordingHost({ memberCount: 250, schemaSlug: "podcast" });
			yield* run({ entry }, retry.host);
			expect(retry.creates).toEqual(first.creates);
		}),
	);

	it.live(
		"rejects episodes that do not belong to the parent or a parent that is not episodic",
		() =>
			Effect.gen(function* () {
				const foreign = recordingHost({ memberCount: 1, schemaSlug: "show" });
				yield* rejects(
					"MediaActivityRejectedError",
					{
						kind: "episodes",
						when: { kind: "now" },
						parentEntityId: "show-1",
						episodeEntityIds: ["episode-1", "foreign"],
					},
					foreign.host,
				);
				const flat = recordingHost({ memberCount: 1, schemaSlug: "movie" });
				yield* rejects(
					"MediaActivityRejectedError",
					{
						kind: "episodes",
						when: { kind: "now" },
						parentEntityId: "movie-1",
						episodeEntityIds: ["episode-1"],
					},
					flat.host,
				);
				yield* rejects(
					"SchemaError",
					{
						kind: "episodes",
						when: { kind: "now" },
						parentEntityId: "show-1",
						episodeEntityIds: ["episode-1", "episode-1"],
					},
					foreign.host,
				);
				expect([...foreign.creates, ...flat.creates]).toEqual([]);
			}),
	);

	it.live("reports a partial chunk as incomplete and stops writing", () =>
		Effect.gen(function* () {
			const { host, creates } = recordingHost({
				memberCount: 150,
				schemaSlug: "show",
				createEvents: (index) => (index === 1 ? failure(30) : undefined),
			});
			expect(
				yield* run(
					{
						entry: {
							kind: "episodes",
							when: { kind: "now" },
							parentEntityId: "show-1",
							episodeEntityIds: episodeIds(150),
						},
					},
					host,
				),
			).toEqual({ count: 130, status: "incomplete" });
			expect(creates.map((chunk) => chunk.length)).toEqual([100, 50]);
		}),
	);

	it.live("adds a new source to the user's list for the media type once", () =>
		Effect.gen(function* () {
			const { host, patches } = recordingHost({
				schemaSlug: "movie",
				settings: { consumedOnShow: ["Hulu"], consumedOnMovie: ["Netflix"] },
			});
			const result = yield* run(
				{
					entry: {
						kind: "complete",
						entityId: "movie-1",
						when: { kind: "now" },
						consumedOn: " Criterion ",
					},
				},
				host,
			);
			expect(result).toEqual({ count: 1, status: "saved" });
			expect(patches).toEqual([{ consumedOnMovie: ["Netflix", "Criterion"] }]);
		}),
	);

	it.live("adds sources from progress entries, and from episodes under the parent's type", () =>
		Effect.gen(function* () {
			const progress = recordingHost({ schemaSlug: "anime", settings: { consumedOnAnime: [] } });
			yield* run(
				{
					entry: { position: 3, kind: "progress", entityId: "anime-1", consumedOn: "Crunchyroll" },
				},
				progress.host,
			);
			expect(progress.patches).toEqual([{ consumedOnAnime: ["Crunchyroll"] }]);
			const episodes = recordingHost({
				memberCount: 2,
				schemaSlug: "podcast",
				settings: { consumedOnPodcast: ["Spotify"] },
			});
			yield* run(
				{
					entry: {
						kind: "episodes",
						when: { kind: "now" },
						consumedOn: "Overcast",
						parentEntityId: "podcast-1",
						episodeEntityIds: episodeIds(2),
					},
				},
				episodes.host,
			);
			expect(episodes.patches).toEqual([{ consumedOnPodcast: ["Spotify", "Overcast"] }]);
		}),
	);

	it.live(
		"does not touch settings for case-insensitive duplicates, a full list, or no source",
		() =>
			Effect.gen(function* () {
				const full = Array.from({ length: 30 }, (_, index) => `Source ${index}`);
				const duplicate = recordingHost({
					schemaSlug: "movie",
					settings: { consumedOnMovie: ["Netflix"] },
				});
				const capped = recordingHost({ schemaSlug: "movie", settings: { consumedOnMovie: full } });
				const bare = recordingHost({ schemaSlug: "movie", settings: { consumedOnMovie: [] } });
				const entry = { kind: "complete", entityId: "movie-1", when: { kind: "now" } } as const;
				yield* run({ entry: { ...entry, consumedOn: "nETflix" } }, duplicate.host);
				yield* run({ entry: { ...entry, consumedOn: "Criterion" } }, capped.host);
				yield* run({ entry }, bare.host);
				expect([duplicate.patches, capped.patches, bare.patches]).toEqual([[], [], []]);
				expect([duplicate.logs, capped.logs]).toEqual([[], []]);
			}),
	);

	it.live("does not touch settings for status entries or when the write is incomplete", () =>
		Effect.gen(function* () {
			const status = recordingHost({ schemaSlug: "movie", settings: { consumedOnMovie: [] } });
			yield* run(
				{ entry: { kind: "status", status: "backlog", entityId: "movie-1" } },
				status.host,
			);
			const incomplete = recordingHost({
				memberCount: 150,
				schemaSlug: "show",
				settings: { consumedOnShow: [] },
				createEvents: (index) => (index === 1 ? failure(30) : undefined),
			});
			yield* run(
				{
					entry: {
						kind: "episodes",
						consumedOn: "Hulu",
						when: { kind: "now" },
						parentEntityId: "show-1",
						episodeEntityIds: episodeIds(150),
					},
				},
				incomplete.host,
			);
			expect([status.patches, incomplete.patches]).toEqual([[], []]);
		}),
	);

	it.live("logs a failing settings read or write and still returns the saved result", () =>
		Effect.gen(function* () {
			const entry = {
				kind: "complete",
				entityId: "movie-1",
				when: { kind: "now" },
				consumedOn: "Criterion",
			} as const;
			for (const failSettings of ["read", "write"] as const) {
				const { host, logs, patches } = recordingHost({
					failSettings,
					schemaSlug: "movie",
					settings: { consumedOnMovie: [] },
				});
				expect(yield* run({ entry }, host)).toEqual({ count: 1, status: "saved" });
				expect(patches).toEqual([]);
				expect(logs).toMatchObject([{ level: "warning", attributes: { schemaSlug: "movie" } }]);
			}
			const malformed = recordingHost({ schemaSlug: "movie", settings: { consumedOnMovie: "x" } });
			expect(yield* run({ entry }, malformed.host)).toEqual({ count: 1, status: "saved" });
			expect(malformed.logs).toHaveLength(1);
		}),
	);
});
