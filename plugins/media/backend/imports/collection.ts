import { DateTime, Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import type { zipEntrySchema } from "@ryot-app/sandbox-sdk/fflate";
import { listZipEntries, readGzipRange, readZipEntryRange } from "@ryot-app/sandbox-sdk/fflate";
import { readArtifactRange, writeScratchChunks } from "@ryot-app/sandbox-sdk/filesystem";

import {
	MediaNormalizedSourceRecord,
	MediaRawSourceRecord,
	MediaSourceRecord,
	type MediaSourceInput,
	type MediaSourceOutput,
} from "./collection-schemas";
import { importEntityRefIdentifier } from "./groups";
import {
	mediaAssociationOperationId,
	mediaEventOperationId,
	mediaMembershipOperationId,
	mediaSourceFailureOperationId,
	mediaSourceRecordId,
} from "./identity";
import type { MediaIntegrationAdapterResult } from "./schemas";

export const WINDOW_BYTES = 256 * 1024;
const RECORD_BYTES = 3 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const recordJson = Schema.fromJsonString(MediaSourceRecord);
const encodeRecord = Schema.encodeSync(recordJson);
export const sourceOutput = Effect.fn(function* (fields: Partial<typeof MediaSourceOutput.Type>) {
	return {
		offset: 0,
		header: "",
		done: false,
		itemIndex: 0,
		fileIndex: 0,
		leftOffset: 0,
		eventOffset: 0,
		rightOffset: 0,
		chunkFiles: [],
		carryFile: null,
		leftDone: false,
		rightDone: false,
		advancedAt: DateTime.formatIso(yield* DateTime.now),
		...fields,
	};
});
export const writeMediaCapture = Effect.fn(function* (
	chunks: ReadonlyArray<{ name: string; contents: string | Uint8Array }>,
) {
	let total = 0;
	for (const chunk of chunks) {
		const size =
			typeof chunk.contents === "string"
				? encoder.encode(chunk.contents).length
				: chunk.contents.length;
		if (size > 4 * 1024 * 1024) {
			throw new Error("Media capture exceeds 4 MiB");
		}
		total += size;
	}
	if (total > 5 * 1024 * 1024) {
		throw new Error("Media activity scratch exceeds 5 MiB");
	}
	return yield* writeScratchChunks(chunks);
});
const compareText = (left: string, right: string) => {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
};
export const compareMediaRecords = (left: MediaSourceRecord, right: MediaSourceRecord) => {
	const leftMembership = left.group && !left.group.events.length ? (left.dedupKey ?? "") : "";
	const rightMembership = right.group && !right.group.events.length ? (right.dedupKey ?? "") : "";
	return (
		compareText(left.key, right.key) ||
		(left.group?.events[0] ? Date.parse(left.group.events[0].occurredAt) : -8640000000000000) -
			(right.group?.events[0] ? Date.parse(right.group.events[0].occurredAt) : -8640000000000000) ||
		compareText(leftMembership, rightMembership) ||
		left.itemIndex - right.itemIndex ||
		left.eventIndex - right.eventIndex
	);
};
export const serializeMediaRecords = (records: ReadonlyArray<MediaSourceRecord>) =>
	records.map((record) => encodeRecord(record)).join("\n") + (records.length ? "\n" : "");

export const normalizeMediaRecords = (
	result: MediaIntegrationAdapterResult,
	itemIndex: number,
	source: string,
	eventIndexBase = 0,
): MediaSourceRecord[] => {
	const records: MediaSourceRecord[] = [];
	for (const group of result.entityGroups) {
		const ref = group.entityRef;
		const key =
			source === "netflix" && ref.kind === "unresolved" && ref.identifierType === "netflix-title"
				? JSON.stringify(["netflix-title", ref.identifierValue])
				: JSON.stringify([
						ref.entitySchemaSlug,
						ref.kind === "resolved" ? ref.providerSlug : ref.identifierType,
						importEntityRefIdentifier(ref),
					]);
		const originalIndex = itemIndex + group.itemIndex;
		for (const [eventIndex, membership] of group.collectionMemberships.entries()) {
			records.push({
				key,
				eventIndex,
				itemIndex: originalIndex,
				dedupKey: JSON.stringify(["membership", key, membership.collectionName]),
				operationId: mediaMembershipOperationId(originalIndex, membership.collectionName),
				group: {
					...group,
					events: [],
					itemIndex: originalIndex,
					collectionMemberships: [membership],
				},
			});
		}
		if (!group.events.length && !group.collectionMemberships.length) {
			records.push({
				key,
				eventIndex: 0,
				itemIndex: originalIndex,
				operationId: mediaAssociationOperationId(originalIndex),
				group: { ...group, events: [], itemIndex: originalIndex },
				dedupKey: JSON.stringify(["association", key, group.ownershipProvider ?? null]),
			});
		}
		for (const [localEventIndex, event] of group.events.entries()) {
			const eventIndex = eventIndexBase + localEventIndex;
			const attribution = event.attribution ?? {
				sourceLabel: ref.sourceLabel,
				recordId: mediaSourceRecordId(originalIndex),
				sourceIdentifier: source === "netflix" ? ref.sourceLabel : importEntityRefIdentifier(ref),
			};
			const operationId = event.operationId ?? mediaEventOperationId(originalIndex, eventIndex);
			records.push({
				key,
				eventIndex,
				operationId,
				itemIndex: originalIndex,
				...(source === "spotify"
					? { dedupKey: JSON.stringify([importEntityRefIdentifier(ref), event.occurredAt]) }
					: {}),
				group: {
					...group,
					itemIndex: originalIndex,
					collectionMemberships: [],
					events: [{ ...event, attribution, operationId, sourceItemIndex: originalIndex }],
				},
			});
		}
	}
	const failureOrdinals = new Map<number, number>();
	for (const failure of result.failures) {
		const originalIndex = itemIndex + failure.itemIndex;
		const ordinal = failureOrdinals.get(originalIndex) ?? 0;
		failureOrdinals.set(originalIndex, ordinal + 1);
		const operationId = mediaSourceFailureOperationId(originalIndex, eventIndexBase, ordinal);
		records.push({
			operationId,
			eventIndex: 0,
			itemIndex: originalIndex,
			key: `~failure:${String(originalIndex).padStart(16, "0")}`,
			failure: { ...failure, operationId, itemIndex: originalIndex },
		});
	}
	return records.sort(compareMediaRecords);
};

export const csvRecordEnds = (bytes: Uint8Array, eof: boolean) => {
	const ends: number[] = [];
	let quoted = false;
	for (let index = 0; index < bytes.length; index++) {
		if (bytes[index] === 34) {
			quoted = !quoted;
		}
		if (!quoted && (bytes[index] === 10 || bytes[index] === 13)) {
			if (bytes[index] === 13 && bytes[index + 1] === 10) {
				index++;
			} else if (bytes[index] === 13 && index + 1 === bytes.length && !eof) {
				break;
			}
			ends.push(index + 1);
		}
	}
	if (eof) {
		if (quoted) {
			throw new Error("CSV ends inside a quoted field");
		}
		if (ends.at(-1) !== bytes.length) {
			ends.push(bytes.length);
		}
	}
	return ends;
};

const joinBytes = (left: Uint8Array, right: Uint8Array) => {
	const joined = new Uint8Array(left.length + right.length);
	joined.set(left);
	joined.set(right, left.length);
	return joined;
};
export const readMediaCapture = Effect.fn(function* (key: string) {
	let bytes = new Uint8Array();
	for (let offset = 0; ;) {
		const range = yield* readArtifactRange(offset, WINDOW_BYTES, key);
		if (range.size > 4 * 1024 * 1024) {
			throw new Error("Media capture exceeds 4 MiB");
		}
		bytes = joinBytes(bytes, range.bytes);
		offset += range.bytes.length;
		if (offset === range.size) {
			return bytes;
		}
		if (!range.bytes.length) {
			throw new Error("Media capture is truncated");
		}
	}
});

export const collectMediaCsv = Effect.fn(function* (
	source: string,
	input: MediaSourceInput,
	adapt: (
		text: string,
		eventOffset: number,
	) => MediaIntegrationAdapterResult & { nextEventOffset?: number },
	key = "uploadToken",
	mapRecord?: (text: string, itemIndex: number) => MediaSourceRecord[],
) {
	let bytes: Uint8Array = input.ingestionArtifacts?.captures["carry"]
		? yield* readMediaCapture("carry")
		: new Uint8Array();
	let offset = input.offset;
	let eof = false;
	let ends = csvRecordEnds(bytes, false);
	while (!ends.length && !eof) {
		const range = input.entry
			? yield* readZipEntryRange({ key, offset, entry: input.entry, length: WINDOW_BYTES })
			: yield* readArtifactRange(offset, WINDOW_BYTES, key);
		offset += range.bytes.length;
		eof = "next" in range ? range.next === null : offset === range.size;
		bytes = joinBytes(bytes, range.bytes);
		if (bytes.length > RECORD_BYTES) {
			throw new Error("Media source record exceeds 3 MiB");
		}
		ends = csvRecordEnds(bytes, eof);
	}
	let header = input.header;
	let consumed = 0;
	if (!header) {
		const end = ends.shift();
		if (end === undefined) {
			throw new Error("CSV is empty or has no header row");
		}
		header = decoder.decode(bytes.subarray(0, end)).trim();
		if (encoder.encode(header).length > 8192) {
			throw new Error("Media CSV header exceeds 8 KiB");
		}
		consumed = end;
	}
	const records: MediaSourceRecord[] = [];
	let itemIndex = input.itemIndex;
	let eventOffset = input.eventOffset ?? 0;
	let length = 0;
	for (const end of ends) {
		const text = decoder.decode(bytes.subarray(consumed, end));
		if (!text.trim()) {
			consumed = end;
			continue;
		}
		const value = adapt(`${header}\n${text}`, eventOffset);
		const adapted = mapRecord
			? mapRecord(`${header}\n${text}`, itemIndex)
			: normalizeMediaRecords(value, itemIndex, source, eventOffset);
		const size = encoder.encode(serializeMediaRecords(adapted)).length;
		if (size > RECORD_BYTES) {
			throw new Error("Normalized media record exceeds 3 MiB");
		}
		if (records.length && length + size > WINDOW_BYTES) {
			break;
		}
		records.push(...adapted);
		length += size;
		eventOffset = value.failures.length ? 0 : (value.nextEventOffset ?? 0);
		if (eventOffset) {
			break;
		}
		itemIndex++;
		consumed = end;
		if (length >= WINDOW_BYTES) {
			break;
		}
	}
	const tail = bytes.slice(consumed);
	const chunks: Array<{ name: string; contents: string | Uint8Array }> = [
		{ name: "records.jsonl", contents: serializeMediaRecords(records.sort(compareMediaRecords)) },
	];
	if (tail.length) {
		chunks.push({ contents: tail, name: "carry.bin" });
	}
	return yield* sourceOutput({
		...(yield* writeMediaCapture(chunks)),
		offset,
		header,
		itemIndex,
		eventOffset,
		done: eof && !tail.length,
		fileIndex: input.fileIndex,
		carryFile: tail.length ? "carry.bin" : null,
	});
});

const makeMediaRecordReader = <S extends Schema.Decoder<unknown>>(record: S) => {
	const decodeRecord = Schema.decodeEffect(Schema.fromJsonString(record));
	const windows = new Map<string, { offset: number; size: number; bytes: Uint8Array }>();
	return Effect.fn(function* (key: string, offset: number) {
		let bytes = new Uint8Array();
		for (;;) {
			const position = offset + bytes.length;
			let window = windows.get(key);
			if (!window || position < window.offset || position >= window.offset + window.bytes.length) {
				window = { ...(yield* readArtifactRange(position, WINDOW_BYTES, key)), offset: position };
				windows.set(key, window);
			}
			const range = window.bytes.subarray(position - window.offset);
			const newline = range.indexOf(10);
			bytes = joinBytes(bytes, newline < 0 ? range : range.subarray(0, newline));
			if (!bytes.length && position === window.size) {
				return null;
			}
			if (bytes.length > RECORD_BYTES) {
				throw new Error("Media capture record exceeds 3 MiB");
			}
			if (newline >= 0 || offset + bytes.length === window.size) {
				return {
					record: yield* decodeRecord(decoder.decode(bytes)),
					next: offset + bytes.length + (newline >= 0 ? 1 : 0),
				};
			}
		}
	});
};

export const mediaRecordReader = () => makeMediaRecordReader(MediaSourceRecord);
export const mediaRawRecordReader = () => makeMediaRecordReader(MediaRawSourceRecord);
export const mediaNormalizedRecordReader = () => makeMediaRecordReader(MediaNormalizedSourceRecord);

export const mergeMediaRecords = Effect.fn(function* (input: MediaSourceInput) {
	const read = mediaRecordReader();
	let leftOffset = input.leftOffset ?? 0;
	let rightOffset = input.rightOffset ?? 0;
	let left = yield* read("left", leftOffset);
	let right = yield* read("right", rightOffset);
	const records: MediaSourceRecord[] = [];
	let length = 0;
	while (left || right) {
		if ((!left && !input.leftFinal) || (!right && !input.rightFinal)) {
			break;
		}
		const useLeft = left && (!right || compareMediaRecords(left.record, right.record) <= 0);
		const selected = useLeft ? left : right;
		if (!selected) {
			break;
		}
		const size = encoder.encode(encodeRecord(selected.record)).length + 1;
		if (records.length && length + size > WINDOW_BYTES) {
			break;
		}
		records.push(selected.record);
		length += size;
		if (useLeft) {
			leftOffset = selected.next;
			left = yield* read("left", leftOffset);
		} else {
			rightOffset = selected.next;
			right = yield* read("right", rightOffset);
		}
	}
	return yield* sourceOutput({
		...(yield* writeMediaCapture([
			{ name: "records.jsonl", contents: serializeMediaRecords(records) },
		])),
		leftOffset,
		rightOffset,
		leftDone: left === null,
		rightDone: right === null,
	});
});

export const mediaArchiveDirectory = Effect.fn(function* (key: string, after?: number) {
	return yield* listZipEntries({ key, limit: 25, ...(after === undefined ? {} : { after }) });
});

export const readMediaSourceRange = Effect.fn(function* (input: {
	key: string;
	offset: number;
	entry?: typeof zipEntrySchema.Type;
	gzip?: boolean;
}) {
	if (input.entry) {
		return yield* readZipEntryRange({ ...input, entry: input.entry, length: WINDOW_BYTES });
	}
	if (input.gzip) {
		return yield* readGzipRange({ ...input, length: WINDOW_BYTES });
	}
	const range = yield* readArtifactRange(input.offset, WINDOW_BYTES, input.key);
	return {
		bytes: range.bytes,
		next: input.offset + range.bytes.length < range.size ? input.offset + range.bytes.length : null,
	};
});

const whitespace = (byte: number | undefined) =>
	byte === 32 || byte === 10 || byte === 13 || byte === 9;

export const jsonArrayFrames = (
	bytes: Uint8Array,
	eof: boolean,
	opened: boolean,
	allowTrailing = false,
	expectSeparator = opened,
	maxFrames = Number.POSITIVE_INFINITY,
) => {
	let cursor = 0;
	let isOpened = opened;
	let separatorRequired = expectSeparator;
	const frames: Array<{ start: number; end: number }> = [];
	while (whitespace(bytes[cursor])) {
		cursor++;
	}
	if (!isOpened) {
		if (bytes[cursor] !== 91) {
			throw new Error("Source JSON must be an array");
		}
		cursor++;
		isOpened = true;
	}
	let consumed = cursor;
	while (cursor < bytes.length) {
		while (whitespace(bytes[cursor])) {
			cursor++;
		}
		if (cursor === bytes.length) {
			break;
		}
		if (separatorRequired && bytes[cursor] !== 93) {
			if (bytes[cursor] !== 44) {
				throw new Error("JSON array records must be separated by a comma");
			}
			cursor++;
			while (whitespace(bytes[cursor])) {
				cursor++;
			}
			if (bytes[cursor] === 93) {
				throw new Error("JSON arrays cannot end with a comma");
			}
			if (cursor === bytes.length) {
				break;
			}
		}
		if (bytes[cursor] === 93) {
			cursor++;
			while (whitespace(bytes[cursor])) {
				cursor++;
			}
			if (cursor < bytes.length && !allowTrailing) {
				throw new Error("Unexpected data after source JSON array");
			}
			return { frames, closed: true, opened: isOpened, consumed: cursor };
		}
		const start = cursor;
		let depth = 0;
		let quoted = false;
		let escaped = false;
		let complete = false;
		for (; cursor < bytes.length; cursor++) {
			const byte = bytes[cursor];
			if (quoted) {
				if (escaped) {
					escaped = false;
				} else if (byte === 92) {
					escaped = true;
				} else if (byte === 34) {
					quoted = false;
					if (depth === 0) {
						cursor++;
						complete = true;
						break;
					}
				}
				continue;
			}
			if (byte === 34) {
				quoted = true;
			} else if (byte === 123 || byte === 91) {
				depth++;
			} else if (byte === 125 || byte === 93) {
				if (depth === 0) {
					complete = cursor > start;
					break;
				}
				depth--;
				if (depth === 0) {
					cursor++;
					complete = true;
					break;
				}
			} else if (depth === 0 && (byte === 44 || whitespace(byte))) {
				complete = cursor > start;
				break;
			}
		}
		if (!complete) {
			if (eof && cursor > start) {
				throw new Error("Source JSON ends inside a record");
			}
			break;
		}
		frames.push({ start, end: cursor });
		consumed = cursor;
		separatorRequired = true;
		if (frames.length >= maxFrames) {
			return { frames, consumed, closed: false, opened: isOpened };
		}
	}
	if (eof) {
		throw new Error("Source JSON array is not closed");
	}
	return { frames, consumed, closed: false, opened: isOpened };
};

export const collectMediaJson = Effect.fn(function* (
	source: string,
	input: MediaSourceInput,
	adapt: (
		rows: unknown[],
		eventOffset: number,
	) => MediaIntegrationAdapterResult & { nextEventOffset?: number },
	key = "uploadToken",
	mapRecord?: (row: unknown, itemIndex: number) => MediaSourceRecord[],
) {
	if (input.header === "closed") {
		const range = yield* readMediaSourceRange({
			key,
			offset: input.offset,
			...(input.entry ? { entry: input.entry } : {}),
		});
		if (range.bytes.some((byte) => ![9, 10, 13, 32].includes(byte))) {
			throw new Error("Unexpected data after source JSON array");
		}
		return yield* sourceOutput({
			...(yield* writeMediaCapture([{ contents: "", name: "records.jsonl" }])),
			header: "closed",
			done: range.next === null,
			itemIndex: input.itemIndex,
			fileIndex: input.fileIndex,
			offset: input.offset + range.bytes.length,
		});
	}
	let bytes: Uint8Array = input.ingestionArtifacts?.captures["carry"]
		? yield* readMediaCapture("carry")
		: new Uint8Array();
	let offset = input.offset;
	let eof = false;
	let framed = jsonArrayFrames(
		bytes.length ? bytes : encoder.encode(input.header ? " " : "["),
		false,
		!!input.header,
		false,
		!!input.header && !(input.eventOffset ?? 0),
	);
	for (;;) {
		if (bytes.length) {
			framed = jsonArrayFrames(
				bytes,
				eof,
				!!input.header,
				false,
				!!input.header && !(input.eventOffset ?? 0),
			);
		}
		if (framed.frames.length || framed.closed) {
			break;
		}
		const range = yield* readMediaSourceRange({
			key,
			offset,
			...(input.entry ? { entry: input.entry } : {}),
		});
		offset += range.bytes.length;
		eof = range.next === null;
		bytes = joinBytes(bytes, range.bytes);
		if (bytes.length > RECORD_BYTES) {
			throw new Error("Media JSON record exceeds 3 MiB");
		}
	}
	const records: MediaSourceRecord[] = [];
	let consumed = framed.frames[0]?.start ?? framed.consumed;
	let itemIndex = input.itemIndex;
	let length = 0;
	let eventOffset = input.eventOffset ?? 0;
	for (const frame of framed.frames) {
		const row = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
			decoder.decode(bytes.subarray(frame.start, frame.end)),
		);
		const value = adapt([row], eventOffset);
		const normalized = mapRecord
			? mapRecord(row, itemIndex)
			: normalizeMediaRecords(value, itemIndex, source, eventOffset);
		const size = encoder.encode(serializeMediaRecords(normalized)).length;
		if (size > RECORD_BYTES) {
			throw new Error("Normalized media JSON record exceeds 3 MiB");
		}
		if (records.length && length + size > WINDOW_BYTES) {
			break;
		}
		records.push(...normalized);
		length += size;
		eventOffset = value.failures.length ? 0 : (value.nextEventOffset ?? 0);
		if (eventOffset) {
			consumed = frame.start;
			break;
		}
		itemIndex++;
		consumed = frame.end;
		if (length >= WINDOW_BYTES) {
			break;
		}
	}
	const allConsumed = itemIndex - input.itemIndex === framed.frames.length && !eventOffset;
	if (allConsumed) {
		consumed = framed.consumed;
	}
	const tail = bytes.slice(consumed);
	const chunks: Array<{ name: string; contents: string | Uint8Array }> = [
		{ name: "records.jsonl", contents: serializeMediaRecords(records.sort(compareMediaRecords)) },
	];
	if (tail.length) {
		chunks.push({ contents: tail, name: "carry.bin" });
	}
	return yield* sourceOutput({
		...(yield* writeMediaCapture(chunks)),
		offset,
		itemIndex,
		eventOffset,
		fileIndex: input.fileIndex,
		done: eof && framed.closed && allConsumed,
		carryFile: tail.length ? "carry.bin" : null,
		header: framed.closed && allConsumed ? "closed" : "opened",
	});
});

export const xmlRecordFrames = (bytes: Uint8Array, tag: string, eof: boolean) => {
	const text = new TextDecoder("latin1").decode(bytes);
	const frames: Array<{ start: number; end: number }> = [];
	const stack: string[] = [];
	let start: number | null = null;
	let closed = false;
	for (let cursor = 0; cursor < text.length;) {
		const open = text.indexOf("<", cursor);
		if (open < 0) {
			break;
		}
		const opaque = [
			{ suffix: "]]>", prefix: "<![CDATA[" },
			{ suffix: "-->", prefix: "<!--" },
			{ prefix: "<?", suffix: "?>" },
		].find((block) => text.startsWith(block.prefix, open));
		if (opaque) {
			const end = text.indexOf(opaque.suffix, open + opaque.prefix.length);
			if (end < 0) {
				if (eof) {
					throw new Error("XML ends inside an opaque block");
				}
				break;
			}
			cursor = end + opaque.suffix.length;
			continue;
		}
		let end = open + 1;
		let quote = "";
		for (; end < text.length; end++) {
			const character = text[end];
			if (quote) {
				if (character === quote) {
					quote = "";
				}
			} else if (character === '"' || character === "'") {
				quote = character;
			} else if (character === ">") {
				break;
			}
		}
		if (end === text.length) {
			if (eof) {
				throw new Error("XML ends inside a tag");
			}
			break;
		}
		const token = text
			.slice(open, end + 1)
			.match(/^<\s*(\/?)\s*([\w:.-]+)(?:\s[^<>]*?)?(\/?)\s*>$/);
		if (!token?.[2]) {
			throw new Error("Invalid XML tag");
		}
		const name = token[2];
		const closing = !!token[1];
		const selfClosing = !!token[3];
		if (start === null && !closing && name === tag) {
			if (closed) {
				throw new Error("XML item follows its root close");
			}
			start = open;
		}
		if (start !== null) {
			if (closing) {
				if (stack.pop() !== name) {
					throw new Error(`Unexpected closing XML tag ${name}`);
				}
			} else if (!selfClosing) {
				stack.push(name);
			}
			if (!stack.length) {
				frames.push({ start, end: end + 1 });
				start = null;
			}
		} else if (closing && name === "myanimelist") {
			closed = true;
		}
		cursor = end + 1;
	}
	if (eof && start !== null) {
		throw new Error("XML ends inside an item");
	}
	return { frames, closed };
};

export const collectMediaXml = Effect.fn(function* (
	input: MediaSourceInput,
	adapt: (
		xml: string,
		coverageStart: number,
	) => { result: MediaIntegrationAdapterResult; coverageTotal: number },
) {
	const key = input.fileIndex === 0 ? "animeUploadToken" : "mangaUploadToken";
	const tag = input.fileIndex === 0 ? "anime" : "manga";
	const signature = yield* readArtifactRange(0, 2, key);
	const gzip = signature.bytes[0] === 31 && signature.bytes[1] === 139;
	let bytes: Uint8Array = input.ingestionArtifacts?.captures["carry"]
		? yield* readMediaCapture("carry")
		: new Uint8Array();
	let offset = input.offset;
	let eof = false;
	let framed = xmlRecordFrames(bytes, tag, eof);
	for (;;) {
		framed = xmlRecordFrames(bytes, tag, eof);
		if (framed.frames.length || framed.closed || eof) {
			break;
		}
		const range = yield* readMediaSourceRange({ key, gzip, offset });
		offset += range.bytes.length;
		eof = range.next === null;
		bytes = joinBytes(bytes, range.bytes);
		if (bytes.length > RECORD_BYTES) {
			throw new Error("MyAnimeList XML record exceeds 3 MiB");
		}
	}
	const records: MediaSourceRecord[] = [];
	let itemIndex = input.itemIndex;
	let consumed = 0;
	let length = 0;
	let coverageStart = Number(input.header || 0);
	if (!Number.isSafeInteger(coverageStart) || coverageStart < 0) {
		throw new Error("Invalid MyAnimeList coverage cursor");
	}
	for (const frame of framed.frames) {
		const adapted = adapt(
			`<myanimelist>${decoder.decode(bytes.subarray(frame.start, frame.end))}</myanimelist>`,
			coverageStart,
		);
		const normalized = normalizeMediaRecords(
			adapted.result,
			itemIndex,
			"myanimelist",
			coverageStart,
		);
		const size = encoder.encode(serializeMediaRecords(normalized)).length;
		if (size > RECORD_BYTES) {
			throw new Error("Normalized MyAnimeList record exceeds 3 MiB");
		}
		if (records.length && length + size > WINDOW_BYTES) {
			break;
		}
		records.push(...normalized);
		length += size;
		if (!adapted.result.failures.length && coverageStart + 128 < adapted.coverageTotal) {
			coverageStart += 128;
			consumed = frame.start;
			break;
		}
		coverageStart = 0;
		itemIndex++;
		consumed = frame.end;
		if (length >= WINDOW_BYTES) {
			break;
		}
	}
	let tail = bytes.slice(consumed);
	const allConsumed = itemIndex - input.itemIndex === framed.frames.length && !coverageStart;
	if (allConsumed && (eof || framed.closed)) {
		if (!framed.closed) {
			throw new Error("MyAnimeList XML document is not closed");
		}
		tail = new Uint8Array();
	}
	const chunks: Array<{ name: string; contents: string | Uint8Array }> = [
		{ name: "records.jsonl", contents: serializeMediaRecords(records.sort(compareMediaRecords)) },
	];
	if (tail.length) {
		chunks.push({ contents: tail, name: "carry.bin" });
	}
	return yield* sourceOutput({
		...(yield* writeMediaCapture(chunks)),
		offset,
		itemIndex,
		fileIndex: input.fileIndex,
		header: String(coverageStart),
		done: framed.closed && !tail.length,
		carryFile: tail.length ? "carry.bin" : null,
	});
});
