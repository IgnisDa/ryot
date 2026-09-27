import { Effect, Result, Schema } from "@ryot-app/sandbox-sdk/effect";

import { adaptAnilistExport, AnilistList } from "./anilist";
import {
	compareMediaRecords,
	jsonArrayFrames,
	mediaRawRecordReader,
	normalizeMediaRecords,
	readMediaCapture,
	readMediaSourceRange,
	serializeMediaRecords,
	sourceOutput,
	WINDOW_BYTES,
	writeMediaCapture,
} from "./collection";
import type { MediaSourceInput, MediaSourceRecord } from "./collection-schemas";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const NormalizationState = Schema.Struct({
	coverageStart: Schema.Int,
	user: Schema.optional(Schema.Unknown),
});
export const collectAnilist = Effect.fn(function* (input: MediaSourceInput) {
	let bytes: Uint8Array = input.ingestionArtifacts?.captures["carry"]
		? yield* readMediaCapture("carry")
		: new Uint8Array();
	let offset = input.offset;
	let itemIndex = input.itemIndex;
	let section = input.header;
	let eof = false;
	let done = false;
	let arraySeparator = section.endsWith("|separator");
	section = section.split("|")[0] ?? "";
	const records: MediaSourceRecord[] = [];
	const readMore = Effect.fn(function* () {
		const range = yield* readMediaSourceRange({ offset, key: "uploadToken" });
		offset += range.bytes.length;
		const atEndOfFile = range.next === null;
		const joined = new Uint8Array(bytes.length + range.bytes.length);
		joined.set(bytes);
		joined.set(range.bytes, bytes.length);
		bytes = joined;
		if (bytes.length > 3 * 1024 * 1024) {
			throw new Error("AniList JSON record exceeds 3 MiB");
		}
		return atEndOfFile;
	});
	while (encoder.encode(serializeMediaRecords(records)).length < WINDOW_BYTES) {
		if (!bytes.length) {
			if (eof) {
				throw new Error("AniList JSON document is not closed");
			}
			eof = yield* readMore();
		}
		if (section) {
			const framed = jsonArrayFrames(bytes, eof, true, true, arraySeparator);
			if (!framed.frames.length && !framed.closed) {
				eof = yield* readMore();
				continue;
			}
			const first = framed.frames[0];
			if (first) {
				const raw = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
					decoder.decode(bytes.subarray(first.start, first.end)),
				);
				records.push({
					raw,
					section,
					itemIndex,
					eventIndex: 0,
					key: String(itemIndex).padStart(16, "0"),
				});
				itemIndex++;
				bytes = bytes.slice(first.end);
				arraySeparator = true;
			} else {
				bytes = bytes.slice(framed.consumed);
				section = "";
				arraySeparator = false;
			}
			continue;
		}
		const ascii = new TextDecoder().decode(bytes);
		const prefix = ascii.match(/^[\s,{]*(?:"([^"\\]+)"\s*:\s*|\})/);
		if (!prefix) {
			if (eof) {
				throw new Error("Invalid AniList JSON object");
			}
			eof = yield* readMore();
			continue;
		}
		if (!prefix[1]) {
			bytes = bytes.slice(encoder.encode(prefix[0]).length);
			done = true;
			break;
		}
		const name = prefix[1];
		const prefixBytes = encoder.encode(prefix[0]).length;
		if (["lists", "reviews", "favourites"].includes(name)) {
			if (bytes[prefixBytes] !== 91) {
				throw new Error(`AniList ${name} must be an array`);
			}
			bytes = bytes.slice(prefixBytes + 1);
			section = name;
			arraySeparator = false;
			continue;
		}
		const wrapped = new Uint8Array(bytes.length - prefixBytes + 1);
		wrapped[0] = 91;
		wrapped.set(bytes.subarray(prefixBytes), 1);
		const framed = jsonArrayFrames(wrapped, false, false, true, false, 1);
		const first = framed.frames[0];
		if (!first) {
			if (eof) {
				throw new Error("Incomplete AniList metadata");
			}
			eof = yield* readMore();
			continue;
		}
		const raw = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
			decoder.decode(wrapped.subarray(first.start, first.end)),
		);
		if (name === "user") {
			records.push({ raw, itemIndex: 0, eventIndex: 0, section: "user", key: "!metadata" });
		}
		bytes = bytes.slice(prefixBytes + first.end - 1);
	}
	if (done && decoder.decode(bytes).trim()) {
		throw new Error("Unexpected data after AniList JSON");
	}
	const chunks: Array<{ name: string; contents: string | Uint8Array }> = [
		{ name: "records.jsonl", contents: serializeMediaRecords(records.sort(compareMediaRecords)) },
	];
	if (bytes.length) {
		chunks.push({ contents: bytes, name: "carry.bin" });
	}
	return yield* sourceOutput({
		...(yield* writeMediaCapture(chunks)),
		done,
		offset,
		itemIndex,
		carryFile: bytes.length ? "carry.bin" : null,
		header: section && arraySeparator ? `${section}|separator` : section,
	});
});

export const normalizeAnilist = Effect.fn(function* (input: MediaSourceInput) {
	const read = mediaRawRecordReader();
	let offset = input.offset;
	let header = input.header;
	let done = false;
	let itemIndex = input.itemIndex;
	let state = header
		? yield* Schema.decodeEffect(Schema.fromJsonString(NormalizationState))(header)
		: { coverageStart: 0 };
	const records: MediaSourceRecord[] = [];
	for (let count = 0; count < 20; count++) {
		const next = yield* read("records", offset);
		if (!next) {
			done = true;
			break;
		}
		const record = next.record;
		if (record.section === "user") {
			state = { user: record.raw, coverageStart: 0 };
			offset = next.next;
			itemIndex++;
			continue;
		}
		if (!record.section) {
			throw new Error("AniList captured record is missing its section");
		}
		const data = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
			user: state.user,
			[record.section]: [record.raw],
		});
		const result = adaptAnilistExport(
			data,
			String(input.settings["timezone"]),
			input.importedAt,
			state.coverageStart,
			128,
		);
		records.push(
			...normalizeMediaRecords(result, record.itemIndex, "anilist", state.coverageStart),
		);
		const parsed =
			record.section === "lists" ? Schema.decodeUnknownResult(AnilistList)(record.raw) : null;
		if (
			parsed &&
			Result.isSuccess(parsed) &&
			!result.failures.length &&
			state.coverageStart + 128 < parsed.success.progress
		) {
			state = { ...state, coverageStart: state.coverageStart + 128 };
			break;
		}
		state = { ...state, coverageStart: 0 };
		offset = next.next;
		itemIndex++;
		if (encoder.encode(serializeMediaRecords(records)).length >= WINDOW_BYTES) {
			break;
		}
	}
	header = yield* Schema.encodeEffect(Schema.fromJsonString(NormalizationState))(state);
	if (encoder.encode(header).length > 8192) {
		throw new Error("AniList custom list metadata exceeds 8 KiB");
	}
	return yield* sourceOutput({
		...(yield* writeMediaCapture([
			{ name: "records.jsonl", contents: serializeMediaRecords(records.sort(compareMediaRecords)) },
		])),
		done,
		offset,
		header,
		itemIndex,
	});
});
