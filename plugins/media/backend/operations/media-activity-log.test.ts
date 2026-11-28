import { describe, expect } from "bun:test";

import type { JsonValue } from "@ryot-app/contract/schema/json";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import type { MediaActivityEntry } from "../../shared/media-activity-operations";
import { execution } from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./media-activity-log.sandbox";

const submittedAt = "2026-03-10T09:00:00.000Z";

const page = (items: readonly unknown[]) => ({
	items,
	type: "rows",
	pageInfo: { limit: 500, hasMore: false, nextCursor: null },
});

const recordingHost = (input: {
	readonly failSettings?: true;
	readonly schemaSlug?: string | undefined;
	readonly settings?: undefined | Record<string, JsonValue>;
	readonly foreignEpisodeIds?: undefined | readonly string[];
}) => {
	const logs: unknown[] = [];
	const memberQueries: unknown[] = [];
	const host = defineSandboxTestHost(manifest, {
		log: (entries) =>
			Effect.sync(() => {
				logs.push(...entries);
				return null;
			}),
		getUserSettings: () =>
			input.failSettings
				? Effect.fail({ message: "Settings unavailable" })
				: Effect.succeed(input.settings ?? {}),
		executeRyotql: (document) =>
			Effect.gen(function* () {
				if (!("members" in bindTestRequest(document).queries)) {
					return {
						data: {
							target: page(
								input.schemaSlug === undefined ? [] : [{ schemaSlug: input.schemaSlug }],
							),
						},
					};
				}
				const serialized = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
					bindTestRequest(document).queries.members,
				).pipe(Effect.orDie);
				const ids = serialized.match(/(?<=")(episode-\d+|foreign)(?=")/g) ?? [];
				memberQueries.push(ids.length);
				return {
					data: {
						members: page(
							ids.filter((id) => !input.foreignEpisodeIds?.includes(id)).map((id) => ({ id })),
						),
					},
				};
			}),
	});
	return { host, logs, memberQueries };
};

const run = (
	input: { readonly submittedAt?: string; readonly entry: MediaActivityEntry },
	host: ReturnType<typeof recordingHost>["host"],
) =>
	runSandboxTestScript(
		definition,
		{ submittedAt, submissionId: "submission", ...input },
		host,
		execution,
	);

const creates = (input: Parameters<typeof run>[0], host: Parameters<typeof run>[1]) =>
	run(input, host).pipe(Effect.map((result) => result.changes?.events?.changes));

const settingsPatch = (input: Parameters<typeof run>[0], host: Parameters<typeof run>[1]) =>
	run(input, host).pipe(Effect.map((result) => result.changes?.settings));

const created = (
	entityId: string,
	eventSchemaSlug: string,
	properties: Record<string, JsonValue>,
	occurredAt?: string,
) => ({
	properties,
	kind: "create",
	eventSchemaSlug,
	entity: { entityId, kind: "existing" },
	itemIdentity: `${eventSchemaSlug}:${entityId}`,
	...(occurredAt === undefined ? {} : { occurredAt }),
});

const rejects = (
	expectedTag: "SchemaError" | "OperationRejectedError",
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
	it.live(
		"returns one complete event at submission time with source and time spent",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({ schemaSlug: "movie" });
				expect(
					yield* run(
						{
							entry: {
								timeSpent: 95,
								kind: "complete",
								entityId: "movie-1",
								when: { kind: "now" },
								consumedOn: [" Netflix "],
							},
						},
						host,
					),
				).toEqual<unknown>({
					output: { count: 1 },
					changes: {
						events: {
							changes: [
								created(
									"movie-1",
									"complete",
									{ timeSpent: 95, consumedOn: ["Netflix"] },
									submittedAt,
								),
							],
						},
					},
				});
			}),
		testTimeout,
	);

	it.live(
		"returns picked dates as the occurrence and the start",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({ schemaSlug: "book" });
				expect(
					yield* creates(
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
					),
				).toEqual<unknown>([
					created(
						"book-1",
						"complete",
						{ startedOn: "2026-02-01T12:00:00.000Z" },
						"2026-02-20T12:00:00.000Z",
					),
				]);
			}),
		testTimeout,
	);

	it.live(
		"marks an unknown date and records it at submission time",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({ schemaSlug: "movie" });
				expect(
					yield* creates(
						{ entry: { kind: "complete", entityId: "movie-1", when: { kind: "unknown" } } },
						host,
					),
				).toEqual<unknown>([created("movie-1", "complete", { dateUnknown: true }, submittedAt)]);
			}),
		testTimeout,
	);

	it.live(
		"accepts today picked before local noon and rejects out-of-order dates",
		() =>
			Effect.gen(function* () {
				const accepted = recordingHost({ schemaSlug: "movie" });
				expect(
					(yield* run(
						{
							entry: {
								kind: "complete",
								entityId: "movie-1",
								when: { kind: "date", startedOn: submittedAt, finishedOn: submittedAt },
							},
						},
						accepted.host,
					)).output,
				).toEqual<unknown>({ count: 1 });

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
			}),
		testTimeout,
	);

	it.live(
		"returns a percent progress event, or none for just started",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({ schemaSlug: "book" });
				expect(
					yield* creates(
						{
							entry: {
								kind: "progress",
								entityId: "book-1",
								progressPercent: 40,
								consumedOn: ["Kindle"],
							},
						},
						host,
					),
				).toEqual<unknown>([
					created(
						"book-1",
						"progress",
						{ progressPercent: 40, consumedOn: ["Kindle"] },
						submittedAt,
					),
				]);
				expect(
					yield* creates({ entry: { kind: "progress", entityId: "book-1" } }, host),
				).toEqual<unknown>([created("book-1", "progress", {}, submittedAt)]);
			}),
		testTimeout,
	);

	it.live(
		"returns anime and manga positions without a percent",
		() =>
			Effect.gen(function* () {
				expect(
					yield* creates(
						{
							entry: {
								kind: "progress",
								entityId: "anime-1",
								position: { position: 7, unit: "episodes" },
							},
						},
						recordingHost({ schemaSlug: "anime" }).host,
					),
				).toEqual<unknown>([
					created(
						"anime-1",
						"progress",
						{ position: { position: 7, unit: "episodes" } },
						submittedAt,
					),
				]);
				const manga = recordingHost({ schemaSlug: "manga" });
				expect(
					yield* creates(
						{
							entry: {
								kind: "progress",
								entityId: "manga-1",
								position: { position: 113.5, unit: "chapters" },
							},
						},
						manga.host,
					),
				).toEqual<unknown>([
					created(
						"manga-1",
						"progress",
						{ position: { position: 113.5, unit: "chapters" } },
						submittedAt,
					),
				]);
				expect(
					yield* creates(
						{
							entry: {
								kind: "progress",
								entityId: "manga-1",
								position: { position: 2, unit: "volumes" },
								when: {
									kind: "date",
									calendarDate: "2026-03-09",
									startedOn: "2026-03-01T00:00:00.000Z",
									finishedOn: "2026-03-09T00:00:00.000Z",
								},
							},
						},
						manga.host,
					),
				).toEqual<unknown>([
					created(
						"manga-1",
						"progress",
						{
							calendarDate: "2026-03-09",
							startedOn: "2026-03-01T00:00:00.000Z",
							position: { position: 2, unit: "volumes" },
						},
						"2026-03-09T00:00:00.000Z",
					),
				]);
			}),
		testTimeout,
	);

	it.live(
		"rejects progress shapes the schema does not carry",
		() =>
			Effect.gen(function* () {
				const anime = recordingHost({ schemaSlug: "anime" });
				yield* rejects(
					"OperationRejectedError",
					{ kind: "progress", entityId: "anime-1", progressPercent: 50 },
					anime.host,
				);
				yield* rejects(
					"OperationRejectedError",
					{ kind: "progress", entityId: "anime-1" },
					anime.host,
				);
				yield* rejects(
					"SchemaError",
					{
						kind: "progress",
						entityId: "anime-1",
						progressPercent: 50,
						position: { position: 2, unit: "episodes" },
					},
					anime.host,
				);
				yield* rejects(
					"OperationRejectedError",
					{ kind: "progress", entityId: "anime-1", position: { position: 2.5, unit: "episodes" } },
					anime.host,
				);
				yield* rejects(
					"OperationRejectedError",
					{ kind: "progress", entityId: "manga-1", position: { position: 2, unit: "episodes" } },
					recordingHost({ schemaSlug: "manga" }).host,
				);
				yield* rejects(
					"OperationRejectedError",
					{ kind: "progress", entityId: "book-1", position: { position: 2, unit: "episodes" } },
					recordingHost({ schemaSlug: "book" }).host,
				);
				const show = recordingHost({ schemaSlug: "show" });
				yield* rejects(
					"OperationRejectedError",
					{ kind: "progress", entityId: "show-1", progressPercent: 50 },
					show.host,
				);
				yield* rejects(
					"OperationRejectedError",
					{ kind: "complete", entityId: "show-1", when: { kind: "now" } },
					show.host,
				);
				const missing = recordingHost({});
				yield* rejects(
					"OperationRejectedError",
					{ kind: "progress", entityId: "gone", progressPercent: 50 },
					missing.host,
				);
				yield* rejects(
					"OperationRejectedError",
					{ kind: "status", entityId: "gone", status: "dropped" },
					missing.host,
				);
			}),
		testTimeout,
	);

	it.live(
		"returns a status event without properties, including on a show parent",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({ schemaSlug: "show" });
				expect(
					yield* creates(
						{ entry: { kind: "status", status: "on_hold", entityId: "show-1" } },
						host,
					),
				).toEqual<unknown>([created("show-1", "on_hold", {})]);
			}),
		testTimeout,
	);

	it.live(
		"returns all episode events in one change set in submission order",
		() =>
			Effect.gen(function* () {
				const ids = Array.from({ length: 250 }, (_, index) => episodeId(249 - index));
				const { host } = recordingHost({ schemaSlug: "podcast" });
				const result = yield* run(
					{
						entry: {
							kind: "episodes",
							episodeEntityIds: ids,
							consumedOn: ["Disney+"],
							when: { kind: "unknown" },
							parentEntityId: "podcast-1",
						},
					},
					host,
				);
				expect(result.output).toEqual<unknown>({ count: 250 });
				expect(result.changes?.events?.changes).toEqual<unknown>(
					ids.map((id) =>
						created(id, "complete", { dateUnknown: true, consumedOn: ["Disney+"] }, submittedAt),
					),
				);
			}),
		testTimeout,
	);

	for (const { count, queries } of [
		{ count: 101, queries: [100, 1] },
		{ count: 500, queries: [100, 100, 100, 100, 100] },
	]) {
		it.live(
			`validates ${count} episodes in membership queries of at most 100 ids`,
			() =>
				Effect.gen(function* () {
					const { host, memberQueries } = recordingHost({ schemaSlug: "show" });
					expect(
						(yield* run(
							{
								entry: {
									kind: "episodes",
									when: { kind: "now" },
									parentEntityId: "show-1",
									episodeEntityIds: episodeIds(count),
								},
							},
							host,
						)).output,
					).toEqual<unknown>({ count });
					expect(memberQueries).toEqual<unknown>(queries);
				}),
			testTimeout,
		);
	}

	it.live(
		"rejects a foreign episode that falls in a later membership chunk",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({ schemaSlug: "show", foreignEpisodeIds: [episodeId(150)] });
				yield* rejects(
					"OperationRejectedError",
					{
						kind: "episodes",
						when: { kind: "now" },
						parentEntityId: "show-1",
						episodeEntityIds: episodeIds(250),
					},
					host,
				);
			}),
		testTimeout,
	);

	it.live(
		"rejects episodes that do not belong to the parent or a parent that is not episodic",
		() =>
			Effect.gen(function* () {
				const foreign = recordingHost({ schemaSlug: "show", foreignEpisodeIds: ["foreign"] });
				yield* rejects(
					"OperationRejectedError",
					{
						kind: "episodes",
						when: { kind: "now" },
						parentEntityId: "show-1",
						episodeEntityIds: ["episode-1", "foreign"],
					},
					foreign.host,
				);
				yield* rejects(
					"OperationRejectedError",
					{
						kind: "episodes",
						when: { kind: "now" },
						parentEntityId: "movie-1",
						episodeEntityIds: ["episode-1"],
					},
					recordingHost({ schemaSlug: "movie" }).host,
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
			}),
		testTimeout,
	);

	it.live(
		"adds a new source to the user's list for the media type once",
		() =>
			Effect.gen(function* () {
				const { host } = recordingHost({
					schemaSlug: "movie",
					settings: { consumedOnShow: ["Hulu"], consumedOnMovie: ["Netflix"] },
				});
				expect(
					yield* settingsPatch(
						{
							entry: {
								kind: "complete",
								entityId: "movie-1",
								when: { kind: "now" },
								consumedOn: [" Criterion "],
							},
						},
						host,
					),
				).toEqual<unknown>({ consumedOnMovie: ["Netflix", "Criterion"] });
			}),
		testTimeout,
	);

	it.live(
		"appends each new source in order, skipping known ones and stopping at the list limit",
		() =>
			Effect.gen(function* () {
				const entry = { kind: "complete", entityId: "movie-1", when: { kind: "now" } } as const;
				expect(
					yield* settingsPatch(
						{ entry: { ...entry, consumedOn: ["Criterion", "netflix", "Mubi"] } },
						recordingHost({ schemaSlug: "movie", settings: { consumedOnMovie: ["Netflix"] } }).host,
					),
				).toEqual<unknown>({ consumedOnMovie: ["Netflix", "Criterion", "Mubi"] });
				const nearlyFull = yield* settingsPatch(
					{ entry: { ...entry, consumedOn: ["Criterion", "Mubi"] } },
					recordingHost({
						schemaSlug: "movie",
						settings: {
							consumedOnMovie: Array.from({ length: 29 }, (_, index) => `Source ${index}`),
						},
					}).host,
				);
				expect(nearlyFull?.["consumedOnMovie"]).toHaveLength(30);
				expect(nearlyFull?.["consumedOnMovie"]).toContain("Criterion");
				expect(nearlyFull?.["consumedOnMovie"]).not.toContain("Mubi");
			}),
		testTimeout,
	);

	it.live(
		"adds sources from progress entries, and from episodes under the parent's type",
		() =>
			Effect.gen(function* () {
				expect(
					yield* settingsPatch(
						{
							entry: {
								kind: "progress",
								entityId: "anime-1",
								consumedOn: ["Crunchyroll"],
								position: { position: 3, unit: "episodes" },
							},
						},
						recordingHost({ schemaSlug: "anime", settings: { consumedOnAnime: [] } }).host,
					),
				).toEqual<unknown>({ consumedOnAnime: ["Crunchyroll"] });
				expect(
					yield* settingsPatch(
						{
							entry: {
								kind: "episodes",
								when: { kind: "now" },
								consumedOn: ["Overcast"],
								parentEntityId: "podcast-1",
								episodeEntityIds: episodeIds(2),
							},
						},
						recordingHost({ schemaSlug: "podcast", settings: { consumedOnPodcast: ["Spotify"] } })
							.host,
					),
				).toEqual<unknown>({ consumedOnPodcast: ["Spotify", "Overcast"] });
			}),
		testTimeout,
	);

	it.live(
		"patches no settings for duplicates, a full list, no source, or a status entry",
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
				expect([
					yield* settingsPatch({ entry: { ...entry, consumedOn: ["nETflix"] } }, duplicate.host),
					yield* settingsPatch({ entry: { ...entry, consumedOn: ["Criterion"] } }, capped.host),
					yield* settingsPatch({ entry }, bare.host),
					yield* settingsPatch(
						{ entry: { kind: "status", status: "backlog", entityId: "movie-1" } },
						bare.host,
					),
				]).toEqual<unknown>([undefined, undefined, undefined, undefined]);
				expect([duplicate.logs, capped.logs]).toEqual<unknown>([[], []]);
			}),
		testTimeout,
	);

	it.live(
		"logs an unreadable or malformed settings list and still returns the events",
		() =>
			Effect.gen(function* () {
				const entry = {
					kind: "complete",
					entityId: "movie-1",
					when: { kind: "now" },
					consumedOn: ["Criterion"],
				} as const;
				for (const host of [
					recordingHost({ failSettings: true, schemaSlug: "movie" }),
					recordingHost({ schemaSlug: "movie", settings: { consumedOnMovie: "x" } }),
				]) {
					const result = yield* run({ entry }, host.host);
					expect(result.output).toEqual<unknown>({ count: 1 });
					expect(result.changes?.settings).toBeUndefined();
					expect(result.changes?.events?.changes).toHaveLength(1);
					expect(host.logs).toMatchObject([
						{ level: "warning", attributes: { schemaSlug: "movie" } },
					]);
				}
			}),
		testTimeout,
	);
});
