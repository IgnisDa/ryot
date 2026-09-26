import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import { loadMediaApiState, type MediaApiTask, writeMediaApiState } from "./api-collection";
import {
	compareMediaRecords,
	mediaRecordReader,
	normalizeMediaRecords,
	readMediaCapture,
	serializeMediaRecords,
	sourceOutput,
	writeMediaCapture,
} from "./collection";
import type { MediaSourceInput, MediaSourceRecord } from "./collection-schemas";
import { parseDateInput } from "./dates";
import { createCompleteEvent, createReviewEvent, normalizeLifecycleStatus } from "./helpers";
import {
	Details,
	entityRef,
	fallbackDate,
	Item,
	label,
	lifecycleEvent,
	List,
} from "./media-tracker";
import type { ImportMediaEvent } from "./schemas";
import { type HttpHost, requestSourceJson, withSourceRequestOptions } from "./source-api";

const Descriptor = Schema.Struct({ item: Item, list: Schema.optional(Schema.String) });
const DetailState = Schema.Struct({
	id: Schema.Int,
	seenOffset: Schema.Int,
	recordIndex: Schema.Int,
	details: Schema.NullOr(Details),
	message: Schema.NullOr(Schema.String),
});
export const collectMediaTracker = Effect.fn(function* (input: MediaSourceInput, host: HttpHost) {
	const apiUrl = String(input.settings["apiUrl"]).replace(/\/+$/, "");
	const baseUrl = apiUrl.endsWith("/api") ? apiUrl : `${apiUrl}/api`;
	const requestHost = withSourceRequestOptions(
		host,
		typeof input.settings["allowInsecureConnections"] === "boolean"
			? input.settings["allowInsecureConnections"]
			: undefined,
	);
	const fetch = (path: string, query?: Record<string, number>) =>
		requestSourceJson(requestHost, {
			path,
			baseUrl,
			headers: { Accept: "application/json", "access-token": String(input.settings["apiKey"]) },
			...(query ? { query } : {}),
		});
	if (input.action === "normalize") {
		const read = mediaRecordReader();
		const next = yield* read("records", input.offset);
		if (!next) {
			return yield* sourceOutput({
				...(yield* writeMediaCapture([
					{ contents: "", name: "records.jsonl" },
					...(input.ingestionArtifacts?.captures["carry"]
						? [{ name: "details.json", contents: yield* readMediaCapture("carry") }]
						: []),
				])),
				done: true,
				offset: input.offset,
				itemIndex: input.itemIndex,
				carryFile: input.ingestionArtifacts?.captures["carry"] ? "details.json" : null,
			});
		}
		const descriptor = yield* Schema.decodeUnknownEffect(Descriptor)(next.record.raw);
		const prior = input.ingestionArtifacts?.captures["carry"]
			? yield* Schema.decodeEffect(Schema.fromJsonString(DetailState))(
					new TextDecoder().decode(yield* readMediaCapture("carry")),
				)
			: null;
		const fetched =
			prior?.id === descriptor.item.id
				? { details: prior.details, message: prior.message }
				: yield* fetch(`details/${descriptor.item.id}`).pipe(
						Effect.flatMap(Schema.decodeUnknownEffect(Details)),
						Effect.map((details) => ({ details, message: null })),
						Effect.orElseSucceed(() => ({
							details: null,
							message: "Failed to fetch MediaTracker item details",
						})),
					);
		const details = fetched.details;
		if (!details) {
			return yield* sourceOutput({
				...(yield* writeMediaCapture([
					{
						name: "records.jsonl",
						contents: serializeMediaRecords(
							normalizeMediaRecords(
								{
									entityGroups: [],
									failures: [
										{
											itemIndex: 0,
											stage: "source_fetch",
											sourceIdentifier: String(descriptor.item.id),
											message: fetched.message ?? "Failed to fetch MediaTracker item details",
										},
									],
								},
								next.record.itemIndex,
								"media_tracker",
							),
						),
					},
					{
						name: "details.json",
						contents: yield* Schema.encodeEffect(Schema.fromJsonString(DetailState))({
							details: null,
							seenOffset: 0,
							id: descriptor.item.id,
							message: fetched.message,
							recordIndex: next.record.itemIndex,
						}),
					},
				])),
				offset: next.next,
				carryFile: "details.json",
				itemIndex: input.itemIndex + 1,
			});
		}
		const type = descriptor.item.mediaType;
		const sourceLabel = type
			? label(descriptor.item.id, type, details)
			: `MediaTracker ${descriptor.item.id}`;
		const ref = type ? entityRef(details, type, sourceLabel) : null;
		const index = next.record.itemIndex;
		const seenOffset = prior?.recordIndex === index ? prior.seenOffset : 0;
		let nextSeenOffset = 0;
		const events: ImportMediaEvent[] = [];
		const collectionMemberships = [];
		if (descriptor.list) {
			const lifecycle = normalizeLifecycleStatus(descriptor.list);
			const event = lifecycle
				? lifecycleEvent(lifecycle, fallbackDate(details, input.importedAt))
				: null;
			if (event) {
				events.push(event);
			} else if (!lifecycle) {
				collectionMemberships.push({ collectionName: descriptor.list });
			}
		} else {
			for (const [localIndex, seen] of details.seenHistory
				.slice(seenOffset, seenOffset + 64)
				.entries()) {
				const occurredAt = parseDateInput(seen.date);
				if (!occurredAt) {
					continue;
				}
				const operationId = yield* Schema.encodeEffect(
					Schema.fromJsonString(Schema.Array(Schema.Unknown)),
				)(["media-event", index, seenOffset + localIndex]);
				if (type === "tv") {
					const episode = details.seasons
						.flatMap((season) => season.episodes)
						.find((candidate) => candidate.id === seen.episodeId);
					if (episode) {
						events.push({
							occurredAt,
							operationId,
							eventSchemaSlug: "progress",
							properties: { progressPercent: 100 },
							unresolvedEpisode: {
								type: "show",
								seasonNumber: episode.seasonNumber,
								episodeNumber: episode.episodeNumber,
							},
						});
					}
				} else {
					events.push({
						...createCompleteEvent({ occurredAt, completedOn: occurredAt }),
						operationId,
					});
				}
			}
			nextSeenOffset = seenOffset + 64 < details.seenHistory.length ? seenOffset + 64 : 0;
			const review = createReviewEvent({
				text: details.userRating?.review ?? null,
				occurredAt:
					parseDateInput(details.userRating?.date) ?? fallbackDate(details, input.importedAt),
				rating:
					details.userRating?.rating === undefined || details.userRating.rating === null
						? null
						: Math.round(Math.min(details.userRating.rating * 20, 100) * 100) / 100,
			});
			if (review && !nextSeenOffset) {
				events.push({
					...review,
					operationId: yield* Schema.encodeEffect(
						Schema.fromJsonString(Schema.Array(Schema.Unknown)),
					)(["media-event", index, details.seenHistory.length]),
				});
			}
		}
		const result =
			ref && ref !== "goodreads"
				? {
						failures: [],
						entityGroups: [{ events, itemIndex: 0, entityRef: ref, collectionMemberships }],
					}
				: {
						entityGroups: [],
						failures: [
							{
								sourceLabel,
								itemIndex: 0,
								sourceIdentifier: String(descriptor.item.id),
								message:
									ref === "goodreads"
										? "MediaTracker book uses an unsupported Goodreads identifier"
										: "MediaTracker item is missing a supported provider identifier",
							},
						],
					};
		if (!ref || ref === "goodreads") {
			nextSeenOffset = 0;
		}
		return yield* sourceOutput({
			...(yield* writeMediaCapture([
				{
					name: "records.jsonl",
					contents: serializeMediaRecords(
						normalizeMediaRecords(result, index, "media_tracker", seenOffset),
					),
				},
				{
					name: "details.json",
					contents: yield* Schema.encodeEffect(Schema.fromJsonString(DetailState))({
						details,
						message: null,
						recordIndex: index,
						id: descriptor.item.id,
						seenOffset: nextSeenOffset,
					}),
				},
			])),
			carryFile: "details.json",
			offset: nextSeenOffset ? input.offset : next.next,
			itemIndex: input.itemIndex + (nextSeenOffset ? 0 : 1),
		});
	}
	const state = yield* loadMediaApiState(input, [
		{ page: 0, name: "", context: {}, path: "user", kind: "user" },
	]);
	const tasks: MediaApiTask[] = [...state.tasks];
	const task = tasks.shift();
	if (!task) {
		return yield* writeMediaApiState(state, [], input.itemIndex);
	}
	const records: MediaSourceRecord[] = [];
	let itemIndex = input.itemIndex;
	if (task.kind === "user") {
		const user = yield* fetch("user").pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.Int }))),
		);
		tasks.push(
			{ page: 0, name: "", path: "lists", kind: "lists", context: { userId: user.id } },
			{ page: 0, name: "", context: {}, path: "items", kind: "items" },
		);
	} else if (task.kind === "lists") {
		const lists = yield* fetch("lists", { userId: Number(task.context["userId"]) }).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(List))),
		);
		for (const list of lists) {
			tasks.push({
				page: 0,
				kind: "list",
				name: list.name,
				path: "list/items",
				context: { listId: list.id },
			});
		}
	} else {
		const rows =
			task.kind === "list"
				? (yield* fetch("list/items", { listId: Number(task.context["listId"]) }).pipe(
						Effect.flatMap(
							Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ mediaItem: Item }))),
						),
					)).map((row) => row.mediaItem)
				: yield* fetch("items").pipe(
						Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Item))),
					);
		for (const item of rows) {
			records.push({
				eventIndex: 0,
				itemIndex: itemIndex++,
				key: String(item.id).padStart(16, "0"),
				raw: { item, ...(task.kind === "list" ? { list: task.name } : {}) },
			});
		}
	}
	records.sort(compareMediaRecords);
	return yield* writeMediaApiState({ ...state, tasks }, records, itemIndex);
});
