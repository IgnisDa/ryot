import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { resolvedMediaRef } from "../../imports/source-helpers";
import {
	emptyResult,
	failureResult,
	firstPathText,
	nestedNumber,
	nestedString,
	pathValue,
	progressPercent,
	progressResult,
	showEpisodeRef,
	textValue,
	truthy,
} from "../shared";

const officialJellyfinEvents = new Set([
	"playbackstart",
	"playbackstop",
	"playbackprogress",
	"markplayed",
]);

const jellyfinCompletion = (payload: unknown) => {
	const notificationType = nestedString(payload, ["NotificationType"])?.toLowerCase();
	const event = notificationType ?? nestedString(payload, ["Event"])?.toLowerCase();
	const ignored =
		notificationType === undefined
			? event === "markunplayed"
			: !officialJellyfinEvents.has(notificationType);
	if (ignored) {
		return null;
	}
	return (
		event === "markplayed" ||
		truthy(pathValue(payload, ["PlayedToCompletion"])) ||
		truthy(pathValue(payload, ["Played"])) ||
		truthy(pathValue(payload, ["Item", "UserData", "Played"]))
	);
};

export const parseMediaServer = (
	provider: "Emby" | "Jellyfin",
	rawBody: string,
	integrationSpecifics: unknown,
	occurredAt: string,
	findShow: (
		payload: unknown,
		provider: "tmdb" | "tvdb",
	) => Effect.Effect<string | undefined, { readonly message: string }>,
) =>
	Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(rawBody).pipe(
		Effect.flatMap((payload) =>
			Effect.gen(function* () {
				const completed = provider === "Jellyfin" ? jellyfinCompletion(payload) : false;
				if (completed === null) {
					return emptyResult();
				}
				const itemType = (
					firstPathText(payload, [["ItemType"], ["Item", "Type"]]) ??
					(provider === "Emby"
						? nestedString(payload, ["ItemType", "Type", "MediaType"])
						: undefined)
				)?.toLowerCase();
				let entitySchemaSlug: "movie" | "show" | null = null;
				if (itemType === "movie") {
					entitySchemaSlug = "movie";
				}
				if (itemType === "episode") {
					entitySchemaSlug = "show";
				}
				if (!entitySchemaSlug) {
					return provider === "Jellyfin"
						? emptyResult()
						: failureResult(`${provider} webhook payload has an unsupported media type`);
				}
				const settings = asRecord(integrationSpecifics);
				const configuredUsername =
					typeof settings?.["username"] === "string" ? settings["username"].trim() : "";
				if (provider === "Jellyfin" && configuredUsername) {
					const username = firstPathText(payload, [
						["NotificationUsername"],
						["Username"],
						["User", "Name"],
					]);
					if (username !== configuredUsername) {
						return emptyResult();
					}
				}
				const percent = completed
					? 100
					: progressPercent(
							nestedNumber(
								payload,
								provider === "Jellyfin"
									? ["PlaybackPositionTicks", "PositionTicks"]
									: ["PositionTicks"],
							),
							nestedNumber(payload, ["RunTimeTicks"]),
						);
				if (percent === undefined) {
					return failureResult(`${provider} webhook payload is missing playback timing data`);
				}
				const metadataProvider =
					provider === "Jellyfin" && settings?.["metadataProvider"] === "tvdb" ? "tvdb" : "tmdb";
				const itemKeys = [`Provider_${metadataProvider}`, metadataProvider];
				const officialEpisode =
					provider === "Jellyfin" &&
					entitySchemaSlug === "show" &&
					textValue(pathValue(payload, ["NotificationType"])) !== undefined;
				const embyEpisode = provider === "Emby" && entitySchemaSlug === "show";
				const payloadId =
					entitySchemaSlug === "show"
						? (nestedString(payload, [
								`SeriesProvider_${metadataProvider}`,
								`SeriesProvider${metadataProvider}`,
							]) ??
							textValue(pathValue(payload, ["Series", "ProviderIds", metadataProvider])) ??
							nestedString(payload, itemKeys))
						: nestedString(payload, itemKeys);
				const id =
					officialEpisode || embyEpisode
						? yield* findShow(payload, metadataProvider).pipe(
								Effect.catch((error) =>
									Effect.succeed(
										failureResult(
											`Could not look up ${provider} episode on ${metadataProvider.toUpperCase()}: ${error.message}`,
											"provider_resolution",
										),
									),
								),
							)
						: payloadId;
				if (typeof id === "object") {
					return id;
				}
				if (!id) {
					return failureResult(
						embyEpisode
							? "Could not resolve Emby episode to a TMDB show"
							: `${provider} webhook payload is missing a ${metadataProvider.toUpperCase()} identifier`,
						officialEpisode || embyEpisode ? "provider_resolution" : "input_transformation",
					);
				}
				const label =
					nestedString(
						payload,
						entitySchemaSlug === "show" ? ["SeriesName", "Name", "Title"] : ["Name", "Title"],
					) ?? id;
				const locator =
					entitySchemaSlug === "show"
						? showEpisodeRef(
								nestedNumber(payload, [
									"ParentIndexNumber",
									"SeasonNumber",
									"SeasonNumber00",
									"SeasonNumber000",
								]),
								nestedNumber(payload, [
									"IndexNumber",
									"EpisodeNumber",
									"EpisodeNumber00",
									"EpisodeNumber000",
								]),
							)
						: undefined;
				if (entitySchemaSlug === "show" && !locator) {
					return failureResult(`${provider} webhook payload is missing show episode coordinates`);
				}
				return progressResult({
					occurredAt,
					consumedOn: provider,
					progressPercent: percent,
					...(locator ? { unresolvedEpisode: locator } : {}),
					entityRef: resolvedMediaRef(entitySchemaSlug, metadataProvider, id, label),
				});
			}),
		),
		Effect.orElseSucceed(() => failureResult(`Could not parse ${provider} webhook payload`)),
	);
