import { buildMovieOrShowImportRef } from "#modules/imports/sources/shared/provider-refs";

import {
	calculateProgressPercent,
	createProgressResult,
	createShowEpisodeLocator,
	emptySinkResult,
	getMediaEntitySchemaSlug,
	getNestedNumber,
	getNestedString,
	parseJsonRecord,
	sinkFailureResult,
	type SinkParser,
	wrapSinkParser,
} from "./shared";

export const parseJellyfinSink: SinkParser = (input) =>
	wrapSinkParser("Jellyfin", () => {
		const payload = parseJsonRecord(input.rawBody);
		const specs = input.integration.providerSpecifics;
		if (specs.kind !== "jellyfin_sink") {
			throw new Error("Integration is not a Jellyfin sink integration");
		}

		const notificationUsername =
			getNestedString(payload["User"], ["Name"]) ??
			getNestedString(payload, ["NotificationUsername"]);
		if (specs.username && notificationUsername !== specs.username) {
			return emptySinkResult();
		}

		const entitySchemaSlug = getMediaEntitySchemaSlug(
			getNestedString(payload, ["ItemType", "Type", "MediaType"]),
		);
		if (!entitySchemaSlug) {
			return sinkFailureResult("Jellyfin webhook payload has an unsupported media type");
		}

		const progressPercent = calculateProgressPercent(
			getNestedNumber(payload, ["PlaybackPositionTicks", "PositionTicks"]),
			getNestedNumber(payload, ["RunTimeTicks"]),
		);
		if (progressPercent === undefined) {
			return sinkFailureResult("Jellyfin webhook payload is missing playback timing data");
		}

		const metadataProvider = specs.metadataProvider ?? "tmdb";
		let providerId: string | undefined;
		if (metadataProvider === "tvdb") {
			providerId =
				entitySchemaSlug === "show"
					? getNestedString(payload, [
							"SeriesProvider_tvdb",
							"SeriesProviderTvdb",
							"Provider_tvdb",
							"ProviderTvdb",
							"Tvdb",
						])
					: getNestedString(payload, ["Provider_tvdb", "ProviderTvdb", "Tvdb"]);
		} else {
			providerId =
				entitySchemaSlug === "show"
					? getNestedString(payload, [
							"SeriesProvider_tmdb",
							"SeriesProviderTmdb",
							"Provider_tmdb",
							"ProviderTmdb",
							"Tmdb",
						])
					: getNestedString(payload, ["Provider_tmdb", "ProviderTmdb", "Tmdb"]);
		}
		if (!providerId) {
			return sinkFailureResult(
				`Jellyfin webhook payload is missing a ${metadataProvider.toUpperCase()} identifier`,
			);
		}

		const sourceLabel =
			entitySchemaSlug === "show"
				? (getNestedString(payload, ["SeriesName", "Name", "Title"]) ?? providerId)
				: (getNestedString(payload, ["Name", "Title"]) ?? providerId);

		const ref = buildMovieOrShowImportRef({
			sourceLabel,
			entitySchemaSlug,
			providerIds: metadataProvider === "tvdb" ? { tvdb: providerId } : { tmdb: providerId },
		});
		if (!ref) {
			return sinkFailureResult(
				`Jellyfin webhook payload is missing a ${metadataProvider.toUpperCase()} identifier`,
			);
		}

		const episodeLocator =
			entitySchemaSlug === "show"
				? createShowEpisodeLocator(
						getNestedNumber(payload, ["ParentIndexNumber", "SeasonNumber"]),
						getNestedNumber(payload, ["IndexNumber", "EpisodeNumber"]),
					)
				: undefined;
		if (entitySchemaSlug === "show" && !episodeLocator) {
			return sinkFailureResult("Jellyfin webhook payload is missing show episode coordinates");
		}

		return createProgressResult({
			entityRef: ref,
			progressPercent,
			consumedOn: "jellyfin_sink",
			...(episodeLocator ? { episodeLocator } : {}),
		});
	});
