import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import { loadMediaApiState, type MediaApiTask, writeMediaApiState } from "./api-collection";
import { episodeNumber, Item, itemRef, Libraries, Listing } from "./audiobookshelf";
import { normalizeMediaRecords } from "./collection";
import type { MediaSourceInput, MediaSourceRecord } from "./collection-schemas";
import { createCompleteEvent } from "./helpers";
import { ImportEntityRef } from "./schemas";
import { type HttpHost, requestSourceJson, withSourceRequestOptions } from "./source-api";

export const collectAudiobookshelf = Effect.fn(function* (input: MediaSourceInput, host: HttpHost) {
	const state = yield* loadMediaApiState(input, [
		{ page: 0, name: "", context: {}, kind: "root", path: "libraries" },
	]);
	const tasks: MediaApiTask[] = [...state.tasks];
	const task = tasks.shift();
	const credentials = { ...state.credentials };
	if (!task) {
		return yield* writeMediaApiState(state, [], input.itemIndex);
	}
	const apiUrl = String(input.settings["apiUrl"]).replace(/\/+$/, "");
	const baseUrl = apiUrl.endsWith("/api") ? apiUrl : `${apiUrl}/api`;
	const requestHost = withSourceRequestOptions(
		host,
		typeof input.settings["allowInsecureConnections"] === "boolean"
			? input.settings["allowInsecureConnections"]
			: undefined,
	);
	const fetch = (path: string, query?: Record<string, string | number>) =>
		requestSourceJson(requestHost, {
			path,
			baseUrl,
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${String(input.settings["apiKey"])}`,
			},
			...(query ? { query } : {}),
		});
	const records: MediaSourceRecord[] = [];
	let itemIndex = input.itemIndex;
	if (task.kind === "root") {
		const response = yield* fetch(task.path).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(Libraries)),
		);
		for (const library of response.libraries) {
			tasks.push({
				page: 0,
				kind: "listing",
				name: library.name ?? "",
				path: `libraries/${library.id}/items`,
				context: { mediaType: library.mediaType ?? "" },
			});
		}
	} else if (task.kind === "listing") {
		const response = yield* fetch(task.path, {
			limit: 20,
			expanded: 1,
			page: task.page,
			...(task.context["mediaType"] === "book" ? { filter: "progress.ZmluaXNoZWQ=" } : {}),
		}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Listing)));
		if (response.results.length === 20) {
			tasks.unshift({ ...task, page: task.page + 1 });
		}
		for (const item of response.results) {
			const index = itemIndex++;
			const ref = itemRef(item);
			if (!ref) {
				records.push(
					...normalizeMediaRecords(
						{
							entityGroups: [],
							failures: [
								{
									itemIndex: 0,
									sourceIdentifier: item.id,
									stage: "input_transformation",
									sourceLabel: item.media?.metadata.title ?? item.name,
									message: "Audiobookshelf item has no Audible, valid ISBN, or iTunes identifier",
								},
							],
						},
						index,
						"audiobookshelf",
					),
				);
				continue;
			}
			if (ref.entitySchemaSlug === "podcast") {
				tasks.push({
					page: 0,
					kind: "podcast",
					name: task.name,
					path: `items/${item.id}`,
					context: { ref, itemIndex: index },
				});
				continue;
			}
			records.push(
				...normalizeMediaRecords(
					{
						failures: [],
						entityGroups: [
							{
								itemIndex: 0,
								entityRef: ref,
								collectionMemberships: task.name.trim() ? [{ collectionName: task.name }] : [],
								events: [
									createCompleteEvent({
										occurredAt: input.importedAt,
										completedOn: input.importedAt,
									}),
								],
							},
						],
					},
					index,
					"audiobookshelf",
				),
			);
		}
	} else if (task.kind === "podcast") {
		const response = yield* fetch(task.path, { expanded: 1, include: "progress" }).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(Item)),
		);
		const taskItemIndex = yield* Schema.decodeUnknownEffect(Schema.Int)(task.context["itemIndex"]);
		credentials[`finished-${taskItemIndex}`] = "0";
		for (const episode of response.media?.episodes ?? []) {
			if (episode.id) {
				tasks.push({
					...task,
					kind: "episode",
					context: {
						...task.context,
						episodeId: episode.id,
						episodeNumber: episodeNumber(episode),
					},
				});
			}
		}
		tasks.push({ ...task, kind: "finish" });
	} else if (task.kind === "finish") {
		const ref = yield* Schema.decodeUnknownEffect(ImportEntityRef)(task.context["ref"]);
		const taskItemIndex = yield* Schema.decodeUnknownEffect(Schema.Int)(task.context["itemIndex"]);
		const key = `finished-${taskItemIndex}`;
		if (credentials[key] === "0") {
			records.push(
				...normalizeMediaRecords(
					{
						entityGroups: [],
						failures: [
							{
								itemIndex: 0,
								sourceLabel: ref.sourceLabel,
								sourceIdentifier: task.path.slice("items/".length),
								message:
									"Audiobookshelf podcast has no finished episodes with importable episode numbers",
							},
						],
					},
					Number(task.context["itemIndex"]),
					"audiobookshelf",
				),
			);
		}
		delete credentials[key];
	} else {
		const ref = yield* Schema.decodeUnknownEffect(ImportEntityRef)(task.context["ref"]);
		const episodeId = yield* Schema.decodeUnknownEffect(Schema.String)(task.context["episodeId"]);
		const response = yield* fetch(task.path, {
			expanded: 1,
			episode: episodeId,
			include: "progress",
		}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Item)));
		const number = task.context["episodeNumber"];
		if (response.userMediaProgress?.isFinished && typeof number === "number") {
			const index = Number(task.context["itemIndex"]);
			const key = `finished-${index}`;
			credentials[key] = String(Number(credentials[key] ?? 0) + 1);
			records.push(
				...normalizeMediaRecords(
					{
						failures: [],
						entityGroups: [
							{
								itemIndex: 0,
								entityRef: ref,
								collectionMemberships: task.name.trim() ? [{ collectionName: task.name }] : [],
								events: [
									{
										eventSchemaSlug: "progress",
										occurredAt: input.importedAt,
										properties: { progressPercent: 100 },
										unresolvedEpisode: { type: "podcast", episodeNumber: number },
										operationId: yield* Schema.encodeEffect(
											Schema.fromJsonString(Schema.Array(Schema.Unknown)),
										)(["audiobookshelf", index, task.context["episodeId"]]),
									},
								],
							},
						],
					},
					index,
					"audiobookshelf",
				),
			);
		}
	}
	return yield* writeMediaApiState({ tasks, credentials }, records, itemIndex);
});
