import { Effect } from "effect";

import type { MediaImportAdapterResult } from "#modules/imports/media/import-processor";
import { buildMovieOrShowImportRef } from "#modules/imports/sources/shared/provider-refs";

import {
	createProgressResult,
	createShowEpisodeLocator,
	createSinkFailure,
	emptySinkResult,
	parseJsonRecord,
	type SinkParser,
} from "./shared";

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const invalidKodiPayloadResult = (): MediaImportAdapterResult => ({
	...emptySinkResult(),
	failures: [
		createSinkFailure({
			stage: "input_transformation",
			message: "Could not parse Kodi webhook payload",
		}),
	],
});

export const parseKodiSinkPayload = (payload: unknown): MediaImportAdapterResult => {
	if (!isObjectRecord(payload)) {
		return invalidKodiPayloadResult();
	}

	const lot = payload.lot;
	const progress = payload.progress;
	const identifier = payload.identifier;
	const rawSeason = payload.show_season_number;
	const rawEpisode = payload.show_episode_number;

	if (typeof progress !== "number" || !Number.isFinite(progress)) {
		return invalidKodiPayloadResult();
	}

	if (lot !== "movie" && lot !== "show") {
		return invalidKodiPayloadResult();
	}

	const normalizedIdentifier =
		typeof identifier === "string"
			? identifier.trim()
			: typeof identifier === "number" && Number.isFinite(identifier)
				? String(identifier)
				: "";
	const ref = buildMovieOrShowImportRef({
		entitySchemaSlug: lot,
		sourceLabel: normalizedIdentifier,
		providerIds: { tmdb: normalizedIdentifier },
	});
	if (!ref) {
		return {
			...emptySinkResult(),
			failures: [
				createSinkFailure({
					stage: "input_transformation",
					message: "Kodi webhook payload is missing a TMDB identifier",
				}),
			],
		};
	}

	const episodeLocator =
		lot === "show"
			? createShowEpisodeLocator(
					typeof rawSeason === "number" ? rawSeason : undefined,
					typeof rawEpisode === "number" ? rawEpisode : undefined,
				)
			: undefined;
	if (lot === "show" && !episodeLocator) {
		return {
			...emptySinkResult(),
			failures: [
				createSinkFailure({
					stage: "input_transformation",
					message: "Kodi webhook payload is missing show episode coordinates",
				}),
			],
		};
	}

	return createProgressResult({
		entityRef: ref,
		consumedOn: "kodi",
		progressPercent: progress,
		...(episodeLocator ? { episodeLocator } : {}),
	});
};

export const parseKodiSink: SinkParser = (input) =>
	Effect.try(() => parseKodiSinkPayload(parseJsonRecord(input.rawBody))).pipe(
		Effect.orElseSucceed(() => invalidKodiPayloadResult()),
	);
