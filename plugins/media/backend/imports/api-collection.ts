import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { jsonValueSchema } from "@ryot-app/plugin-backend-sdk/wire";

import { mediaFailureMessage } from "../lib/error-message";
import { MediaSandboxError } from "../lib/failures";
import {
	compareMediaRecords,
	normalizeMediaRecords,
	readMediaCapture,
	serializeMediaRecords,
	sourceOutput,
	writeMediaCapture,
} from "./collection";
import type { MediaSourceInput, MediaSourceRecord } from "./collection-schemas";
import { type HttpHost, requestSourceResponse } from "./source-api";
import { normalizeTraktRecord, parseListUrl, TraktApiKind, traktApiRecordContext } from "./trakt";

export const MediaApiTask = Schema.Struct({
	path: Schema.String,
	kind: Schema.String,
	page: Schema.Finite,
	name: Schema.String,
	context: Schema.Record(Schema.String, jsonValueSchema),
});
export type MediaApiTask = typeof MediaApiTask.Type;
export const MediaApiState = Schema.Struct({
	tasks: Schema.Array(MediaApiTask),
	credentials: Schema.Record(Schema.String, Schema.String),
});
export type MediaApiState = typeof MediaApiState.Type;
export const loadMediaApiState = Effect.fn(function* (
	input: MediaSourceInput,
	tasks: MediaApiTask[],
) {
	return input.ingestionArtifacts?.captures["carry"]
		? yield* Schema.decodeEffect(Schema.fromJsonString(MediaApiState))(
				new TextDecoder().decode(yield* readMediaCapture("carry")),
			)
		: { tasks, credentials: {} };
});
export const writeMediaApiState = Effect.fn(function* (
	state: MediaApiState,
	records: MediaSourceRecord[],
	itemIndex: number,
) {
	return yield* sourceOutput({
		...(yield* writeMediaCapture([
			{ name: "records.jsonl", contents: serializeMediaRecords(records.sort(compareMediaRecords)) },
			{
				name: "state.json",
				contents: yield* Schema.encodeEffect(Schema.fromJsonString(MediaApiState))(state),
			},
		])),
		itemIndex,
		carryFile: "state.json",
		done: !state.tasks.length,
	});
});

export const recoverMediaApiTask = Effect.fn(function* (
	input: MediaSourceInput,
	error: unknown,
	source: string,
) {
	if (!input.ingestionArtifacts?.captures["carry"]) {
		return yield* new MediaSandboxError({ message: mediaFailureMessage(error) });
	}
	const state = yield* loadMediaApiState(input, []);
	const [task, ...tasks] = state.tasks;
	if (!task) {
		return yield* new MediaSandboxError({ message: mediaFailureMessage(error) });
	}
	const records = normalizeMediaRecords(
		{
			entityGroups: [],
			failures: [
				{
					itemIndex: 0,
					stage: "source_fetch",
					sourceIdentifier: task.path,
					sourceLabel: task.name || source,
					message: `Failed to fetch ${source} source data`,
				},
			],
		},
		input.itemIndex,
		source,
	);
	return yield* writeMediaApiState({ ...state, tasks }, records, input.itemIndex + 1);
});

export const collectTraktApi = Effect.fn(function* (
	input: MediaSourceInput,
	clientId: string,
	host: HttpHost,
) {
	const mode = input.settings["mode"];
	const listPath =
		mode === "list"
			? yield* Effect.try({
					try: () => parseListUrl(String(input.settings["url"])),
					catch: (error) => new MediaSandboxError({ message: mediaFailureMessage(error) }),
				})
			: null;
	const user = `/users/${encodeURIComponent(String(input.settings["username"]))}`;
	const initial: MediaApiTask[] = listPath
		? [
				{
					page: 1,
					context: {},
					kind: "list",
					path: listPath,
					name: String(input.settings["collection"]),
				},
			]
		: [
				{
					page: 1,
					context: {},
					kind: "history",
					path: `${user}/history`,
					name: "watched-history.json",
				},
				{
					page: 1,
					context: {},
					kind: "rating",
					name: "ratings-movies.json",
					path: `${user}/ratings/movies`,
				},
				{
					page: 1,
					context: {},
					kind: "rating",
					name: "ratings-shows.json",
					path: `${user}/ratings/shows`,
				},
				{
					page: 1,
					context: {},
					kind: "watchlist",
					path: `${user}/watchlist`,
					name: "lists-watchlist.json",
				},
				{ page: 1, name: "", context: {}, kind: "lists", path: `${user}/lists` },
				{
					page: 1,
					context: {},
					kind: "collection",
					name: "collection-movies.json",
					path: `${user}/collection/movies`,
				},
				{
					page: 1,
					context: {},
					kind: "collection",
					name: "collection-shows.json",
					path: `${user}/collection/shows`,
				},
			];
	const state = yield* loadMediaApiState(input, initial);
	const tasks = [...state.tasks];
	const task = tasks.shift();
	if (!task) {
		return yield* writeMediaApiState(state, [], input.itemIndex);
	}
	const kind = yield* Schema.decodeUnknownEffect(TraktApiKind)(task.kind);
	const response = yield* requestSourceResponse(host, {
		path: task.path,
		baseUrl: "https://api.trakt.tv",
		query: { limit: 25, page: task.page },
		headers: {
			"trakt-api-version": "2",
			"trakt-api-key": clientId,
			"Content-Type": "application/json",
		},
	});
	const rows = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Schema.Unknown)))(
		response.body,
	);
	const pages = Number(response.headers["x-pagination-page-count"]);
	if (
		(Number.isFinite(pages) && task.page < pages) ||
		(!Number.isFinite(pages) && rows.length === 25)
	) {
		tasks.unshift({ ...task, page: task.page + 1 });
	}
	const records: MediaSourceRecord[] = [];
	let itemIndex = input.itemIndex;
	for (const raw of rows) {
		if (kind === "lists") {
			const list = yield* Schema.decodeUnknownEffect(
				Schema.Struct({
					name: Schema.String,
					ids: Schema.Struct({ trakt: Schema.optional(Schema.Finite) }),
				}),
			)(raw);
			if (list.ids.trakt !== undefined && list.name.toLowerCase() !== "watchlist") {
				tasks.push({
					page: 1,
					context: {},
					kind: "list",
					name: list.name,
					path: `${user}/lists/${list.ids.trakt}/items`,
				});
			}
			continue;
		}
		if (kind === "list") {
			const target = yield* Schema.decodeUnknownEffect(
				Schema.Struct({
					type: Schema.String,
					show: Schema.optional(Schema.Unknown),
					movie: Schema.optional(Schema.Unknown),
				}),
			)(raw);
			if (
				(target.type !== "movie" && target.type !== "show") ||
				(target.type === "movie" ? target.movie === undefined : target.show === undefined)
			) {
				itemIndex++;
				continue;
			}
		}
		const adapted = normalizeTraktRecord(
			raw,
			traktApiRecordContext(kind, task.name, input.importedAt),
		);
		records.push(...normalizeMediaRecords(adapted, itemIndex++, "trakt"));
	}
	return yield* writeMediaApiState({ ...state, tasks }, records, itemIndex);
});
