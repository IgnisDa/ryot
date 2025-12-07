import { buildMovieOrShowImportRef } from "~/modules/imports/sources/shared/provider-refs";

import {
	calculateProgressPercent,
	createProgressResult,
	createSinkFailure,
	emptySinkResult,
	getNestedNumber,
	getNestedString,
	parseJsonRecord,
	type SinkParser,
} from "./shared";

const getEntitySchemaSlug = (itemType: string | undefined) => {
	const normalized = itemType?.trim().toLowerCase();
	if (normalized === "movie") {
		return "movie" as const;
	}
	if (normalized === "episode") {
		return "show" as const;
	}
	return undefined;
};

export const parseEmbySink: SinkParser = async (input) => {
	try {
		const payload = parseJsonRecord(input.rawBody);
		const entitySchemaSlug = getEntitySchemaSlug(
			getNestedString(payload, ["ItemType", "Type", "MediaType"]),
		);
		if (!entitySchemaSlug) {
			return Promise.resolve({
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: "Emby webhook payload has an unsupported media type",
					}),
				],
			});
		}

		const progressPercent = calculateProgressPercent(
			getNestedNumber(payload, ["PositionTicks"]),
			getNestedNumber(payload, ["RunTimeTicks"]),
		);
		if (progressPercent === undefined) {
			return {
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: "Emby webhook payload is missing playback timing data",
					}),
				],
			};
		}

		const tmdb =
			entitySchemaSlug === "show"
				? getNestedString(payload, [
						"SeriesProvider_tmdb",
						"SeriesProviderTmdb",
						"Provider_tmdb",
						"ProviderTmdb",
						"Tmdb",
					])
				: getNestedString(payload, ["Provider_tmdb", "ProviderTmdb", "Tmdb"]);
		if (!tmdb) {
			return {
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: "Emby webhook payload is missing a TMDB identifier",
					}),
				],
			};
		}

		const sourceLabel =
			entitySchemaSlug === "show"
				? (getNestedString(payload, ["SeriesName", "Name", "Title"]) ?? tmdb)
				: (getNestedString(payload, ["Name", "Title"]) ?? tmdb);

		const ref = buildMovieOrShowImportRef({ sourceLabel, entitySchemaSlug, providerIds: { tmdb } });
		if (!ref) {
			return {
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: "Emby webhook payload is missing a TMDB identifier",
					}),
				],
			};
		}

		return createProgressResult({
			entityRef: ref,
			progressPercent,
			consumedOn: "emby",
			...(entitySchemaSlug === "show"
				? {
						showSeason: getNestedNumber(payload, ["ParentIndexNumber", "SeasonNumber"]),
						showEpisode: getNestedNumber(payload, ["IndexNumber", "EpisodeNumber"]),
					}
				: {}),
		});
	} catch {
		return {
			...emptySinkResult(),
			failures: [
				createSinkFailure({
					stage: "input_transformation",
					message: "Could not parse Emby webhook payload",
				}),
			],
		};
	}
};
