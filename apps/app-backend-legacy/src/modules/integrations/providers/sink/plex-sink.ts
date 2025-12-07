import { z } from "zod";

import { buildMovieOrShowImportRef } from "~/modules/imports/sources/shared/provider-refs";

import {
	calculateProgressPercent,
	createProgressResult,
	createSinkFailure,
	emptySinkResult,
	type SinkParser,
} from "./shared";

const plexGuidSchema = z.union([z.string(), z.object({ id: z.string() }).loose()]);

const plexPayloadSchema = z
	.object({
		event: z.string(),
		Account: z.object({ title: z.string().optional() }).loose().optional(),
		Metadata: z
			.object({
				type: z.string().optional(),
				title: z.string().optional(),
				duration: z.coerce.number().optional(),
				grandparentTitle: z.string().optional(),
				viewOffset: z.coerce.number().optional(),
				librarySectionType: z.string().optional(),
				index: z.coerce.number().int().optional(),
				parentIndex: z.coerce.number().int().optional(),
				Guid: z.array(plexGuidSchema).optional(),
				Provider_tmdb: z.union([z.string(), z.number().int()]).optional(),
			})
			.loose(),
	})
	.loose();

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

const getGuidTmdbId = (guids: Array<string | { id: string }> | undefined): string | undefined => {
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

export const parsePlexSink: SinkParser = async (input) => {
	try {
		const specs = input.integration.providerSpecifics;
		if (specs.kind !== "plex_sink") {
			throw new Error("Integration is not a Plex sink integration");
		}

		const payloadText = getMultipartField({
			fieldName: "payload",
			rawBody: input.rawBody,
			contentType: input.contentType,
		});
		const payload = plexPayloadSchema.parse(JSON.parse(payloadText));

		if (specs.username && payload.Account?.title !== specs.username) {
			return Promise.resolve(emptySinkResult());
		}

		const eventType = normalizePlexEvent(payload.event);
		if (!["play", "pause", "resume", "scrobble", "stop"].includes(eventType)) {
			return Promise.resolve(emptySinkResult());
		}

		const entitySchemaSlug =
			payload.Metadata.type === "episode" || payload.Metadata.librarySectionType === "show"
				? "show"
				: payload.Metadata.type === "movie" || payload.Metadata.librarySectionType === "movie"
					? "movie"
					: undefined;
		if (!entitySchemaSlug) {
			return Promise.resolve({
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: "Plex webhook payload has an unsupported media type",
					}),
				],
			});
		}

		const progressPercent =
			calculateProgressPercent(payload.Metadata.viewOffset, payload.Metadata.duration) ??
			(eventType === "scrobble" ? 100 : undefined);
		if (progressPercent === undefined) {
			return Promise.resolve({
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: "Plex webhook payload is missing playback timing data",
					}),
				],
			});
		}

		const tmdb = getGuidTmdbId(payload.Metadata.Guid) ?? payload.Metadata.Provider_tmdb?.toString();
		if (!tmdb) {
			return Promise.resolve({
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: "Plex webhook payload is missing a TMDB identifier",
					}),
				],
			});
		}

		const sourceLabel =
			entitySchemaSlug === "show"
				? (payload.Metadata.grandparentTitle ?? payload.Metadata.title ?? tmdb)
				: (payload.Metadata.title ?? tmdb);

		const ref = buildMovieOrShowImportRef({ sourceLabel, entitySchemaSlug, providerIds: { tmdb } });
		if (!ref) {
			return Promise.resolve({
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: "Plex webhook payload is missing a TMDB identifier",
					}),
				],
			});
		}

		return createProgressResult({
			entityRef: ref,
			progressPercent,
			consumedOn: "plex_sink",
			...(entitySchemaSlug === "show"
				? {
						showSeason: payload.Metadata.parentIndex,
						showEpisode: payload.Metadata.index,
					}
				: {}),
		});
	} catch {
		return Promise.resolve({
			...emptySinkResult(),
			failures: [
				createSinkFailure({
					stage: "input_transformation",
					message: "Could not parse Plex webhook payload",
				}),
			],
		});
	}
};
