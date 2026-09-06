import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { DateTime, Effect, Option, Schema } from "@ryot-app/sandbox-sdk/effect";

import { MediaIntegrationAdapterResult } from "../../imports/schemas";
import { MediaSandboxError } from "../../lib/failures";

export const manifest = defineManifest({
	kind: "script",
	name: "Spotify yank",
	slug: "integration.spotify",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: [
		"log",
		"span",
		"httpCall",
		"getCurrentIntegration",
		"getOAuthAccessToken",
		"claimPersistentValue",
	],
});

const Input = Schema.Struct({});

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

const HttpFailureStatus = Schema.Struct({ data: Schema.Struct({ status: Schema.Finite }) });

const RECENTLY_PLAYED_URL = "https://api.spotify.com/v1/me/player/recently-played?limit=50";
const LOWER_BOUND_MARGIN_MS = 60 * 60 * 1_000;
const PLAY_CLAIM_TTL_SECONDS = 30 * 24 * 60 * 60;
const encodePlayClaimKey = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

const spotifyRequestFailure = (error: unknown) =>
	new MediaSandboxError({
		message: Option.match(Schema.decodeUnknownOption(HttpFailureStatus)(error), {
			onNone: () => "Spotify recently played request failed",
			onSome: ({ data }) => `Spotify recently played request returned status ${data.status}`,
		}),
	});

type EntityGroup = MediaIntegrationAdapterResult["entityGroups"][number];

const runSpotifyYank = (
	_input: Schema.Schema.Type<typeof Input>,
	host: SandboxHost<typeof manifest.capabilities>,
) =>
	Effect.gen(function* () {
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
			.pipe(Effect.mapError(spotifyRequestFailure));
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
		for (const play of plays) {
			const claim = yield* host.claimPersistentValue(
				encodePlayClaimKey(["media.spotify-play", integration.id, play.trackId, play.playedAt]),
				true,
				PLAY_CLAIM_TTL_SECONDS,
			);
			if (!claim.claimed) {
				continue;
			}
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
	input: Input,
	run: runSpotifyYank,
	output: MediaIntegrationAdapterResult,
});
