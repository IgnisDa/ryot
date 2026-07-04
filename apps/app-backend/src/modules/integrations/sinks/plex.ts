import { Effect, Schema } from "effect";

import { buildMovieOrShowImportRef } from "#modules/imports/sources/shared/provider-refs";

import {
	calculateProgressPercent,
	createProgressResult,
	createShowEpisodeLocator,
	emptySinkResult,
	sinkFailureResult,
	type SinkParser,
} from "./shared";

const CoercedNumber = Schema.Union(Schema.Number, Schema.NumberFromString);

const PlexGuid = Schema.Union(
	Schema.String,
	Schema.Struct({ id: Schema.String }).pipe(
		Schema.annotations({ identifier: "PlexGuidObject", title: "Plex Guid Object" }),
	),
);

const PlexPayload = Schema.Struct({
	event: Schema.String,
	Account: Schema.optional(Schema.Struct({ title: Schema.optional(Schema.String) })),
	Metadata: Schema.Struct({
		type: Schema.optional(Schema.String),
		title: Schema.optional(Schema.String),
		index: Schema.optional(CoercedNumber),
		duration: Schema.optional(CoercedNumber),
		viewOffset: Schema.optional(CoercedNumber),
		parentIndex: Schema.optional(CoercedNumber),
		grandparentTitle: Schema.optional(Schema.String),
		librarySectionType: Schema.optional(Schema.String),
		Guid: Schema.optional(Schema.Array(PlexGuid)),
		Provider_tmdb: Schema.optional(Schema.Union(Schema.String, Schema.Number)),
	}),
});

const decodePlexPayload = Schema.decodeUnknownSync(Schema.parseJson(PlexPayload));

const getMultipartBoundary = (contentType: string): string | undefined => {
	const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
	return match?.[1] ?? match?.[2]?.trim();
};

const getMultipartField = (input: { rawBody: string; contentType: string; fieldName: string }) => {
	if (!input.contentType.toLowerCase().startsWith("multipart/form-data")) {
		throw new Error("Plex webhook payload is not multipart form-data");
	}
	const boundary = getMultipartBoundary(input.contentType);
	if (!boundary) {
		throw new Error("Plex webhook payload is missing a multipart boundary");
	}

	const marker = `--${boundary}`;
	for (const section of input.rawBody.split(marker)) {
		const [rawHeaders, ...rawValueParts] = section.split(/\r?\n\r?\n/);
		if (!rawHeaders?.includes(`name="${input.fieldName}"`)) {
			continue;
		}
		const rawValue = rawValueParts.join("\n\n");
		return rawValue.replace(/\r?\n--$/, "").trim();
	}

	throw new Error(`Plex webhook payload is missing the '${input.fieldName}' field`);
};

const getGuidTmdbId = (
	guids: ReadonlyArray<string | { readonly id: string }> | undefined,
): string | undefined => {
	for (const guid of guids ?? []) {
		const value = typeof guid === "string" ? guid : guid.id;
		const match = value.match(/^tmdb:\/\/(\d+)/i);
		if (match?.[1]) {
			return match[1];
		}
	}
	return undefined;
};

const normalizePlexEvent = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/^media\./, "");

export const parsePlexSink: SinkParser = (input) =>
	Effect.gen(function* () {
		const specs = input.integration.providerSpecifics;
		if (specs.kind !== "plex_sink") {
			throw new Error("Integration is not a Plex sink integration");
		}

		const payloadText = getMultipartField({
			fieldName: "payload",
			rawBody: input.rawBody,
			contentType: input.contentType,
		});
		const payload = decodePlexPayload(payloadText);

		const username = specs.username?.trim();
		if (username && payload.Account?.title !== username) {
			yield* Effect.logDebug("plex webhook user ignored").pipe(
				Effect.annotateLogs({ configuredUser: username, payloadUser: payload.Account?.title }),
			);
			return emptySinkResult();
		}

		const eventType = normalizePlexEvent(payload.event);
		if (!["play", "pause", "resume", "scrobble", "stop"].includes(eventType)) {
			yield* Effect.logDebug("unsupported plex webhook event").pipe(
				Effect.annotateLogs({ event: payload.event }),
			);
			return emptySinkResult();
		}

		let entitySchemaSlug: "show" | "movie" | undefined;
		if (payload.Metadata.type === "episode" || payload.Metadata.librarySectionType === "show") {
			entitySchemaSlug = "show";
		} else if (
			payload.Metadata.type === "movie" ||
			payload.Metadata.librarySectionType === "movie"
		) {
			entitySchemaSlug = "movie";
		}
		if (!entitySchemaSlug) {
			return sinkFailureResult("Plex webhook payload has an unsupported media type");
		}

		const progressPercent =
			calculateProgressPercent(payload.Metadata.viewOffset, payload.Metadata.duration) ??
			(eventType === "scrobble" ? 100 : undefined);
		if (progressPercent === undefined) {
			return sinkFailureResult("Plex webhook payload is missing playback timing data");
		}

		const tmdb = getGuidTmdbId(payload.Metadata.Guid) ?? payload.Metadata.Provider_tmdb?.toString();
		if (!tmdb) {
			return sinkFailureResult("Plex webhook payload is missing a TMDB identifier");
		}

		const sourceLabel =
			entitySchemaSlug === "show"
				? (payload.Metadata.grandparentTitle ?? payload.Metadata.title ?? tmdb)
				: (payload.Metadata.title ?? tmdb);

		const ref = buildMovieOrShowImportRef({ sourceLabel, entitySchemaSlug, providerIds: { tmdb } });
		if (!ref) {
			return sinkFailureResult("Plex webhook payload is missing a TMDB identifier");
		}

		const episodeLocator =
			entitySchemaSlug === "show"
				? createShowEpisodeLocator(payload.Metadata.parentIndex, payload.Metadata.index)
				: undefined;
		if (entitySchemaSlug === "show" && !episodeLocator) {
			return sinkFailureResult("Plex webhook payload is missing show episode coordinates");
		}

		return createProgressResult({
			entityRef: ref,
			progressPercent,
			consumedOn: "plex_sink",
			...(episodeLocator ? { episodeLocator } : {}),
		});
	}).pipe(
		Effect.catchAllDefect(() =>
			Effect.succeed(sinkFailureResult("Could not parse Plex webhook payload")),
		),
	);
