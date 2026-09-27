import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import { loadMediaApiState, type MediaApiTask, writeMediaApiState } from "./api-collection";
import { normalizeMediaRecords } from "./collection";
import type { MediaSourceInput, MediaSourceRecord } from "./collection-schemas";
import { parseDateInput } from "./dates";
import { createCompleteEvent } from "./helpers";
import { AuthResponse, headers, ItemsResponse } from "./jellyfin";
import { ImportEntityRef } from "./schemas";
import { type HttpHost, requestSourceJson, withSourceRequestOptions } from "./source-api";
import { movieOrShowImportRef } from "./source-helpers";

export const collectJellyfin = Effect.fn(function* (input: MediaSourceInput, host: HttpHost) {
	const state = yield* loadMediaApiState(input, [
		{ page: 0, name: "", context: {}, kind: "auth", path: "Users/AuthenticateByName" },
	]);
	const tasks: MediaApiTask[] = [...state.tasks];
	const credentials = { ...state.credentials };
	const task = tasks.shift();
	if (!task) {
		return yield* writeMediaApiState(state, [], input.itemIndex);
	}
	const requestHost = withSourceRequestOptions(
		host,
		typeof input.settings["allowInsecureConnections"] === "boolean"
			? input.settings["allowInsecureConnections"]
			: undefined,
	);
	const baseUrl = String(input.settings["apiUrl"]);
	const records: MediaSourceRecord[] = [];
	let itemIndex = input.itemIndex;
	if (task.kind === "auth") {
		const username = yield* Schema.decodeUnknownEffect(Schema.String)(input.settings["username"]);
		const body = yield* Schema.encodeEffect(
			Schema.fromJsonString(Schema.Struct({ Pw: Schema.String, Username: Schema.String })),
		)({
			Username: username,
			Pw: typeof input.settings["password"] === "string" ? input.settings["password"] : "",
		});
		const response = yield* requestSourceJson(requestHost, {
			body,
			baseUrl,
			method: "POST",
			path: task.path,
			headers: headers(),
		}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(AuthResponse)));
		credentials["token"] = response.AccessToken;
		credentials["user"] = response.User.Id;
		for (const kind of ["Movie", "Series"]) {
			tasks.push({ kind, page: 0, name: "", context: {}, path: `Users/${response.User.Id}/Items` });
		}
	} else {
		const response = yield* requestSourceJson(requestHost, {
			baseUrl,
			path: task.path,
			headers: headers(credentials["token"]),
			query: {
				Limit: 20,
				Recursive: true,
				Fields: "ProviderIds",
				StartIndex: task.page * 20,
				UserId: credentials["user"],
				...(task.kind === "episodes"
					? { IsPlayed: true }
					: { IncludeItemTypes: task.kind, ...(task.kind === "Movie" ? { IsPlayed: true } : {}) }),
			},
		}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ItemsResponse)));
		if (response.Items.length === 20) {
			tasks.unshift({ ...task, page: task.page + 1 });
		}
		for (const item of response.Items) {
			const index = itemIndex++;
			const ref =
				task.kind === "episodes"
					? yield* Schema.decodeUnknownEffect(ImportEntityRef)(task.context["ref"])
					: movieOrShowImportRef({
							sourceLabel: item.Name,
							entitySchemaSlug: task.kind === "Movie" ? "movie" : "show",
							providerIds: {
								imdb: item.ProviderIds?.Imdb,
								tmdb: item.ProviderIds?.Tmdb,
								tvdb: item.ProviderIds?.Tvdb,
							},
						});
			if (!ref) {
				records.push(
					...normalizeMediaRecords(
						{
							entityGroups: [],
							failures: [
								{
									itemIndex: 0,
									sourceLabel: item.Name,
									sourceIdentifier: item.Id,
									message: "Jellyfin item has no TMDB, TVDB, or IMDb identifier",
								},
							],
						},
						index,
						"jellyfin",
					),
				);
				continue;
			}
			if (task.kind === "Series") {
				tasks.push({
					page: 0,
					name: item.Name,
					kind: "episodes",
					context: { ref },
					path: `Shows/${item.Id}/Episodes`,
				});
				continue;
			}
			const occurredAt = parseDateInput(item.UserData?.LastPlayedDate);
			if (!occurredAt) {
				records.push(
					...normalizeMediaRecords(
						{
							entityGroups: [],
							failures: [
								{
									itemIndex: 0,
									sourceLabel: item.Name,
									sourceIdentifier: item.Id,
									message: "Jellyfin item has no played timestamp",
								},
							],
						},
						index,
						"jellyfin",
					),
				);
				continue;
			}
			if (
				task.kind === "episodes" &&
				(item.IndexNumber === undefined || item.ParentIndexNumber === undefined)
			) {
				records.push(
					...normalizeMediaRecords(
						{
							entityGroups: [],
							failures: [
								{
									itemIndex: 0,
									sourceLabel: item.Name,
									sourceIdentifier: item.Id,
									message: "Jellyfin episode is missing coverage data",
								},
							],
						},
						index,
						"jellyfin",
					),
				);
				continue;
			}
			const event =
				task.kind === "episodes"
					? {
							occurredAt,
							eventSchemaSlug: "progress",
							properties: { progressPercent: 100 },
							unresolvedEpisode: {
								type: "show" as const,
								episodeNumber: item.IndexNumber ?? 0,
								seasonNumber: item.ParentIndexNumber ?? 0,
							},
						}
					: createCompleteEvent({ occurredAt, completedOn: occurredAt });
			records.push(
				...normalizeMediaRecords(
					{
						failures: [],
						entityGroups: [
							{
								itemIndex: 0,
								entityRef: ref,
								events: [event],
								collectionMemberships: item.UserData?.IsFavorite
									? [{ collectionName: "Favorites" }]
									: [],
							},
						],
					},
					index,
					"jellyfin",
				),
			);
		}
	}
	return yield* writeMediaApiState({ tasks, credentials }, records, itemIndex);
});
