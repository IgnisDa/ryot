import type { ExecutionMetadata, ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { DateTime, Effect, Option, Schema } from "@ryot-app/sandbox-sdk/effect";

import type { MediaIntegrationAdapterResult } from "../../imports/schemas";
import { MediaSandboxError } from "../../lib/failures";
import { captureIntegrationRecords } from "../artifacts";
import { httpFailureStatus, integrationRequestFailure } from "../http";
import { integrationRecordId } from "../identity";
import { IntegrationArtifactOutput, YankInput } from "../schemas";
import { executionStartedAt } from "../shared";
import { confirmIntegrationSource, integrationSourceAttribution } from "../source-state";

export const manifest = defineManifest({
	kind: "script",
	name: "Spotify yank",
	slug: "integration.spotify",
});

const RecentlyPlayed = Schema.Struct({
	items: Schema.Array(
		Schema.Struct({
			played_at: Schema.String,
			track: Schema.NullishOr(
				Schema.Struct({
					name: Schema.String,
					duration_ms: Schema.Finite,
					id: Schema.NullishOr(Schema.String),
				}),
			),
		}),
	),
});

const RECENTLY_PLAYED_URL = "https://api.spotify.com/v1/me/player/recently-played?limit=50";
const LOWER_BOUND_MARGIN_MS = 60 * 60 * 1_000;
const PLAY_CLAIM_TTL_SECONDS = 30 * 24 * 60 * 60;
const encodePlayClaimKey = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

type EntityGroup = MediaIntegrationAdapterResult["entityGroups"][number];

const runSpotifyYank = (
	input: typeof YankInput.Type,
	host: Pick<
		ScriptHost,
		| "log"
		| "span"
		| "httpCall"
		| "getCurrentIntegration"
		| "getOAuthAccessToken"
		| "claimPersistentValue"
		| "getPersistentValue"
	>,
	execution: ExecutionMetadata,
) =>
	Effect.gen(function* () {
		if (input.ingestionConfirmation) {
			return yield* confirmIntegrationSource(input.ingestionConfirmation, host);
		}
		const integration = yield* host.getCurrentIntegration();
		const lowerBound =
			integration.lastFinishedAt === null
				? null
				: DateTime.toEpochMillis(DateTime.makeUnsafe(integration.lastFinishedAt)) -
					LOWER_BOUND_MARGIN_MS;
		const { accessToken } = yield* host.getOAuthAccessToken({ field: "account" });
		const response = yield* host
			.httpCall(
				"GET",
				lowerBound === null ? RECENTLY_PLAYED_URL : `${RECENTLY_PLAYED_URL}&after=${lowerBound}`,
				{ headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } },
			)
			.pipe(
				Effect.mapError((error) =>
					integrationRequestFailure("Spotify recently played", httpFailureStatus(error)),
				),
			);
		const recentlyPlayed = yield* Schema.decodeEffect(Schema.fromJsonString(RecentlyPlayed))(
			response.body,
		).pipe(
			Effect.mapError(
				() => new MediaSandboxError({ message: "Spotify recently played returned invalid JSON" }),
			),
		);
		const validPlays = recentlyPlayed.items.flatMap((item) => {
			const trackId = item.track?.id;
			const playedAt = DateTime.make(item.played_at);
			return item.track && trackId && Option.isSome(playedAt)
				? [
						{
							trackId,
							track: item.track,
							playedAt: item.played_at,
							playedAtMs: DateTime.toEpochMillis(playedAt.value),
						},
					]
				: [];
		});
		const skippedCount = recentlyPlayed.items.length - validPlays.length;
		if (skippedCount > 0) {
			yield* host.log([
				{
					level: "warning",
					attributes: { skippedCount },
					message: "Skipped Spotify plays without a track id or valid play time",
				},
			]);
		}
		const plays = validPlays
			.filter(({ playedAtMs }) => lowerBound === null || playedAtMs > lowerBound)
			.sort((left, right) => left.playedAtMs - right.playedAtMs);
		const groups = new Map<string, EntityGroup>();
		const pending = new Set<string>();
		const expiresAt =
			DateTime.toEpochMillis(DateTime.makeUnsafe(yield* executionStartedAt(execution))) +
			PLAY_CLAIM_TTL_SECONDS * 1000;
		for (const play of plays) {
			const key = encodePlayClaimKey([
				"media.spotify-play",
				integration.id,
				play.trackId,
				play.playedAt,
			]);
			if (pending.has(key) || (yield* host.getPersistentValue(key)) === true) {
				continue;
			}
			pending.add(key);
			const occurredAt = DateTime.formatIso(DateTime.makeUnsafe(play.playedAtMs));
			const group: EntityGroup = groups.get(play.trackId) ?? {
				events: [],
				itemIndex: groups.size,
				collectionMemberships: [],
				entityRef: {
					kind: "resolved",
					externalId: play.trackId,
					entitySchemaSlug: "music",
					sourceLabel: play.track.name,
					providerSlug: "music.spotify",
				},
			};
			groups.set(play.trackId, {
				...group,
				events: [
					...group.events,
					{
						occurredAt,
						eventSchemaSlug: "complete",
						operationId: integrationRecordId(["integration-source-event", key]),
						attribution: integrationSourceAttribution(
							play.trackId,
							play.track.name,
							[key],
							expiresAt,
						),
						properties: {
							consumedOn: "spotify",
							completedOn: occurredAt,
							completionMode: "custom_timestamps",
							timeSpent: Math.round(play.track.duration_ms / 600) / 100,
						},
					},
				],
			});
		}
		const entityGroups = [...groups.values()];
		yield* host.span([
			{
				name: "spotify.recently-played.resolved",
				attributes: {
					skippedCount,
					consideredCount: plays.length,
					emittedGroupCount: entityGroups.length,
					returnedCount: recentlyPlayed.items.length,
					emittedPlayCount: entityGroups.reduce((total, group) => total + group.events.length, 0),
				},
			},
		]);
		return { failures: [], entityGroups };
	});

export default defineScript({
	manifest,
	input: YankInput,
	output: IntegrationArtifactOutput,
	run: (input, host, execution) =>
		runSpotifyYank(input, host, execution).pipe(
			Effect.flatMap((result) => captureIntegrationRecords(manifest.slug, result)),
		),
});
