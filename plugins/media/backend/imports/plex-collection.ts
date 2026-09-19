import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import { loadMediaApiState, type MediaApiTask, writeMediaApiState } from "./api-collection";
import { normalizeMediaRecords } from "./collection";
import type { MediaSourceInput, MediaSourceRecord } from "./collection-schemas";
import { parseDateInput } from "./dates";
import { createCompleteEvent } from "./helpers";
import { DirectoriesResponse, MetadataResponse, providerIds } from "./plex";
import { ImportEntityRef } from "./schemas";
import { type HttpHost, requestSourceJson, withSourceRequestOptions } from "./source-api";
import { movieOrShowImportRef } from "./source-helpers";

export const collectPlex = Effect.fn(function* (input: MediaSourceInput, host: HttpHost) {
	const state = yield* loadMediaApiState(input, [
		{ page: 0, name: "", context: {}, kind: "root", path: "library/sections" },
	]);
	const tasks: MediaApiTask[] = [...state.tasks];
	const task = tasks.shift();
	if (!task) {
		return yield* writeMediaApiState(state, [], input.itemIndex);
	}
	const fetch = (path: string, query?: Record<string, number>) =>
		requestSourceJson(
			withSourceRequestOptions(
				host,
				typeof input.settings["allowInsecureConnections"] === "boolean"
					? input.settings["allowInsecureConnections"]
					: undefined,
			),
			{
				path,
				baseUrl: String(input.settings["apiUrl"]),
				headers: { Accept: "application/json", "X-Plex-Token": String(input.settings["apiKey"]) },
				...(query ? { query } : {}),
			},
		);
	const records: MediaSourceRecord[] = [];
	let itemIndex = input.itemIndex;
	if (task.kind === "root") {
		const response = yield* fetch(task.path).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(DirectoriesResponse)),
		);
		for (const directory of response.MediaContainer.Directory) {
			if (directory.type === "movie" || directory.type === "show") {
				tasks.push({
					page: 0,
					context: {},
					kind: directory.type,
					name: directory.title,
					path: `library/sections/${directory.key}/all`,
				});
			}
		}
	} else {
		const response = yield* fetch(task.path, {
			includeGuids: 1,
			"X-Plex-Container-Size": 20,
			"X-Plex-Container-Start": task.page * 20,
		}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(MetadataResponse)));
		const rows = response.MediaContainer.Metadata ?? [];
		if (rows.length === 20) {
			tasks.unshift({ ...task, page: task.page + 1 });
		}
		for (const item of rows) {
			const index = itemIndex++;
			const occurredAt = parseDateInput(item.lastViewedAt, { unixSeconds: true });
			if (!occurredAt) {
				continue;
			}
			const ref =
				task.kind === "leaves"
					? yield* Schema.decodeUnknownEffect(ImportEntityRef)(task.context["ref"])
					: movieOrShowImportRef({
							sourceLabel: item.title,
							providerIds: providerIds(item.Guid),
							entitySchemaSlug: task.kind === "movie" ? "movie" : "show",
						});
			if (!ref) {
				records.push(
					...normalizeMediaRecords(
						{
							entityGroups: [],
							failures: [
								{
									itemIndex: 0,
									sourceLabel: item.title,
									sourceIdentifier: item.key,
									message: "Plex item has no TMDB, TVDB, or IMDb identifier",
								},
							],
						},
						index,
						"plex",
					),
				);
				continue;
			}
			if (task.kind === "show") {
				if (item.ratingKey) {
					tasks.push({
						page: 0,
						kind: "leaves",
						name: item.title,
						context: { ref },
						path: `library/metadata/${item.ratingKey}/allLeaves`,
					});
				} else {
					records.push(
						...normalizeMediaRecords(
							{
								entityGroups: [],
								failures: [
									{
										itemIndex: 0,
										sourceLabel: item.title,
										sourceIdentifier: item.key,
										message: "Plex show has no rating key",
									},
								],
							},
							index,
							"plex",
						),
					);
				}
				continue;
			}
			if (task.kind === "leaves" && (item.index === undefined || item.parentIndex === undefined)) {
				continue;
			}
			const event =
				task.kind === "leaves"
					? {
							occurredAt,
							eventSchemaSlug: "progress",
							properties: { progressPercent: 100 },
							unresolvedEpisode: {
								type: "show" as const,
								episodeNumber: item.index ?? 0,
								seasonNumber: item.parentIndex ?? 0,
							},
						}
					: createCompleteEvent({ occurredAt, completedOn: occurredAt });
			records.push(
				...normalizeMediaRecords(
					{
						failures: [],
						entityGroups: [
							{ itemIndex: 0, entityRef: ref, events: [event], collectionMemberships: [] },
						],
					},
					index,
					"plex",
				),
			);
		}
	}
	return yield* writeMediaApiState({ ...state, tasks }, records, itemIndex);
});
