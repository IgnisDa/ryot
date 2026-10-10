import { afterEach, expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

import type { MediaSourceRecord } from "./collection-schemas";
import { mediaFilesystem, mediaStageInput, resetMediaFilesystem } from "./ingestion.test-support";
import { collectJellyfin } from "./jellyfin-collection";
import type { HttpHost } from "./source-api";

afterEach(resetMediaFilesystem);

const importedAt = "2026-10-22T12:34:56.000Z";
const collect = Effect.fn(function* (respond: (url: URL) => unknown) {
	const fs = mediaFilesystem({});
	const calls: URL[] = [];
	const host: HttpHost = {
		httpCall: (_method, value) => {
			const url = new URL(value);
			calls.push(url);
			return Effect.succeed({
				status: 200,
				headers: {},
				body: JSON.stringify(
					url.pathname.endsWith("AuthenticateByName")
						? { AccessToken: "token", User: { Id: "user" } }
						: { Items: respond(url) },
				),
			});
		},
	};
	let input = mediaStageInput({
		importedAt,
		settings: { username: "user", apiUrl: "https://jellyfin.example" },
	});
	const records: MediaSourceRecord[] = [];
	for (let step = 0; step < 20; step++) {
		const before = calls.length;
		const result = yield* collectJellyfin(input, host);
		expect(calls.length - before).toBe(1);
		records.push(...(yield* fs.records()));
		if (result.done) {
			return { calls, records, itemIndex: result.itemIndex };
		}
		expect(result.carryFile).toBe("state.json");
		fs.files.set("carry", fs.scratch.get(result.carryFile ?? "") ?? new Uint8Array());
		Object.assign(input, {
			offset: result.offset,
			header: result.header,
			itemIndex: result.itemIndex,
			ingestionArtifacts: { runId: "run", captures: { carry: "carry" } },
		});
	}
	throw new Error("Jellyfin collection did not terminate");
});

const show = { Id: "series", Name: "Show", ProviderIds: { Tmdb: "99" } };

it.live.each([undefined, null, "", "   "])(
	"keeps played movies and episodes with unknown completion dates: %s",
	(lastPlayedDate) =>
		Effect.gen(function* () {
			const { calls, records } = yield* collect((url) => {
				if (url.searchParams.get("IncludeItemTypes") === "Series") {
					return [show];
				}
				const UserData = { IsFavorite: true, LastPlayedDate: lastPlayedDate };
				return url.pathname.endsWith("/Episodes")
					? [{ UserData, Id: "episode", IndexNumber: 3, Name: "Episode", ParentIndexNumber: 2 }]
					: [{ UserData, Id: "movie", Name: "Movie", ProviderIds: { Tmdb: "42" } }];
			});
			expect(records.flatMap((record) => record.failure ?? [])).toEqual([]);
			const events = records.flatMap((record) => record.group?.events ?? []);
			expect(events).toHaveLength(2);
			expect(
				events.map(({ occurredAt, properties, eventSchemaSlug }) => ({
					occurredAt,
					properties,
					eventSchemaSlug,
				})),
			).toEqual([
				{
					occurredAt: importedAt,
					eventSchemaSlug: "complete",
					properties: { completionMode: "unknown" },
				},
				{
					occurredAt: importedAt,
					eventSchemaSlug: "complete",
					properties: { completionMode: "unknown" },
				},
			]);
			expect(events[1]?.unresolvedEpisode).toEqual({
				type: "show",
				seasonNumber: 2,
				episodeNumber: 3,
			});
			expect(
				records
					.filter((record) => record.group?.events.length)
					.map((record) => record.group?.entityRef),
			).toMatchObject([
				{ kind: "resolved", externalId: "42", providerSlug: "movie.tmdb" },
				{ kind: "resolved", externalId: "99", providerSlug: "show.tmdb" },
			]);
			expect(records.flatMap((record) => record.group?.collectionMemberships ?? [])).toEqual([
				{ collectionName: "Favorites" },
				{ collectionName: "Favorites" },
			]);
			expect(
				calls
					.filter((url) => url.searchParams.has("IsPlayed"))
					.map((url) => url.searchParams.get("IsPlayed")),
			).toEqual(["true", "true"]);
		}),
);

it.live("keeps played items whose UserData is absent", () =>
	Effect.gen(function* () {
		const { records } = yield* collect((url) =>
			url.searchParams.get("IncludeItemTypes") === "Movie"
				? [{ Id: "movie", Name: "Movie", ProviderIds: { Tmdb: "42" } }]
				: [],
		);
		expect(records).toHaveLength(1);
		expect(records[0]?.group?.events[0]).toMatchObject({
			occurredAt: importedAt,
			eventSchemaSlug: "complete",
			properties: { completionMode: "unknown" },
		});
	}),
);

it.live("preserves dated movie completion and episode progress timestamps", () =>
	Effect.gen(function* () {
		const { records } = yield* collect((url) => {
			if (url.searchParams.get("IncludeItemTypes") === "Series") {
				return [show];
			}
			const UserData = { LastPlayedDate: "2025-02-03T04:05:06+02:00" };
			return url.pathname.endsWith("/Episodes")
				? [{ UserData, Id: "episode", IndexNumber: 1, Name: "Episode", ParentIndexNumber: 0 }]
				: [{ UserData, Id: "movie", Name: "Movie", ProviderIds: { Tmdb: "42" } }];
		});
		const events = records.flatMap((record) => record.group?.events ?? []);
		expect(events).toMatchObject([
			{
				eventSchemaSlug: "complete",
				occurredAt: "2025-02-03T02:05:06.000Z",
				properties: {
					completionMode: "custom_timestamps",
					completedOn: "2025-02-03T02:05:06.000Z",
				},
			},
			{
				eventSchemaSlug: "progress",
				properties: { progressPercent: 100 },
				occurredAt: "2025-02-03T02:05:06.000Z",
				unresolvedEpisode: { type: "show", seasonNumber: 0, episodeNumber: 1 },
			},
		]);
	}),
);

it.live("fails malformed nonempty timestamps per item without dropping valid undated items", () =>
	Effect.gen(function* () {
		const { records } = yield* collect((url) => {
			if (url.searchParams.get("IncludeItemTypes") === "Series") {
				return [show];
			}
			const UserData = { LastPlayedDate: "not-a-date" };
			return url.pathname.endsWith("/Episodes")
				? [
						{
							UserData,
							IndexNumber: 1,
							Id: "bad-episode",
							Name: "Bad episode",
							ParentIndexNumber: 1,
						},
					]
				: [
						{ UserData, Id: "bad-movie", Name: "Bad movie", ProviderIds: { Tmdb: "42" } },
						{ Id: "good-movie", Name: "Good movie", ProviderIds: { Tmdb: "43" } },
					];
		});
		expect(records.flatMap((record) => record.failure ?? [])).toMatchObject([
			{
				itemIndex: 0,
				sourceIdentifier: "bad-movie",
				message: "Jellyfin item has an invalid played timestamp",
			},
			{
				itemIndex: 3,
				sourceIdentifier: "bad-episode",
				message: "Jellyfin item has an invalid played timestamp",
			},
		]);
		expect(records.flatMap((record) => record.group?.events ?? [])).toHaveLength(1);
	}),
);

it.live("carries undated history across bounded movie and episode pages without refetching", () =>
	Effect.gen(function* () {
		const { calls, records, itemIndex } = yield* collect((url) => {
			if (url.searchParams.get("IncludeItemTypes") === "Series") {
				return [show];
			}
			const start = Number(url.searchParams.get("StartIndex"));
			return Array.from({ length: start === 0 ? 20 : 1 }, (_, index) =>
				url.pathname.endsWith("/Episodes")
					? {
							Name: "Episode",
							ParentIndexNumber: 1,
							Id: `episode-${start + index}`,
							IndexNumber: start + index + 1,
						}
					: {
							Name: "Movie",
							Id: `movie-${start + index}`,
							ProviderIds: { Tmdb: String(start + index + 1) },
						},
			);
		});
		expect(calls).toHaveLength(6);
		expect(new Set(calls.map(String)).size).toBe(6);
		expect(
			calls
				.filter((url) => url.searchParams.has("IsPlayed"))
				.map((url) => url.searchParams.get("StartIndex")),
		).toEqual(["0", "20", "0", "20"]);
		expect(itemIndex).toBe(43);
		expect(records).toHaveLength(42);
		expect(records.every((record) => record.group?.events[0]?.occurredAt === importedAt)).toBe(
			true,
		);
		expect(
			records.every(
				(record) => record.group?.events[0]?.properties["completionMode"] === "unknown",
			),
		).toBe(true);
		expect(
			new Set(
				records.flatMap((record) => record.group?.events.map((event) => event.operationId) ?? []),
			).size,
		).toBe(42);
		expect(records.at(-1)?.group?.events[0]?.unresolvedEpisode).toEqual({
			type: "show",
			seasonNumber: 1,
			episodeNumber: 21,
		});
	}),
);
