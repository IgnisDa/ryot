import { describe, expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import {
	execution,
	hostFailure,
	hostSuccess,
	httpSuccess,
	integrationRecord,
} from "../../../tests/backend/automations/automation-test-utils";
import type { MediaIntegrationAdapterResult } from "../../imports/schemas";
import { runIntegrationTestScript } from "../artifacts.test-support";
import definition, { manifest } from "./audiobookshelf.sandbox";

const requestFailure = Symbol("request failure");
type Route = JsonValue | typeof requestFailure;
type HttpCall = Pick<ScriptHost, "httpCall">["httpCall"];

const routeKey = (url: string) => {
	const parsed = new URL(url);
	return `${parsed.pathname}${parsed.search}`;
};

const audiobookItem = (
	id: string,
	metadata: JsonValue,
	ebookFormat?: string | null,
): JsonValue => ({
	id,
	media: { metadata, ...(ebookFormat === undefined ? {} : { ebookFormat }) },
});

const podcastItem = (
	id: string,
	itunesId: string | number,
	recentEpisode?: JsonValue,
): JsonValue => ({
	id,
	media: { metadata: { itunesId, title: "Podcast" } },
	...(recentEpisode === undefined ? {} : { recentEpisode }),
});

const episode = (id: string, title: string): JsonValue => ({ id, title });

const setup = (
	items: readonly JsonValue[],
	options: {
		readonly baseUrl?: string;
		readonly routes?: Record<string, Route>;
		readonly syncOwnership?: boolean;
	} = {},
) => {
	const requests: Array<{
		readonly headers: Record<string, string> | undefined;
		readonly method: string;
		readonly url: string;
	}> = [];
	let integrationReads = 0;
	const routes: Record<string, Route> = {
		"/api/me": { mediaProgress: items.map(() => ({})) },
		[`/api/me/items-in-progress?limit=${Math.max(1, items.length)}`]: { libraryItems: items },
		...options.routes,
	};
	const httpCall: HttpCall = (method, url, callOptions) => {
		requests.push({ url, method, headers: callOptions?.headers });
		const key = routeKey(url);
		let response = routes[key];
		if (!Object.hasOwn(routes, key) && key.startsWith("/api/me/progress/")) {
			response = { progress: 0.42, isFinished: false };
		}
		return response === requestFailure || response === undefined
			? hostFailure("request failed")
			: httpSuccess(response);
	};
	const host = defineSandboxTestHost(manifest, {
		httpCall,
		getCurrentIntegration: () => {
			integrationReads++;
			return hostSuccess(
				integrationRecord({
					provider: "audiobookshelf",
					syncOwnership: options.syncOwnership ?? false,
					providerSpecifics: { token: "key", baseUrl: options.baseUrl ?? "http://abs.test" },
				}),
			);
		},
	});
	return {
		host,
		requests,
		integrationReads: () => integrationReads,
		run: () => runIntegrationTestScript(definition, {}, host, execution),
	};
};

const ownedGroups = (result: MediaIntegrationAdapterResult) =>
	result.entityGroups.filter((group) => group.ownershipProvider === "audiobookshelf");

const rootFailures: Array<{ name: string; routes: Record<string, Route> }> = [
	{ name: "malformed account snapshot", routes: { "/api/me": { mediaProgress: "not-an-array" } } },
	{ name: "failed account snapshot", routes: { "/api/me": requestFailure } },
	{
		name: "malformed in-progress snapshot",
		routes: { "/api/me/items-in-progress?limit=1": { libraryItems: "not-an-array" } },
	},
	{
		name: "failed in-progress snapshot",
		routes: { "/api/me/items-in-progress?limit=1": requestFailure },
	},
];

describe("Audiobookshelf yank", () => {
	it.live.each(["http://abs.test/", "http://abs.test/api/"])(
		"emits in-progress audiobook progress with normalized API roots (%s)",
		(baseUrl) =>
			Effect.gen(function* () {
				const state = setup([audiobookItem("book-42", { title: "Book", asin: "B08G9PRS1K" })], {
					baseUrl,
				});
				const result = yield* state.run();
				expect(result.failures).toEqual([]);
				expect(result.entityGroups).toHaveLength(1);
				expect(result.entityGroups[0]).toMatchObject({
					itemIndex: 0,
					collectionMemberships: [],
					entityRef: {
						kind: "resolved",
						externalId: "B08G9PRS1K",
						entitySchemaSlug: "audiobook",
						providerSlug: "audiobook.audible",
					},
					events: [
						{
							eventSchemaSlug: "progress",
							occurredAt: execution.startedAt,
							properties: { progressPercent: 42, consumedOn: "Audiobookshelf" },
						},
					],
				});
				expect(state.requests.map(({ url }) => routeKey(url))).toEqual([
					"/api/me",
					"/api/me/items-in-progress?limit=1",
					"/api/me/progress/book-42",
				]);
				expect(state.requests[0]?.headers).toMatchObject({ Authorization: "Bearer key" });
			}),
	);

	it.live.each([
		{ expected: 67, progress: 0.31, id: "ebook-ahead", ebookProgress: 0.67 },
		{ expected: 78, progress: 0.78, id: "audio-ahead", ebookProgress: 0.2 },
	])("uses the greater audio or ebook progress for ISBN items (%s)", (fixture) =>
		Effect.gen(function* () {
			const isbn = "978-0-441-01359-3";
			const state = setup([audiobookItem(fixture.id, { isbn, title: "ISBN Book" })], {
				routes: {
					[`/api/me/progress/${fixture.id}`]: {
						isFinished: false,
						progress: fixture.progress,
						ebookProgress: fixture.ebookProgress,
					},
				},
			});
			const result = yield* state.run();
			expect(result.failures).toEqual([]);
			expect(result.entityGroups[0]).toMatchObject({
				events: [{ properties: { progressPercent: fixture.expected } }],
				entityRef: {
					kind: "unresolved",
					identifierType: "isbn",
					entitySchemaSlug: "book",
					identifierValue: "9780441013593",
				},
			});
		}),
	);

	it.live("prefers the Audible reference when metadata also has an ISBN", () =>
		Effect.gen(function* () {
			const state = setup([
				audiobookItem("both-ids", {
					asin: "B08G9PRS1K",
					isbn: "9780441013593",
					title: "Both Identifiers",
				}),
			]);
			const result = yield* state.run();
			expect(result.entityGroups[0]?.entityRef).toMatchObject({
				kind: "resolved",
				externalId: "B08G9PRS1K",
				entitySchemaSlug: "audiobook",
				providerSlug: "audiobook.audible",
			});
		}),
	);

	it.live("skips finished 100 percent and non-positive progress without fetching history", () =>
		Effect.gen(function* () {
			const items = [
				audiobookItem("finished-audio", { asin: "ASIN-1", title: "Finished" }),
				audiobookItem("unfinished-audio", { asin: "ASIN-2", title: "Unfinished" }),
				audiobookItem("finished-ebook", { isbn: "9780441013593", title: "Finished Ebook" }),
				audiobookItem("zero", { title: "Zero", asin: "ASIN-4" }),
			];
			const state = setup(items, {
				routes: {
					"/api/me/progress/zero": { progress: 0, isFinished: false },
					"/api/me/progress/finished-audio": { progress: 1, isFinished: true },
					"/api/me/progress/unfinished-audio": { progress: 1, isFinished: false },
					"/api/me/progress/finished-ebook": { progress: 0.4, ebookProgress: 1, isFinished: true },
				},
			});
			const result = yield* state.run();
			expect(result.failures).toEqual([]);
			expect(result.entityGroups).toHaveLength(1);
			expect(result.entityGroups[0]).toMatchObject({
				itemIndex: 1,
				events: [{ eventSchemaSlug: "progress", properties: { progressPercent: 100 } }],
			});
			expect(state.requests.some(({ url }) => routeKey(url).startsWith("/api/libraries"))).toBe(
				false,
			);
			expect(state.requests.some(({ url }) => routeKey(url).startsWith("/api/items/"))).toBe(false);
		}),
	);

	it.live(
		"converts numeric podcast IDs and keeps episode progress endpoints and indexes distinct",
		() =>
			Effect.gen(function* () {
				const items: JsonValue[] = [
					podcastItem("podcast/one", 12345, episode("episode 1", "First episode")),
					podcastItem("podcast/one", 12345, episode("episode/2", "Second episode")),
					...Array.from({ length: 24 }, (_, index) =>
						audiobookItem(`book-${index}`, { asin: `ASIN-${index}`, title: `Book ${index}` }),
					),
				];
				const state = setup(items);
				const result = yield* state.run();
				expect(result.failures).toEqual([]);
				expect(result.entityGroups).toHaveLength(26);
				expect(result.entityGroups[0]).toMatchObject({
					itemIndex: 0,
					events: [{ unresolvedEpisode: { type: "podcast-title", episodeTitle: "First episode" } }],
					entityRef: {
						externalId: "12345",
						entitySchemaSlug: "podcast",
						providerSlug: "podcast.itunes",
					},
				});
				expect(result.entityGroups[1]).toMatchObject({
					itemIndex: 1,
					events: [
						{ unresolvedEpisode: { type: "podcast-title", episodeTitle: "Second episode" } },
					],
				});
				expect(state.requests.map(({ url }) => routeKey(url))).toContain(
					"/api/me/items-in-progress?limit=26",
				);
				expect(state.requests.filter(({ url }) => routeKey(url) === "/api/me")).toHaveLength(1);
				expect(
					state.requests.filter(({ url }) =>
						routeKey(url).startsWith("/api/me/items-in-progress?"),
					),
				).toHaveLength(1);
				expect(state.requests.map(({ url }) => routeKey(url))).toContain(
					"/api/me/progress/podcast%2Fone/episode%201",
				);
				expect(state.requests.map(({ url }) => routeKey(url))).toContain(
					"/api/me/progress/podcast%2Fone/episode%2F2",
				);
				expect(result.entityGroups.map(({ itemIndex }) => itemIndex)).toEqual(
					Array.from({ length: 26 }, (_, index) => index),
				);
			}),
	);

	it.live(
		"records per-item progress failures and input failures without stopping later items",
		() =>
			Effect.gen(function* () {
				const items: JsonValue[] = [
					audiobookItem("broken-progress", { title: "Broken", asin: "ASIN-BROKEN" }),
					audiobookItem("healthy", { title: "Healthy", asin: "ASIN-HEALTHY" }),
					{ id: "missing-media" },
					audiobookItem("missing-ids", { title: "No IDs" }),
					podcastItem("podcast-id", 42, episode("episode-id", "Episode")),
					podcastItem("missing-episode", 42),
				];
				const state = setup(items, {
					routes: {
						"/api/me/progress/broken-progress": requestFailure,
						"/api/me/progress/podcast-id/episode-id": {
							isFinished: false,
							progress: "not-a-number",
						},
					},
				});
				const result = yield* state.run();
				expect(result.entityGroups).toHaveLength(1);
				expect(result.entityGroups[0]).toMatchObject({ itemIndex: 1 });
				expect(result.failures).toHaveLength(5);
				expect(result.failures).toContainEqual(
					expect.objectContaining({
						itemIndex: 0,
						stage: "source_fetch",
						sourceIdentifier: "broken-progress",
						message: "Failed to fetch Audiobookshelf item progress",
					}),
				);
				expect(result.failures).toContainEqual(
					expect.objectContaining({
						itemIndex: 2,
						stage: "input_transformation",
						sourceIdentifier: "missing-media",
						message: "Audiobookshelf item is missing media metadata",
					}),
				);
				expect(result.failures).toContainEqual(
					expect.objectContaining({
						itemIndex: 3,
						stage: "input_transformation",
						sourceIdentifier: "missing-ids",
						message: "Audiobookshelf item has no Audible, valid ISBN, or iTunes identifier",
					}),
				);
				expect(result.failures).toContainEqual(
					expect.objectContaining({
						itemIndex: 4,
						stage: "source_fetch",
						sourceIdentifier: "podcast-id/episode-id",
						message: "Failed to fetch Audiobookshelf item progress",
					}),
				);
				expect(result.failures).toContainEqual(
					expect.objectContaining({
						itemIndex: 5,
						stage: "input_transformation",
						sourceIdentifier: "missing-episode",
						message: "Audiobookshelf podcast is missing its current episode",
					}),
				);
			}),
	);

	it.live("maps ownership only when enabled and gives valid EPUB ISBNs precedence", () =>
		Effect.gen(function* () {
			const ownedItems: JsonValue[] = [
				audiobookItem(
					"owned-epub",
					{ title: "EPUB", asin: "ASIN-EPUB", isbn: "978-0-441-01359-3" },
					"epub",
				),
				audiobookItem("owned-audiobook", {
					title: "Audiobook",
					asin: "ASIN-AUDIO",
					isbn: "9780441013593",
				}),
				podcastItem("owned-podcast", 98765),
				audiobookItem("unidentified", { title: "No Identifiers" }),
				audiobookItem(
					"invalid-epub",
					{ title: "Invalid EPUB", asin: "ASIN-BAD-EPUB", isbn: "9780441013594" },
					"epub",
				),
			];
			const state = setup([], {
				syncOwnership: true,
				routes: {
					"/api/libraries": { libraries: [{ id: "library", name: "Library" }] },
					"/api/libraries/library/items?expanded=1&limit=100&page=0": { results: ownedItems },
				},
			});
			const result = yield* state.run();
			const owned = ownedGroups(result);
			expect(result.failures).toEqual([]);
			expect(owned).toHaveLength(3);
			expect(owned.map(({ entityRef }) => entityRef)).toMatchObject([
				{ kind: "unresolved", identifierType: "isbn", identifierValue: "9780441013593" },
				{ kind: "resolved", externalId: "ASIN-AUDIO", entitySchemaSlug: "audiobook" },
				{ kind: "resolved", externalId: "98765", entitySchemaSlug: "podcast" },
			]);
			for (const group of owned) {
				expect(group.events).toEqual([]);
				expect(group.collectionMemberships).toEqual([]);
				expect(group.ownershipProvider).toBe("audiobookshelf");
			}
			expect(state.requests.some(({ url }) => routeKey(url).startsWith("/api/me/progress/"))).toBe(
				false,
			);
		}),
	);

	it.live("pages every ownership library once and continues after a library failure", () =>
		Effect.gen(function* () {
			const firstPage = Array.from({ length: 100 }, (_, index) =>
				audiobookItem(`page-${index}`, { asin: `ASIN-${index}`, title: `Page ${index}` }),
			);
			const pageOne = [audiobookItem("page-last", { asin: "ASIN-LAST", title: "Page last" })];
			const secondLibrary = [
				audiobookItem("library-two", { asin: "ASIN-TWO", title: "Library Two" }),
			];
			const state = setup([], {
				syncOwnership: true,
				routes: {
					"/api/libraries/broken/items?expanded=1&limit=100&page=0": requestFailure,
					"/api/libraries/one/items?expanded=1&limit=100&page=1": { results: pageOne },
					"/api/libraries/one/items?expanded=1&limit=100&page=0": { results: firstPage },
					"/api/libraries/two/items?expanded=1&limit=100&page=0": { results: secondLibrary },
					"/api/libraries/malformed/items?expanded=1&limit=100&page=0": { results: "not-an-array" },
					"/api/libraries": {
						libraries: [
							{ id: "one", name: "One" },
							{ id: "broken", name: "Broken" },
							{ id: "two", name: "Two" },
							{ id: "malformed", name: "Malformed" },
						],
					},
				},
			});
			const result = yield* state.run();
			const owned = ownedGroups(result);
			expect(owned).toHaveLength(102);
			expect(result.failures).toHaveLength(2);
			expect(result.failures).toContainEqual(
				expect.objectContaining({
					itemIndex: 101,
					stage: "source_fetch",
					sourceIdentifier: "broken",
					message: "Failed to fetch Audiobookshelf library items",
				}),
			);
			expect(result.failures).toContainEqual(
				expect.objectContaining({
					itemIndex: 103,
					stage: "source_fetch",
					sourceIdentifier: "malformed",
					message: "Failed to fetch Audiobookshelf library items",
				}),
			);
			const itemIndexes = [
				...owned.map(({ itemIndex }) => itemIndex),
				...result.failures.map(({ itemIndex }) => itemIndex),
			];
			expect(new Set(itemIndexes).size).toBe(itemIndexes.length);
			expect(itemIndexes.sort((left, right) => left - right)).toEqual(
				Array.from({ length: 104 }, (_, index) => index),
			);
			for (const path of [
				"/api/libraries/one/items?expanded=1&limit=100&page=0",
				"/api/libraries/one/items?expanded=1&limit=100&page=1",
				"/api/libraries/broken/items?expanded=1&limit=100&page=0",
				"/api/libraries/two/items?expanded=1&limit=100&page=0",
				"/api/libraries/malformed/items?expanded=1&limit=100&page=0",
			]) {
				expect(state.requests.filter(({ url }) => routeKey(url) === path)).toHaveLength(1);
			}
		}),
	);

	it.live.each(rootFailures)("fails the full task for a $name", ({ routes }) =>
		Effect.gen(function* () {
			const state = setup([], { routes });
			const result = yield* Effect.exit(state.run());
			expect(result._tag).toBe("Failure");
		}),
	);

	it.live("treats an empty in-progress snapshot as successful", () =>
		Effect.gen(function* () {
			const state = setup([]);
			const result = yield* state.run();
			expect(result.failures).toEqual([]);
			expect(result.entityGroups).toEqual([]);
			expect(state.requests.map(({ url }) => routeKey(url))).toEqual([
				"/api/me",
				"/api/me/items-in-progress?limit=1",
			]);
		}),
	);

	it.live("does no work for confirmation input", () =>
		Effect.gen(function* () {
			const state = setup([]);
			const output = yield* runSandboxTestScript(
				definition,
				{
					ingestionConfirmation: {
						part: 0,
						final: true,
						runId: "run",
						confirmed: [],
						batchId: "batch",
						inputFingerprint: "fingerprint",
					},
				},
				state.host,
				execution,
			);
			expect(output).toEqual({ chunkFiles: [], carryFile: null });
			expect(state.integrationReads()).toBe(0);
			expect(state.requests).toEqual([]);
		}),
	);
});
