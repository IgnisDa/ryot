import { describe, expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";

import {
	execution,
	hostSuccess,
	httpSuccess,
	integrationRecord,
} from "../../../tests/backend/automations/automation-test-utils";
import type { MediaIntegrationAdapterResult } from "../../imports/schemas";
import { MediaSandboxError } from "../../lib/failures";
import spotifyDefinition, { manifest as spotifyManifest } from "./spotify.sandbox";

const encodeClaimKey = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const accessToken = "spotify-access-token";
const errorBody = "spotify-error-body";

const play = (
	trackId: string | null,
	playedAt: string,
	name = trackId ?? "",
	durationMs = 200_000,
) => ({ played_at: playedAt, track: { name, id: trackId, duration_ms: durationMs } });

type Response = { status: number; items: Array<Record<string, JsonValue>> };

const setup = (lastFinishedAt: string | null = null) => {
	const claims = new Set<string>();
	const requests: Array<{ url: string; headers: Record<string, string> | undefined }> = [];
	const tokenRequests: Array<{ field: string }> = [];
	const logs: Array<string> = [];
	let response: Response = { items: [], status: 200 };
	const host = defineSandboxTestHost(spotifyManifest, {
		span: () => hostSuccess(null),
		log: (entries) => {
			logs.push(...entries.map(({ message }) => message));
			return hostSuccess(null);
		},
		getOAuthAccessToken: (options) => {
			tokenRequests.push(options);
			return hostSuccess({ accessToken, expiresAt: "2026-01-01T01:00:00.000Z" });
		},
		claimPersistentValue: (key) => {
			if (claims.has(key)) {
				return hostSuccess({ value: true, claimed: false });
			}
			claims.add(key);
			return hostSuccess({ claimed: true });
		},
		getCurrentIntegration: () =>
			hostSuccess(
				integrationRecord({
					lot: "yank",
					lastFinishedAt,
					provider: "spotify",
					providerSpecifics: { account: "connection-1" },
				}),
			),
		httpCall: (_method, url, options) => {
			requests.push({ url, headers: options?.headers });
			return response.status === 200
				? httpSuccess({ items: response.items })
				: Effect.fail({
						message: `HTTP ${response.status}`,
						data: { headers: {}, body: errorBody, status: response.status },
					});
		},
	});
	const run = (next: Response) => {
		response = next;
		return runSandboxTestScript(spotifyDefinition, {}, host, execution);
	};
	return { run, logs, claims, requests, tokenRequests };
};

const playTimes = (result: MediaIntegrationAdapterResult) =>
	result.entityGroups.flatMap((group) =>
		group.events.map((event) => `${group.entityRef.sourceLabel}@${event.occurredAt}`),
	);

describe("Spotify yank", () => {
	it.effect("records each new play as a complete event grouped by track in play order", () =>
		Effect.gen(function* () {
			const { run, claims } = setup();
			const result = yield* run({
				status: 200,
				items: [
					play("track-a", "2026-01-01T12:10:00.000Z", "Song A", 185_123),
					play("track-b", "2026-01-01T12:05:00.000Z", "Song B", 60_000),
					play("track-a", "2026-01-01T12:00:00.000Z", "Song A", 185_123),
				],
			});
			expect(result).toEqual({
				failures: [],
				entityGroups: [
					{
						itemIndex: 0,
						collectionMemberships: [],
						entityRef: {
							kind: "resolved",
							externalId: "track-a",
							sourceLabel: "Song A",
							entitySchemaSlug: "music",
							providerSlug: "music.spotify",
						},
						events: ["2026-01-01T12:00:00.000Z", "2026-01-01T12:10:00.000Z"].map((occurredAt) => ({
							occurredAt,
							eventSchemaSlug: "complete",
							properties: {
								timeSpent: 3.09,
								consumedOn: "spotify",
								completedOn: occurredAt,
								completionMode: "custom_timestamps",
							},
						})),
					},
					{
						itemIndex: 1,
						collectionMemberships: [],
						entityRef: {
							kind: "resolved",
							externalId: "track-b",
							sourceLabel: "Song B",
							entitySchemaSlug: "music",
							providerSlug: "music.spotify",
						},
						events: [
							{
								eventSchemaSlug: "complete",
								occurredAt: "2026-01-01T12:05:00.000Z",
								properties: {
									timeSpent: 1,
									consumedOn: "spotify",
									completionMode: "custom_timestamps",
									completedOn: "2026-01-01T12:05:00.000Z",
								},
							},
						],
					},
				],
			});
			expect([...claims]).toContain(
				encodeClaimKey([
					"media.spotify-play",
					"integration-1",
					"track-a",
					"2026-01-01T12:00:00.000Z",
				]),
			);
		}),
	);

	it.effect("records nothing when a later sync returns the same plays", () =>
		Effect.gen(function* () {
			const { run } = setup();
			const response = { status: 200, items: [play("track-a", "2026-01-01T12:00:00.000Z")] };
			expect(playTimes(yield* run(response))).toEqual(["track-a@2026-01-01T12:00:00.000Z"]);
			expect(playTimes(yield* run(response))).toEqual([]);
		}),
	);

	it.effect("records only the new plays when a sync mixes new and already recorded plays", () =>
		Effect.gen(function* () {
			const { run } = setup();
			yield* run({ status: 200, items: [play("track-a", "2026-01-01T12:00:00.000Z")] });
			const result = yield* run({
				status: 200,
				items: [
					play("track-a", "2026-01-01T12:20:00.000Z"),
					play("track-b", "2026-01-01T12:10:00.000Z"),
					play("track-a", "2026-01-01T12:00:00.000Z"),
				],
			});
			expect(playTimes(result)).toEqual([
				"track-b@2026-01-01T12:10:00.000Z",
				"track-a@2026-01-01T12:20:00.000Z",
			]);
		}),
	);

	it.effect("skips plays without a track id and logs them", () =>
		Effect.gen(function* () {
			const { run, logs } = setup();
			const result = yield* run({
				status: 200,
				items: [
					play(null, "2026-01-01T12:00:00.000Z"),
					{ track: null, played_at: "2026-01-01T12:05:00.000Z" },
					play("track-a", "2026-01-01T12:10:00.000Z"),
				],
			});
			expect(playTimes(result)).toEqual(["track-a@2026-01-01T12:10:00.000Z"]);
			expect(logs).toEqual(["Skipped Spotify plays without a track id or valid play time"]);
		}),
	);

	it.effect.each([401, 500])("fails with only the status when Spotify returns %i", (status) =>
		Effect.gen(function* () {
			const { run } = setup();
			const error = yield* Effect.flip(run({ status, items: [] }));
			expect(error).toStrictEqual(
				new MediaSandboxError({
					message: `Spotify recently played request returned status ${status}`,
				}),
			);
			expect(error.message).not.toContain(accessToken);
			expect(error.message).not.toContain(errorBody);
		}),
	);

	it.effect("sends the account token only as a bearer header and backfills the first sync", () =>
		Effect.gen(function* () {
			const { run, requests, tokenRequests } = setup();
			const result = yield* run({
				status: 200,
				items: [
					play("track-a", "2020-01-01T12:00:00.000Z"),
					play("track-b", "2025-12-31T23:30:00.000Z"),
				],
			});
			expect(playTimes(result)).toEqual([
				"track-a@2020-01-01T12:00:00.000Z",
				"track-b@2025-12-31T23:30:00.000Z",
			]);
			expect(tokenRequests).toEqual([{ field: "account" }]);
			expect(requests).toEqual([
				{
					url: "https://api.spotify.com/v1/me/player/recently-played?limit=50",
					headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
				},
			]);
			expect(requests[0]?.url).not.toContain(accessToken);
		}),
	);

	it.effect("records only plays after the last finished sync minus one hour", () =>
		Effect.gen(function* () {
			const { run, requests } = setup("2026-01-01T12:00:00.000Z");
			const result = yield* run({
				status: 200,
				items: [
					play("track-a", "2026-01-01T12:30:00.000Z"),
					play("track-b", "2026-01-01T11:00:00.001Z"),
					play("track-c", "2026-01-01T11:00:00.000Z"),
					play("track-d", "2026-01-01T10:00:00.000Z"),
				],
			});
			expect(playTimes(result)).toEqual([
				"track-b@2026-01-01T11:00:00.001Z",
				"track-a@2026-01-01T12:30:00.000Z",
			]);
			expect(new URL(requests[0]?.url ?? "").searchParams.get("after")).toBe(
				String(Date.parse("2026-01-01T11:00:00.000Z")),
			);
		}),
	);
});
