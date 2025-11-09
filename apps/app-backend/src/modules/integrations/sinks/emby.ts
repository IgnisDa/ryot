import { buildMovieOrShowImportRef } from "#modules/imports/sources/shared/provider-refs";

import {
	calculateProgressPercent,
	createProgressResult,
	createShowEpisodeLocator,
	getMediaEntitySchemaSlug,
	getNestedNumber,
	getNestedString,
	parseJsonRecord,
	sinkFailureResult,
	type SinkParser,
	wrapSinkParser,
} from "./shared";

export const parseEmbySink: SinkParser = (input) =>
	wrapSinkParser("Emby", () => {
		const payload = parseJsonRecord(input.rawBody);
		const entitySchemaSlug = getMediaEntitySchemaSlug(
			getNestedString(payload, ["ItemType", "Type", "MediaType"]),
		);
		if (!entitySchemaSlug) {
			return sinkFailureResult("Emby webhook payload has an unsupported media type");
		}

		const progressPercent = calculateProgressPercent(
			getNestedNumber(payload, ["PositionTicks"]),
			getNestedNumber(payload, ["RunTimeTicks"]),
		);
		if (progressPercent === undefined) {
			return sinkFailureResult("Emby webhook payload is missing playback timing data");
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
			return sinkFailureResult("Emby webhook payload is missing a TMDB identifier");
		}

		const sourceLabel =
			entitySchemaSlug === "show"
				? (getNestedString(payload, ["SeriesName", "Name", "Title"]) ?? tmdb)
				: (getNestedString(payload, ["Name", "Title"]) ?? tmdb);

		const ref = buildMovieOrShowImportRef({ sourceLabel, entitySchemaSlug, providerIds: { tmdb } });
		if (!ref) {
			return sinkFailureResult("Emby webhook payload is missing a TMDB identifier");
		}

		const episodeLocator =
			entitySchemaSlug === "show"
				? createShowEpisodeLocator(
						getNestedNumber(payload, ["ParentIndexNumber", "SeasonNumber"]),
						getNestedNumber(payload, ["IndexNumber", "EpisodeNumber"]),
					)
				: undefined;
		if (entitySchemaSlug === "show" && !episodeLocator) {
			return sinkFailureResult("Emby webhook payload is missing show episode coordinates");
		}

		return createProgressResult({
			entityRef: ref,
			progressPercent,
			consumedOn: "emby",
			...(episodeLocator ? { episodeLocator } : {}),
		});
	});
