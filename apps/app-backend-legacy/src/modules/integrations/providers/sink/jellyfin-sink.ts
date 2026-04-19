import { z } from "zod";

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

const jellyfinUserSchema = z.object({ Name: z.string().optional() }).loose();

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

export const parseJellyfinSink: SinkParser = async (input) => {
	try {
		const payload = parseJsonRecord(input.rawBody);
		const specs = input.integration.providerSpecifics;
		if (specs.kind !== "jellyfin_sink") {
			throw new Error("Integration is not a Jellyfin sink integration");
		}

		const parsedUser = jellyfinUserSchema.safeParse(payload.User);
		const notificationUsername =
			(parsedUser.success ? parsedUser.data.Name : undefined) ??
			getNestedString(payload, ["NotificationUsername"]);
		if (specs.username && notificationUsername !== specs.username) {
			return Promise.resolve(emptySinkResult());
		}

		const entitySchemaSlug = getEntitySchemaSlug(
			getNestedString(payload, ["ItemType", "Type", "MediaType"]),
		);
		if (!entitySchemaSlug) {
			return Promise.resolve({
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: "Jellyfin webhook payload has an unsupported media type",
					}),
				],
			});
		}

		const progressPercent = calculateProgressPercent(
			getNestedNumber(payload, ["PlaybackPositionTicks", "PositionTicks"]),
			getNestedNumber(payload, ["RunTimeTicks"]),
		);
		if (progressPercent === undefined) {
			return Promise.resolve({
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: "Jellyfin webhook payload is missing playback timing data",
					}),
				],
			});
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

		return createProgressResult({
			entityRef: ref,
			consumedOn: "jellyfin_sink",
			progressPercent,
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
					message: "Could not parse Jellyfin webhook payload",
				}),
			],
		};
	}
};
