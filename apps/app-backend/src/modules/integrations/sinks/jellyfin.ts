import { Effect } from "effect";

import { buildMovieOrShowImportRef } from "#modules/imports/sources/shared/provider-refs";

import {
	calculateProgressPercent,
	createProgressResult,
	createShowEpisodeLocator,
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

export const parseJellyfinSink: SinkParser = (input) =>
	Effect.try(() => {
		const payload = parseJsonRecord(input.rawBody);
		const specs = input.integration.providerSpecifics;
		if (specs.kind !== "jellyfin_sink") {
			throw new Error("Integration is not a Jellyfin sink integration");
		}

		const notificationUsername =
			getNestedString(payload.User, ["Name"]) ?? getNestedString(payload, ["NotificationUsername"]);
		if (specs.username && notificationUsername !== specs.username) {
			return emptySinkResult();
		}

		const entitySchemaSlug = getEntitySchemaSlug(
			getNestedString(payload, ["ItemType", "Type", "MediaType"]),
		);
		if (!entitySchemaSlug) {
			return {
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: "Jellyfin webhook payload has an unsupported media type",
					}),
				],
			};
		}

		const progressPercent = calculateProgressPercent(
			getNestedNumber(payload, ["PlaybackPositionTicks", "PositionTicks"]),
			getNestedNumber(payload, ["RunTimeTicks"]),
		);
		if (progressPercent === undefined) {
			return {
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: "Jellyfin webhook payload is missing playback timing data",
					}),
				],
			};
		}

		const metadataProvider = specs.metadataProvider ?? "tmdb";
		const providerId =
			metadataProvider === "tvdb"
				? entitySchemaSlug === "show"
					? getNestedString(payload, [
							"SeriesProvider_tvdb",
							"SeriesProviderTvdb",
							"Provider_tvdb",
							"ProviderTvdb",
							"Tvdb",
						])
					: getNestedString(payload, ["Provider_tvdb", "ProviderTvdb", "Tvdb"])
				: entitySchemaSlug === "show"
					? getNestedString(payload, [
							"SeriesProvider_tmdb",
							"SeriesProviderTmdb",
							"Provider_tmdb",
							"ProviderTmdb",
							"Tmdb",
						])
					: getNestedString(payload, ["Provider_tmdb", "ProviderTmdb", "Tmdb"]);
		if (!providerId) {
			return {
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: `Jellyfin webhook payload is missing a ${metadataProvider.toUpperCase()} identifier`,
					}),
				],
			};
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
			return {
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: `Jellyfin webhook payload is missing a ${metadataProvider.toUpperCase()} identifier`,
					}),
				],
			};
		}

		const episodeLocator =
			entitySchemaSlug === "show"
				? createShowEpisodeLocator(
						getNestedNumber(payload, ["ParentIndexNumber", "SeasonNumber"]),
						getNestedNumber(payload, ["IndexNumber", "EpisodeNumber"]),
					)
				: undefined;
		if (entitySchemaSlug === "show" && !episodeLocator) {
			return {
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: "Jellyfin webhook payload is missing show episode coordinates",
					}),
				],
			};
		}

		return createProgressResult({
			entityRef: ref,
			progressPercent,
			consumedOn: "jellyfin_sink",
			...(episodeLocator ? { episodeLocator } : {}),
		});
	}).pipe(
		Effect.orElseSucceed(() => ({
			...emptySinkResult(),
			failures: [
				createSinkFailure({
					stage: "input_transformation",
					message: "Could not parse Jellyfin webhook payload",
				}),
			],
		})),
	);
