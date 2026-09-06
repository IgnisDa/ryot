import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import { MediaIntegrationAdapterResult } from "../../imports/schemas";
import { resolvedMediaRef } from "../../imports/source-helpers";
import { asRecord, numberValue, recordsValue } from "../../lib/records";
import { getTmdbAccessToken, tmdbGet, type TmdbHost } from "../../lib/vendors/tmdb";
import {
	emptyResult,
	failureResult,
	jsonRecord,
	progressPercent,
	progressResult,
	showEpisodeRef,
	SinkInput,
	specifics,
	textValue,
	executionStartedAt,
} from "../shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Plex sink",
	requiredSystemConfigKeys: [],
	slug: "integration.plex-sink",
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	capabilities: [
		"getCurrentIntegration",
		"httpCall",
		"getPluginConfig",
		"getCachedValue",
		"setCachedValue",
	],
});

const multipartPayload = (rawBody: string, contentType: string) => {
	const boundary = contentType
		.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
		?.slice(1)
		.find(Boolean)
		?.trim();
	if (!contentType.toLowerCase().startsWith("multipart/form-data") || !boundary) {
		throw new Error("invalid multipart");
	}
	for (const section of rawBody.split(`--${boundary}`)) {
		const [headers, ...parts] = section.split(/\r?\n\r?\n/);
		if (headers?.includes('name="payload"')) {
			return parts
				.join("\n\n")
				.replace(/\r?\n--$/, "")
				.trim();
		}
	}
	throw new Error("missing payload");
};
type PlexEpisode = {
	episodeId: string;
	seriesName: string | undefined;
	seasonNumber: number;
	externalIds: ReadonlyArray<readonly [string, "imdb_id" | "tvdb_id"]>;
};

const showLookupCacheTtlSeconds = 24 * 60 * 60;

const isNotFound = (error: unknown) => asRecord(asRecord(error)?.["data"])?.["status"] === 404;

const tmdbId = (value: unknown) => {
	const id = numberValue(value);
	return id === null ? null : String(Math.trunc(id));
};

const searchTmdbShow = Effect.fnUntraced(function* (
	host: TmdbHost,
	token: string,
	episode: PlexEpisode,
) {
	for (const [externalId, source] of episode.externalIds) {
		const found = yield* tmdbGet(
			host,
			`/find/${encodeURIComponent(externalId)}`,
			{ external_source: source },
			token,
		);
		const showId = tmdbId(recordsValue(found["tv_episode_results"])[0]?.["show_id"]);
		if (showId) {
			return showId;
		}
	}
	if (!episode.seriesName) {
		return null;
	}
	const search = yield* tmdbGet(host, "/search/tv", { query: episode.seriesName }, token);
	for (const show of recordsValue(search["results"]).slice(0, 5)) {
		const showId = tmdbId(show["id"]);
		if (!showId) {
			continue;
		}
		const season = yield* Effect.catchIf(
			tmdbGet(host, `/tv/${showId}/season/${episode.seasonNumber}`, {}, token),
			isNotFound,
			() => Effect.succeed(null),
		);
		if (
			recordsValue(season?.["episodes"]).some(
				(candidate) => tmdbId(candidate["id"]) === episode.episodeId,
			)
		) {
			return showId;
		}
	}
	return null;
});

const findTmdbShow = Effect.fnUntraced(function* (
	host: SandboxHost<typeof manifest.capabilities>,
	episode: PlexEpisode,
) {
	const cacheKey = `tmdb-episode-show:${episode.episodeId}`;
	const cached = asRecord(
		yield* host.getCachedValue(cacheKey).pipe(Effect.orElseSucceed(() => null)),
	);
	if (cached) {
		return typeof cached["showId"] === "string" ? cached["showId"] : null;
	}
	const token = yield* getTmdbAccessToken(host);
	const showId = yield* searchTmdbShow(host, token, episode);
	yield* host.setCachedValue(cacheKey, { showId }, showLookupCacheTtlSeconds).pipe(Effect.ignore);
	return showId;
});

export default defineScript({
	manifest,
	input: SinkInput,
	output: MediaIntegrationAdapterResult,
	run: (input, host, execution) =>
		Effect.gen(function* () {
			const occurredAt = yield* executionStartedAt(execution);
			const integration = yield* host.getCurrentIntegration();
			const parsed = yield* Effect.try(() => {
				const payload = jsonRecord(multipartPayload(input.rawBody, input.contentType));
				const metadata = specifics(payload["Metadata"]);
				if (!metadata) {
					throw new Error("missing metadata");
				}
				const settings = specifics(integration.providerSpecifics);
				const username =
					typeof settings?.["username"] === "string" ? settings["username"].trim() : "";
				if (username && specifics(payload["Account"])?.["title"] !== username) {
					return emptyResult();
				}
				const event = (textValue(payload["event"]) ?? "").toLowerCase().replace(/^media\./, "");
				if (!["play", "pause", "resume", "scrobble", "stop"].includes(event)) {
					return emptyResult();
				}
				let lot: "movie" | "show" | null = null;
				if (metadata["type"] === "episode" || metadata["librarySectionType"] === "show") {
					lot = "show";
				}
				if (metadata["type"] === "movie" || metadata["librarySectionType"] === "movie") {
					lot = "movie";
				}
				if (!lot) {
					return failureResult("Plex webhook payload has an unsupported media type");
				}
				const percent =
					progressPercent(Number(metadata["viewOffset"]), Number(metadata["duration"])) ??
					(event === "scrobble" ? 100 : undefined);
				if (percent === undefined) {
					return failureResult("Plex webhook payload is missing playback timing data");
				}
				const guids = Array.isArray(metadata["Guid"])
					? metadata["Guid"].flatMap((value) => {
							const guid = typeof value === "string" ? value : specifics(value)?.["id"];
							return typeof guid === "string" ? [guid] : [];
						})
					: [];
				const guidId = (prefix: string) =>
					guids
						.map((guid) => guid.match(new RegExp(`^${prefix}://(\\w+)`, "i"))?.[1])
						.find(Boolean);
				const id = guidId("tmdb") ?? textValue(metadata["Provider_tmdb"]);
				if (!id) {
					return failureResult("Plex webhook payload is missing a TMDB identifier");
				}
				const label = textValue(metadata["title"]) ?? id;
				if (lot === "movie") {
					return { id, lot, label, percent };
				}
				const locator = showEpisodeRef(Number(metadata["parentIndex"]), Number(metadata["index"]));
				if (!locator) {
					return failureResult("Plex webhook payload is missing show episode coordinates");
				}
				const seriesName = textValue(metadata["grandparentTitle"]);
				const externalIds = (
					[
						["imdb", "imdb_id"],
						["tvdb", "tvdb_id"],
					] as const
				).flatMap(([prefix, source]) => {
					const externalId = guidId(prefix);
					return externalId ? [[externalId, source] as const] : [];
				});
				return {
					lot,
					percent,
					locator,
					label: seriesName ?? label,
					episode: { seriesName, externalIds, episodeId: id, seasonNumber: locator.seasonNumber },
				};
			}).pipe(Effect.orElseSucceed(() => failureResult("Could not parse Plex webhook payload")));
			if ("entityGroups" in parsed) {
				return parsed;
			}
			if (parsed.lot === "movie") {
				return progressResult({
					occurredAt,
					consumedOn: "plex_sink",
					progressPercent: parsed.percent,
					entityRef: resolvedMediaRef("movie", "tmdb", parsed.id, parsed.label),
				});
			}
			const { label, episode, locator, percent } = parsed;
			return yield* findTmdbShow(host, episode).pipe(
				Effect.map((showId) =>
					showId
						? progressResult({
								occurredAt,
								consumedOn: "plex_sink",
								progressPercent: percent,
								unresolvedEpisode: locator,
								entityRef: resolvedMediaRef("show", "tmdb", showId, label),
							})
						: failureResult(
								`No show found on TMDB for series "${episode.seriesName ?? ""}" and episode ${episode.episodeId}`,
								"provider_resolution",
							),
				),
				Effect.catch((error) =>
					Effect.succeed(
						failureResult(
							`Could not look up Plex episode ${episode.episodeId} on TMDB: ${error.message}`,
							"provider_resolution",
						),
					),
				),
			);
		}),
});
