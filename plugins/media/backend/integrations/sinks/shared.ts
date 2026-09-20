import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import { resolvedMediaRef } from "../../imports/source-helpers";
import {
	emptyResult,
	failureResult,
	nestedNumber,
	nestedString,
	progressPercent,
	pathValue,
	progressResult,
	showEpisodeRef,
	specifics,
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

const jellyfinString = (payload: unknown, paths: string[][]) =>
	paths.map((path) => textValue(pathValue(payload, path))).find(Boolean);

export const parseMediaServer = (
	provider: "Emby" | "Jellyfin",
	rawBody: string,
	integrationSpecifics: unknown,
	occurredAt: string,
) =>
	Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(rawBody).pipe(
		Effect.map((payload) => {
			const completed = provider === "Jellyfin" ? jellyfinCompletion(payload) : false;
			if (completed === null) {
				return emptyResult();
			}
			const itemType = (
				provider === "Jellyfin"
					? jellyfinString(payload, [["ItemType"], ["Item", "Type"]])
					: nestedString(payload, ["ItemType", "Type", "MediaType"])
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
			const settings = specifics(integrationSpecifics);
			const configuredUsername =
				typeof settings?.["username"] === "string" ? settings["username"].trim() : "";
			if (provider === "Jellyfin" && configuredUsername) {
				const username = jellyfinString(payload, [
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
			const id =
				entitySchemaSlug === "show"
					? (nestedString(payload, [
							`SeriesProvider_${metadataProvider}`,
							`SeriesProvider${metadataProvider}`,
						]) ??
						textValue(pathValue(payload, ["Series", "ProviderIds", metadataProvider])) ??
						nestedString(payload, itemKeys))
					: nestedString(payload, itemKeys);
			if (!id) {
				return failureResult(
					`${provider} webhook payload is missing a ${metadataProvider.toUpperCase()} identifier`,
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
				progressPercent: percent,
				consumedOn: provider === "Jellyfin" ? "jellyfin_sink" : "emby",
				...(locator ? { unresolvedEpisode: locator } : {}),
				entityRef: resolvedMediaRef(entitySchemaSlug, metadataProvider, id, label),
			});
		}),
		Effect.orElseSucceed(() => failureResult(`Could not parse ${provider} webhook payload`)),
	);
