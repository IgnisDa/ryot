import { afterEach, assert, describe, expect, it } from "@effect/vitest";
import type { JsonValue, RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { selectExecutable } from "@ryot-app/sandbox-sdk/workflow";
import { TestClock } from "effect/testing";

import type { ListStateProperties } from "../../../shared/list-state";
import {
	execution,
	hostSuccess,
	httpSuccess,
	integrationRecord,
} from "../../../tests/backend/automations/automation-test-utils";
import type { MediaSourceRecord } from "../../imports/collection-schemas";
import { mediaFilesystem, mediaFilesystemKey } from "../../imports/ingestion.test-support";
import { mediaIntegrations } from "../../imports/references";
import { MediaSandboxError } from "../../lib/failures";
import type { YankInput } from "../schemas";
import definition, { manifest } from "./anilist.sandbox";

const ACCESS_TOKEN = "anilist-private-access-token";
const PRIVATE_RESPONSE_BODY = "private response body";
const NULL_DATE = { day: null, year: null, month: null };
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const entry = (
	id: number,
	mediaId: number,
	status: string,
	options: {
		completedAt?: {
			readonly day: number | null;
			readonly month: number | null;
			readonly year: number | null;
		} | null;
		mediaTitle?: string | null;
		progress?: number | null;
		progressVolumes?: number | null;
		repeat?: number;
		startedAt?: {
			readonly day: number | null;
			readonly month: number | null;
			readonly year: number | null;
		} | null;
		updatedAt?: number;
	} = {},
) => ({
	id,
	status,
	mediaId,
	repeat: options.repeat ?? 0,
	updatedAt: options.updatedAt ?? 1_767_225_600,
	progress: options.progress === undefined ? 0 : options.progress,
	startedAt: options.startedAt === undefined ? NULL_DATE : options.startedAt,
	completedAt: options.completedAt === undefined ? NULL_DATE : options.completedAt,
	progressVolumes: options.progressVolumes === undefined ? 0 : options.progressVolumes,
	media: {
		title:
			options.mediaTitle === null ? null : { userPreferred: options.mediaTitle ?? `Title ${id}` },
	},
});

const viewerResponse = (id = 42): JsonValue => ({ data: { Viewer: { id } } });

const collectionResponse = (entries: readonly JsonValue[], hasNextChunk = false): JsonValue => ({
	data: { MediaListCollection: { hasNextChunk, lists: [{ entries }] } },
});

const snapshot = (sourceEntryId: string, properties: Partial<ListStateProperties> = {}) => ({
	occurredAt: "2025-12-31T12:00:00.000Z",
	id: `snapshot-${sourceEntryId}-${properties.sourceUpdatedAt ?? "old"}`,
	properties: {
		sourceEntryId,
		repeatCount: 0,
		source: "anilist",
		state: "in_progress",
		sourceAccountId: "42",
		sourceUpdatedAt: "2025-12-31T12:00:00.000Z",
		...properties,
	},
});

const snapshotPage = (
	items: ReadonlyArray<ReturnType<typeof snapshot>>,
	pageInfo: {
		readonly hasMore: boolean;
		readonly limit: number;
		readonly nextCursor: string | null;
	} = { limit: 100, hasMore: false, nextCursor: null },
) => rowsResult(items, pageInfo);

type SetupOptions = {
	readonly httpFailures?: readonly (number | undefined)[];
	readonly responses?: readonly JsonValue[];
	readonly settings?: { readonly syncAnime?: boolean; readonly syncManga?: boolean };
	readonly snapshotPages?: readonly unknown[];
};

const setup = (options: SetupOptions = {}) => {
	const requests: Array<{
		readonly body: string;
		readonly headers: Record<string, string> | undefined;
		readonly method: string;
		readonly url: string;
	}> = [];
	const tokenRequests: Array<{ readonly field: string }> = [];
	const invalidations: Array<{ readonly accessToken: string; readonly field: string }> = [];
	const documents: RyotQLDocument[] = [];
	const admittedConnectionId = "connection-1";
	let currentConnectionId = admittedConnectionId;
	let integrationReads = 0;
	let httpIndex = 0;
	let snapshotIndex = 0;
	const host = defineSandboxTestHost(manifest, {
		invalidateOAuthAccessToken: (request) => {
			invalidations.push(request);
			return hostSuccess(null);
		},
		executeRyotql: (document) => {
			documents.push(document);
			const response = options.snapshotPages?.[snapshotIndex];
			snapshotIndex++;
			return hostSuccess({ data: { snapshots: response ?? snapshotPage([]) } });
		},
		getCurrentIntegration: () => {
			integrationReads++;
			return hostSuccess(
				integrationRecord({
					lot: "yank",
					provider: "anilist",
					providerSpecifics: { account: admittedConnectionId, ...options.settings },
				}),
			);
		},
		getOAuthAccessToken: (request) => {
			tokenRequests.push(request);
			if (currentConnectionId !== admittedConnectionId) {
				return Effect.fail({
					message: "OAuth connection is not available to this integration run",
				});
			}
			return hostSuccess({ accessToken: ACCESS_TOKEN, expiresAt: "2026-01-02T00:00:00.000Z" });
		},
		httpCall: (method, url, requestOptions) => {
			requests.push({
				url,
				method,
				body: requestOptions?.body ?? "",
				headers: requestOptions?.headers,
			});
			const status = options.httpFailures?.[httpIndex];
			const response = options.responses?.[httpIndex];
			httpIndex++;
			if (status !== undefined) {
				return Effect.fail({
					message: `HTTP ${status}`,
					data: { status, headers: {}, body: PRIVATE_RESPONSE_BODY },
				});
			}
			if (response === undefined) {
				return Effect.die("Unexpected AniList HTTP request");
			}
			return httpSuccess(response);
		},
	});
	return {
		host,
		requests,
		documents,
		invalidations,
		tokenRequests,
		integrationReads: () => integrationReads,
		setConnectionId: (value: string) => {
			currentConnectionId = value;
		},
	};
};

type AniListSetup = ReturnType<typeof setup>;

const runWindows = (state: AniListSetup, startedAts: readonly string[] = [execution.startedAt]) =>
	Effect.gen(function* () {
		const fs = mediaFilesystem({});
		const records: MediaSourceRecord[] = [];
		const carries: string[] = [];
		let input: typeof YankInput.Type = {};
		for (let window = 0; window < 20; window++) {
			const startedAt = startedAts[Math.min(window, startedAts.length - 1)] ?? execution.startedAt;
			yield* TestClock.setTime(Date.parse(startedAt));
			const output = yield* runSandboxTestScript(definition, input, state.host, {
				...execution,
				startedAt,
			});
			records.push(...(yield* fs.records()));
			if (output.carryFile === null) {
				return { carries, records };
			}
			const carry = fs.scratch.get(output.carryFile);
			assert(carry);
			carries.push(new TextDecoder().decode(carry));
			fs.files.set("carry", carry.slice());
			input = { ingestionArtifacts: { runId: "run", captures: { carry: "durable-carry" } } };
		}
		throw new Error("AniList collector did not finish its bounded windows");
	});

const groups = (records: readonly MediaSourceRecord[]) =>
	records.flatMap(({ group }) => (group ? [group] : []));

const events = (records: readonly MediaSourceRecord[]) =>
	records.flatMap(({ group }) => group?.events ?? []);

afterEach(() => Reflect.deleteProperty(globalThis, mediaFilesystemKey));

describe("AniList yank", () => {
	it("registers the AniList integration adapter", () => {
		expect(selectExecutable(mediaIntegrations, "integration.anilist").scriptSlug).toBe(
			"integration.anilist",
		);
	});

	it.effect(
		"maps anime and manga statuses, zero positions, repeats, and partial dates to snapshots",
		() =>
			Effect.gen(function* () {
				const animeEntries = [
					entry(1, 101, "PLANNING"),
					entry(2, 102, "CURRENT", {
						repeat: 0,
						progress: 0,
						startedAt: { day: 4, year: 2021, month: null },
					}),
					entry(3, 103, "REPEATING"),
					entry(4, 104, "COMPLETED", { completedAt: { month: 6, day: null, year: 2022 } }),
					entry(5, 105, "PAUSED"),
					entry(6, 106, "DROPPED"),
				];
				const state = setup({
					responses: [
						viewerResponse(),
						collectionResponse(animeEntries),
						collectionResponse([entry(7, 207, "COMPLETED", { progress: 0, progressVolumes: 0 })]),
					],
				});
				const result = yield* runWindows(state, [execution.startedAt, "2026-01-02T00:00:00.000Z"]);
				const captured = groups(result.records);
				const stateByExternalId = new Map(
					captured.map(({ entityRef, events: groupEvents }) => [
						entityRef.kind === "resolved" ? entityRef.externalId : "",
						groupEvents[0]?.properties["state"],
					]),
				);
				expect(stateByExternalId).toEqual(
					new Map([
						["101", "backlog"],
						["102", "in_progress"],
						["103", "in_progress"],
						["104", "complete"],
						["105", "on_hold"],
						["106", "dropped"],
						["207", "complete"],
					]),
				);
				const currentAnime = captured.find(
					({ entityRef }) => entityRef.kind === "resolved" && entityRef.externalId === "102",
				);
				expect(currentAnime?.events[0]?.properties).toMatchObject({
					repeatCount: 0,
					animeEpisode: 0,
					source: "anilist",
					sourceEntryId: "2",
					state: "in_progress",
					sourceAccountId: "42",
					startedDate: { day: 4, year: 2021 },
				});
				expect(currentAnime?.events[0]?.properties["startedDate"]).toEqual({ day: 4, year: 2021 });
				expect(currentAnime?.events[0]?.properties["sourceUpdatedAt"]).toBe(
					"2026-01-01T00:00:00.000Z",
				);
				expect(currentAnime?.events[0]?.properties).not.toHaveProperty("completedDate");
				const completedAnime = captured.find(
					({ entityRef }) => entityRef.kind === "resolved" && entityRef.externalId === "104",
				);
				expect(completedAnime?.events[0]?.properties["completedDate"]).toEqual({
					month: 6,
					year: 2022,
				});
				const currentManga = captured.find(
					({ entityRef }) => entityRef.kind === "resolved" && entityRef.externalId === "207",
				);
				expect(currentManga?.entityRef).toMatchObject({
					entitySchemaSlug: "manga",
					providerSlug: "manga.anilist",
				});
				expect(currentManga?.events[0]?.properties).toMatchObject({
					mangaVolume: 0,
					repeatCount: 0,
					mangaChapter: 0,
					state: "complete",
				});
				expect(currentManga?.events[0]?.properties).not.toHaveProperty("startedDate");
				expect(currentManga?.events[0]?.properties).not.toHaveProperty("completedDate");
				expect(
					events(result.records).every(({ eventSchemaSlug }) => eventSchemaSlug === "list-state"),
				).toBe(true);
				expect(
					events(result.records).every(({ occurredAt }) => occurredAt === execution.startedAt),
				).toBe(true);
				expect(Object.keys(currentAnime?.events[0]?.properties ?? {}).sort()).toEqual(
					[
						"animeEpisode",
						"repeatCount",
						"source",
						"sourceAccountId",
						"sourceEntryId",
						"sourceUpdatedAt",
						"startedDate",
						"state",
					].sort(),
				);
				expect(state.requests).toHaveLength(3);
				expect(state.requests.filter(({ body }) => body.includes("Viewer"))).toHaveLength(1);
				expect(decodeJson(state.requests[1]?.body ?? "{}")).toMatchObject({
					variables: { chunk: 1, userId: 42, perChunk: 100, type: "ANIME" },
				});
				expect(decodeJson(state.requests[2]?.body ?? "{}")).toMatchObject({
					variables: { chunk: 1, userId: 42, perChunk: 100, type: "MANGA" },
				});
				expect(
					state.requests.every(
						({ headers }) => headers?.Authorization === `Bearer ${ACCESS_TOKEN}`,
					),
				).toBe(true);
			}),
	);

	it.effect("deduplicates entries repeated across list groups", () =>
		Effect.gen(function* () {
			const duplicate = entry(8, 108, "CURRENT", { mediaTitle: null });
			const state = setup({
				settings: { syncManga: false },
				responses: [
					viewerResponse(),
					{
						data: {
							MediaListCollection: {
								hasNextChunk: false,
								lists: [{ entries: [duplicate] }, { entries: [duplicate] }],
							},
						},
					},
				],
			});
			const result = yield* runWindows(state);
			expect(groups(result.records)).toHaveLength(1);
			expect(groups(result.records)[0]?.entityRef).toMatchObject({ sourceLabel: "8" });
			expect(events(result.records)).toHaveLength(1);
		}),
	);

	it.effect(
		"replays continuation records stably and pins their observation time and source indexes",
		() =>
			Effect.gen(function* () {
				const state = setup({
					settings: { syncManga: false },
					responses: [
						viewerResponse(),
						collectionResponse([entry(10, 110, "CURRENT")], true),
						collectionResponse([entry(11, 111, "CURRENT")]),
						collectionResponse([entry(11, 111, "CURRENT")]),
					],
				});
				const fs = mediaFilesystem({});
				yield* TestClock.setTime(Date.parse(execution.startedAt));
				const first = yield* runSandboxTestScript(definition, {}, state.host, execution);
				const firstRecords = yield* fs.records();
				assert(first.carryFile);
				const carry = fs.scratch.get(first.carryFile);
				assert(carry);
				const carryText = new TextDecoder().decode(carry);
				expect(decodeJson(carryText)).toMatchObject({
					chunk: 2,
					sourceIndex: 1,
					mediaType: "ANIME",
					nextMediaType: null,
					sourceAccountId: "42",
					observationAt: execution.startedAt,
					accountConnectionId: "connection-1",
				});
				expect(carryText).not.toContain(ACCESS_TOKEN);
				expect(carryText).not.toMatch(/token|notes|score|customlist/i);
				fs.files.set("carry", carry.slice());
				const continuation = {
					ingestionArtifacts: { runId: "run", captures: { carry: "durable-carry" } },
				};
				yield* TestClock.setTime(Date.parse("2026-01-02T00:00:00.000Z"));
				yield* runSandboxTestScript(definition, continuation, state.host, {
					...execution,
					startedAt: "2026-01-02T00:00:00.000Z",
				});
				const replayOneRecords = yield* fs.records();
				const replayOneEvent = events(replayOneRecords)[0];
				assert(replayOneEvent);
				fs.files.set("carry", carry.slice());
				const replayTwo = yield* runSandboxTestScript(definition, continuation, state.host, {
					...execution,
					startedAt: "2026-01-03T00:00:00.000Z",
				});
				const replayTwoRecords = yield* fs.records();
				expect(replayTwo.carryFile).toBeNull();
				expect(events(firstRecords)[0]?.occurredAt).toBe(execution.startedAt);
				expect(events(replayTwoRecords)[0]?.occurredAt).toBe(execution.startedAt);
				expect(events(replayTwoRecords)[0]?.operationId).toBe(replayOneEvent.operationId);
				expect(events(replayTwoRecords)[0]?.attribution).toMatchObject({
					sourceIdentifier: "11",
					sourceLabel: "Title 11",
				});
				expect(groups(replayTwoRecords)[0]?.itemIndex).toBe(1);
				expect(state.requests.filter(({ body }) => body.includes("Viewer"))).toHaveLength(1);
				expect(state.tokenRequests).toHaveLength(3);
			}),
	);

	it.effect("rejects a continuation when its OAuth account connection changed", () =>
		Effect.gen(function* () {
			const state = setup({
				responses: [viewerResponse(), collectionResponse([entry(12, 112, "CURRENT")], true)],
			});
			const fs = mediaFilesystem({});
			yield* TestClock.setTime(Date.parse(execution.startedAt));
			const first = yield* runSandboxTestScript(definition, {}, state.host, execution);
			assert(first.carryFile);
			const carry = fs.scratch.get(first.carryFile);
			assert(carry);
			fs.files.set("carry", carry.slice());
			state.setConnectionId("connection-2");
			const error = yield* Effect.flip(
				runSandboxTestScript(
					definition,
					{ ingestionArtifacts: { runId: "run", captures: { carry: "durable-carry" } } },
					state.host,
					execution,
				),
			);
			expect(error).toMatchObject({
				message: "OAuth connection is not available to this integration run",
			});
			expect(state.requests).toHaveLength(2);
			expect(state.tokenRequests).toHaveLength(2);
		}),
	);

	it.effect("does not emit a snapshot when only AniList updatedAt changed", () =>
		Effect.gen(function* () {
			const state = setup({
				settings: { syncManga: false },
				snapshotPages: [snapshotPage([snapshot("20", { animeEpisode: 5 })])],
				responses: [
					viewerResponse(),
					collectionResponse([entry(20, 120, "CURRENT", { progress: 5 })]),
				],
			});
			const result = yield* runWindows(state);
			expect(events(result.records)).toEqual([]);
		}),
	);

	it.effect("emits a new list-state snapshot when progress moves backwards", () =>
		Effect.gen(function* () {
			const state = setup({
				settings: { syncManga: false },
				snapshotPages: [snapshotPage([snapshot("21", { animeEpisode: 10 })])],
				responses: [
					viewerResponse(),
					collectionResponse([entry(21, 121, "CURRENT", { progress: 5 })]),
				],
			});
			const result = yield* runWindows(state);
			expect(events(result.records)).toHaveLength(1);
			expect(events(result.records)[0]?.properties).toMatchObject({
				animeEpisode: 5,
				sourceEntryId: "21",
				state: "in_progress",
			});
		}),
	);

	it.effect("drains snapshot pages until it finds a latest state for every entry", () =>
		Effect.gen(function* () {
			const state = setup({
				settings: { syncManga: false },
				responses: [
					viewerResponse(),
					collectionResponse([entry(30, 130, "CURRENT"), entry(31, 131, "CURRENT")]),
				],
				snapshotPages: [
					snapshotPage(
						[
							snapshot("30", { animeEpisode: 0 }),
							snapshot("30", { animeEpisode: 1, sourceUpdatedAt: "2025-12-30T12:00:00.000Z" }),
						],
						{ limit: 100, hasMore: true, nextCursor: "snapshot-page-2" },
					),
					snapshotPage([snapshot("31", { animeEpisode: 0 })]),
				],
			});
			const result = yield* runWindows(state);
			expect(events(result.records)).toEqual([]);
			expect(state.documents).toHaveLength(2);
			expect(state.documents[1]).toMatchObject({
				queries: { snapshots: { output: { pagination: { after: "snapshot-page-2" } } } },
			});
		}),
	);

	it.effect("keeps malformed entries attributed to their source entry", () =>
		Effect.gen(function* () {
			const state = setup({
				settings: { syncManga: false },
				responses: [viewerResponse(), collectionResponse([{ id: 40, mediaId: 140 }])],
			});
			const result = yield* runWindows(state);
			const failure = result.records.find(({ failure: sourceFailure }) => sourceFailure)?.failure;
			expect(failure).toMatchObject({
				sourceLabel: "40",
				sourceIdentifier: "40",
				entitySchemaSlug: "anime",
				stage: "input_transformation",
				message: "AniList list entry is malformed",
			});
			expect(failure?.operationId).toBeTruthy();
		}),
	);

	it.effect(
		"fails malformed GraphQL collection envelopes without exposing their response body",
		() =>
			Effect.gen(function* () {
				const state = setup({
					responses: [viewerResponse(), { data: { MediaListCollection: { lists: [] } } }],
				});
				const error = yield* Effect.flip(runWindows(state));
				expect(error).toStrictEqual(
					new MediaSandboxError({ message: "AniList GraphQL request failed" }),
				);
				expect(error.message).not.toContain(PRIVATE_RESPONSE_BODY);
				expect(state.documents).toEqual([]);
			}),
	);

	it.effect("fails GraphQL partial data and invalidates the account token for GraphQL 401", () =>
		Effect.gen(function* () {
			const state = setup({
				responses: [{ errors: [{ status: 401 }], data: { Viewer: { id: 42 } } }],
			});
			const error = yield* Effect.flip(runWindows(state));
			expect(error).toStrictEqual(
				new MediaSandboxError({ message: "AniList GraphQL request returned status 401" }),
			);
			expect(state.invalidations).toEqual([{ field: "account", accessToken: ACCESS_TOKEN }]);
			expect(state.requests).toHaveLength(1);
			expect(error.message).not.toContain(ACCESS_TOKEN);
			expect(error.message).not.toContain(PRIVATE_RESPONSE_BODY);
		}),
	);

	it.effect("invalidates the OAuth access token for an HTTP 401 only", () =>
		Effect.gen(function* () {
			const state = setup({ httpFailures: [401] });
			const error = yield* Effect.flip(runWindows(state));
			expect(error).toStrictEqual(
				new MediaSandboxError({ message: "AniList GraphQL request returned status 401" }),
			);
			expect(state.invalidations).toEqual([{ field: "account", accessToken: ACCESS_TOKEN }]);
			expect(error.message).not.toContain(PRIVATE_RESPONSE_BODY);
		}),
	);

	it.effect.each([403, 429, 503])("does not invalidate tokens for GraphQL status %i", (status) =>
		Effect.gen(function* () {
			const state = setup({ responses: [{ errors: [{ status }], data: { Viewer: { id: 42 } } }] });
			const error = yield* Effect.flip(runWindows(state));
			expect(error).toStrictEqual(
				new MediaSandboxError({ message: `AniList GraphQL request returned status ${status}` }),
			);
			expect(state.invalidations).toEqual([]);
		}),
	);

	it.effect.each([403, 429, 503])("does not invalidate tokens for HTTP status %i", (status) =>
		Effect.gen(function* () {
			const state = setup({ httpFailures: [status] });
			const error = yield* Effect.flip(runWindows(state));
			expect(error).toStrictEqual(
				new MediaSandboxError({ message: `AniList GraphQL request returned status ${status}` }),
			);
			expect(state.invalidations).toEqual([]);
			expect(error.message).not.toContain(PRIVATE_RESPONSE_BODY);
		}),
	);

	it.effect("returns no network or state work for confirmation replay", () =>
		Effect.gen(function* () {
			const state = setup();
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
			expect(state.tokenRequests).toEqual([]);
			expect(state.requests).toEqual([]);
			expect(state.documents).toEqual([]);
		}),
	);

	it.effect(
		"filters disabled media types and treats both disabled types as an empty successful sync",
		() =>
			Effect.gen(function* () {
				const mangaOnly = setup({
					settings: { syncAnime: false },
					responses: [viewerResponse(), collectionResponse([entry(50, 150, "PLANNING")])],
				});
				const mangaResult = yield* runWindows(mangaOnly);
				expect(groups(mangaResult.records)[0]?.entityRef).toMatchObject({
					entitySchemaSlug: "manga",
					providerSlug: "manga.anilist",
				});
				expect(decodeJson(mangaOnly.requests[1]?.body ?? "{}")).toMatchObject({
					variables: { type: "MANGA" },
				});

				const disabled = setup({ settings: { syncAnime: false, syncManga: false } });
				const empty = yield* runWindows(disabled);
				expect(empty.records).toEqual([]);
				expect(disabled.requests).toEqual([]);
				expect(disabled.tokenRequests).toEqual([]);
				expect(disabled.documents).toEqual([]);
			}),
	);
});
