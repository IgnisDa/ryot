import { DateTime, Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { readArtifactRange, writeScratchChunks } from "@ryot-app/sandbox-sdk/filesystem";
import {
	genericImportChunkSchema,
	genericImportItemIntents,
	genericImportWriteItemSchema,
	type genericImportFailureSchema,
} from "@ryot-app/sandbox-sdk/imports";

import { parseCsvText, readCsvCell } from "./csv";
import { adaptHevyRows } from "./hevy";
import { fitnessFailureOperationId, measurementOperationId, measurementRecordId } from "./identity";
import { adaptOpenScaleRows } from "./open-scale";
import type { FitnessStageInput, FitnessStageOutput } from "./schemas";
import { FitnessRecord } from "./schemas";
import { adaptStrongAppRows } from "./strong-app";
import { toWorkoutWriteItem } from "./workout";

const PAGE_BYTES = 512 * 1024;
const RECORD_BYTES = 3 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const output = Effect.fn(function* (fields: Partial<typeof FitnessStageOutput.Type>) {
	return {
		offset: 0,
		header: "",
		done: false,
		itemIndex: 0,
		totalSize: 0,
		leftOffset: 0,
		rightOffset: 0,
		chunkFiles: [],
		leftDone: false,
		carryFile: null,
		rightDone: false,
		advancedAt: DateTime.formatIso(yield* DateTime.now),
		...fields,
	};
});

const compare = (left: FitnessRecord, right: FitnessRecord) => {
	if (left.key < right.key) {
		return -1;
	}
	if (left.key > right.key) {
		return 1;
	}
	return left.itemIndex - right.itemIndex;
};
const recordJson = Schema.fromJsonString(FitnessRecord);
const groupJson = Schema.fromJsonString(Schema.Array(FitnessRecord));
const chunkJson = Schema.fromJsonString(genericImportChunkSchema);
const encodeRecord = Schema.encodeSync(recordJson);
const encodeGroup = Schema.encodeSync(groupJson);
const encodeItem = Schema.encodeSync(Schema.fromJsonString(genericImportWriteItemSchema));
const encodeChunk = Schema.encodeSync(chunkJson);
const serialize = (records: ReadonlyArray<FitnessRecord>) =>
	records.map((record) => encodeRecord(record)).join("\n") + (records.length ? "\n" : "");

const writeFitnessCapture = Effect.fn(function* (
	chunks: ReadonlyArray<{ name: string; contents: string | Uint8Array }>,
) {
	let bytes = 0;
	for (const chunk of chunks) {
		const size =
			typeof chunk.contents === "string"
				? encoder.encode(chunk.contents).length
				: chunk.contents.length;
		if (size > 4 * 1024 * 1024) {
			throw new Error("Fitness capture exceeds 4 MiB");
		}
		bytes += size;
	}
	if (bytes > 5 * 1024 * 1024) {
		throw new Error("Fitness activity scratch exceeds 5 MiB");
	}
	return yield* writeScratchChunks(chunks);
});

export const csvRecordEnds = (bytes: Uint8Array, eof: boolean) => {
	const ends: number[] = [];
	let quoted = false;
	for (let index = 0; index < bytes.length; index++) {
		const byte = bytes[index];
		if (byte === 34) {
			quoted = !quoted;
		}
		if (!quoted && (byte === 10 || byte === 13)) {
			if (byte === 13 && bytes[index + 1] === 10) {
				index++;
			} else if (byte === 13 && index + 1 === bytes.length && !eof) {
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

const readCsvPage = Effect.fn(function* (
	offset: number,
	buffered: Uint8Array,
	sourceSize: number | null,
) {
	let bytes = buffered;
	let next = offset;
	let size = sourceSize;
	for (;;) {
		const eof = size !== null && next === size;
		const ends = csvRecordEnds(bytes, eof);
		let end = ends[0];
		for (const boundary of ends) {
			if (boundary > PAGE_BYTES) {
				break;
			}
			end = boundary;
		}
		if (end !== undefined) {
			if (end > RECORD_BYTES) {
				throw new Error("Fitness CSV record exceeds 3 MiB");
			}
			return { size, next, bytes, ends: ends.filter((value) => value <= end) };
		}
		if (bytes.length > RECORD_BYTES) {
			throw new Error("Fitness CSV record exceeds 3 MiB");
		}
		const range = yield* readArtifactRange(next, PAGE_BYTES, "uploadToken");
		size = range.size;
		next += range.bytes.length;
		const joined = new Uint8Array(bytes.length + range.bytes.length);
		joined.set(bytes);
		joined.set(range.bytes, bytes.length);
		bytes = joined;
	}
});

const collect = Effect.fn(function* (
	source: string,
	input: Extract<typeof FitnessStageInput.Type, { action: "collect" }>,
) {
	let buffered = new Uint8Array();
	if (input.carry !== null) {
		const range = yield* readArtifactRange(0, 1024 * 1024, "sourceCarry");
		if (range.size > range.bytes.length) {
			throw new Error("Fitness source carry exceeds 1 MiB");
		}
		buffered = new Uint8Array(range.bytes);
	}
	const page = yield* readCsvPage(input.offset, buffered, input.size);
	let header = input.header;
	const ends = page.ends;
	let consumed = 0;
	if (input.offset === 0) {
		const end = ends.shift() ?? 0;
		header = decoder.decode(page.bytes.slice(0, end)).trim();
		if (encoder.encode(header).length > 8192) {
			throw new Error("Fitness CSV header exceeds 8 KiB");
		}
		if (!header) {
			throw new Error("Fitness CSV is empty or has no header row");
		}
		consumed = end;
	}
	const records: FitnessRecord[] = [];
	let encodedBytes = 0;
	for (const end of ends) {
		const text = decoder.decode(page.bytes.slice(consumed, end));
		consumed = end;
		const row = parseCsvText(`${header}\n${text}`).rows[0];
		if (!row) {
			continue;
		}
		const itemIndex = input.itemIndex + records.length;
		let key = String(itemIndex).padStart(12, "0");
		if (source === "hevy") {
			key = `${readCsvCell(row, ["start_time", "Start Time", "StartTime"]) ?? ""}:${readCsvCell(row, ["title", "Title"]) ?? ""}`;
		}
		if (source === "strong_app") {
			key = `${readCsvCell(row, ["Date"]) ?? ""}:${readCsvCell(row, ["Workout Name", "WorkoutName"]) ?? ""}`;
		}
		const record = { key, row, itemIndex, failures: [] };
		const bytes = encoder.encode(encodeRecord(record)).length + 1;
		if (bytes > RECORD_BYTES) {
			throw new Error("Fitness CSV record exceeds 3 MiB when captured");
		}
		records.push(record);
		encodedBytes += bytes;
		if (encodedBytes >= PAGE_BYTES) {
			break;
		}
	}
	records.sort(compare);
	const tail = page.bytes.slice(consumed);
	const carryFile = tail.length ? "source-carry.bin" : null;
	const chunks: Array<{ name: string; contents: string | Uint8Array }> = [
		{ name: "records.jsonl", contents: serialize(records) },
	];
	if (carryFile) {
		chunks.push({ contents: tail, name: carryFile });
	}
	const manifest = yield* writeFitnessCapture(chunks);
	return yield* output({
		...manifest,
		header,
		carryFile,
		offset: page.next,
		totalSize: page.size ?? 0,
		itemIndex: input.itemIndex + records.length,
		done: page.next === page.size && !tail.length,
	});
});

const recordReader = () => {
	const windows = new Map<string, { offset: number; bytes: Uint8Array; size: number }>();
	return Effect.fn(function* (key: string, offset: number) {
		let bytes = new Uint8Array();
		for (;;) {
			const position = offset + bytes.length;
			let window = windows.get(key);
			if (!window || position < window.offset || position >= window.offset + window.bytes.length) {
				const range = yield* readArtifactRange(position, PAGE_BYTES, key);
				window = { ...range, offset: position };
				windows.set(key, window);
			}
			const range = { size: window.size, bytes: window.bytes.subarray(position - window.offset) };
			const newline = range.bytes.indexOf(10);
			const segment = newline < 0 ? range.bytes : range.bytes.subarray(0, newline);
			const joined = new Uint8Array(bytes.length + segment.length);
			joined.set(bytes);
			joined.set(segment, bytes.length);
			bytes = joined;
			if (!bytes.length && offset === range.size) {
				return null;
			}
			if (bytes.length > RECORD_BYTES) {
				throw new Error("Fitness capture record exceeds 3 MiB");
			}
			if (newline >= 0 || offset + bytes.length === range.size) {
				return {
					size: range.size,
					next: offset + bytes.length + (newline >= 0 ? 1 : 0),
					record: yield* Schema.decodeEffect(recordJson)(decoder.decode(bytes)),
				};
			}
		}
	});
};

const merge = Effect.fn(function* (
	input: Extract<typeof FitnessStageInput.Type, { action: "merge" }>,
) {
	const readRecord = recordReader();
	let leftOffset = input.leftOffset;
	let rightOffset = input.rightOffset;
	let left = yield* readRecord("left", leftOffset);
	let right = yield* readRecord("right", rightOffset);
	const records: FitnessRecord[] = [];
	let length = 0;
	while (left || right) {
		if ((!left && !input.leftFinal) || (!right && !input.rightFinal)) {
			break;
		}
		const useLeft = left && (!right || compare(left.record, right.record) <= 0);
		const selected = useLeft ? left : right;
		if (!selected) {
			break;
		}
		const size = encoder.encode(encodeRecord(selected.record)).length + 1;
		if (records.length && length + size > PAGE_BYTES) {
			break;
		}
		records.push(selected.record);
		length += size;
		if (useLeft) {
			leftOffset = selected.next;
			left = yield* readRecord("left", leftOffset);
		} else {
			rightOffset = selected.next;
			right = yield* readRecord("right", rightOffset);
		}
	}
	const manifest = yield* writeFitnessCapture([
		{ name: "records.jsonl", contents: serialize(records) },
	]);
	return yield* output({
		...manifest,
		leftOffset,
		rightOffset,
		leftDone: left === null,
		rightDone: right === null,
	});
});

const normalize = Effect.fn(function* (
	source: string,
	input: Extract<typeof FitnessStageInput.Type, { action: "normalize" }>,
) {
	const readRecord = recordReader();
	let offset = input.offset;
	let group: FitnessRecord[] = [];
	let groupBytes = 2;
	if (input.carry !== null) {
		const range = yield* readArtifactRange(0, 1024 * 1024, "carry");
		let bytes = range.bytes;
		while (bytes.length < range.size) {
			const next = yield* readArtifactRange(
				bytes.length,
				Math.min(1024 * 1024, range.size - bytes.length),
				"carry",
			);
			const joined = new Uint8Array(bytes.length + next.bytes.length);
			joined.set(bytes);
			joined.set(next.bytes, bytes.length);
			bytes = joined;
		}
		group = (yield* Schema.decodeEffect(groupJson)(decoder.decode(bytes))).slice();
		groupBytes = bytes.length;
	}
	const records: FitnessRecord[] = [];
	let normalizedRows = 0;
	const flush = () => {
		if (!group.length) {
			return;
		}
		normalizedRows += group.length;
		const rows = group.flatMap((record) =>
			record.row ? [{ row: record.row, itemIndex: record.itemIndex }] : [],
		);
		let result: ReturnType<typeof adaptHevyRows> | ReturnType<typeof adaptOpenScaleRows>;
		if (source === "hevy") {
			result = adaptHevyRows(rows, input.timezone);
		} else if (source === "strong_app") {
			result = adaptStrongAppRows(rows, input.timezone);
		} else {
			result = adaptOpenScaleRows(rows, Object.keys(rows[0]?.row ?? {}));
		}
		const unit = source === "open_scale" ? "measurements" : "workouts";
		for (const failure of result.failures) {
			const failureUnit = failure.sourceLabel.startsWith("Exercise:") ? "exercises" : unit;
			records.push({
				itemIndex: failure.itemIndex,
				key: String(failure.itemIndex).padStart(12, "0"),
				failures: [
					{
						...failure,
						unit: failureUnit,
						recordKind: failureUnit,
						operationId: fitnessFailureOperationId(failure),
					},
				],
			});
		}
		for (const item of result.items) {
			const writeItem =
				"exercises" in item
					? toWorkoutWriteItem(item)
					: {
							events: [],
							relationships: [],
							itemIndex: item.itemIndex,
							sourceLabel: item.sourceLabel,
							subjectEntityAlias: "measurement",
							sourceIdentifier: item.sourceIdentifier,
							recordId: measurementRecordId(item.itemIndex),
							entities: [
								{
									alias: "measurement",
									entitySchemaSlug: "measurement",
									outcome: { unit, recordKind: unit },
									name: `Measurement - ${item.sourceLabel}`,
									operationId: measurementOperationId(item.itemIndex),
									properties: {
										recordedAt: item.properties.recordedAt,
										statistics: item.properties.statistics,
										...(item.properties.comment !== undefined
											? { comment: item.properties.comment }
											: {}),
									},
								},
							],
						};
			if (
				genericImportItemIntents(writeItem).length > 1000 ||
				encoder.encode(encodeItem(writeItem)).length > RECORD_BYTES
			) {
				records.push({
					itemIndex: item.itemIndex,
					key: String(item.itemIndex).padStart(12, "0"),
					failures: [
						{
							unit,
							recordKind: unit,
							itemIndex: item.itemIndex,
							sourceLabel: item.sourceLabel,
							stage: "input_transformation",
							sourceIdentifier: item.sourceIdentifier,
							operationId: fitnessFailureOperationId(item),
							message: "Fitness record exceeds the bounded application limit",
						},
					],
				});
				continue;
			}
			records.push({
				failures: [],
				item: writeItem,
				itemIndex: item.itemIndex,
				key: String(item.itemIndex).padStart(12, "0"),
			});
		}
		group = [];
		groupBytes = 2;
	};
	let readBytes = 0;
	let done = false;
	while (readBytes < PAGE_BYTES) {
		const next = yield* readRecord("records", offset);
		if (!next) {
			done = true;
			if (input.final) {
				flush();
			}
			break;
		}
		if (group.length && group[0]?.key !== next.record.key) {
			flush();
		}
		groupBytes += next.next - offset - (group.length ? 0 : 1);
		group.push(next.record);
		if (groupBytes > RECORD_BYTES) {
			throw new Error("Fitness workout exceeds 3 MiB");
		}
		readBytes += next.next - offset;
		offset = next.next;
	}
	records.sort(compare);
	const chunks = [{ name: "records.jsonl", contents: serialize(records) }];
	const carryFile = group.length ? "carry.json" : null;
	if (carryFile) {
		chunks.push({ name: carryFile, contents: encodeGroup(group) });
	}
	const manifest = yield* writeFitnessCapture(chunks);
	return yield* output({ ...manifest, done, offset, carryFile, itemIndex: normalizedRows });
});

const application = Effect.fn(function* (
	input: Extract<typeof FitnessStageInput.Type, { action: "application" }>,
) {
	const readRecord = recordReader();
	let offset = input.offset;
	const items: Array<typeof genericImportWriteItemSchema.Type> = [];
	const failures: Array<typeof genericImportFailureSchema.Type> = [];
	let operations = 0;
	let bytes = 0;
	let done = false;
	for (;;) {
		const next = yield* readRecord("records", offset);
		if (!next) {
			done = true;
			break;
		}
		const item = next.record.item;
		const count = item ? genericImportItemIntents(item).length : next.record.failures.length;
		if (count > 1000) {
			throw new Error("Fitness workout exceeds 1000 operations");
		}
		if (
			(items.length || failures.length) &&
			(items.length >= 50 ||
				failures.length + next.record.failures.length > 100 ||
				operations + count > 1000 ||
				bytes + next.next - offset > RECORD_BYTES)
		) {
			break;
		}
		if (item) {
			items.push(item);
		}
		failures.push(...next.record.failures);
		operations += count;
		bytes += next.next - offset;
		offset = next.next;
	}
	const chunk = yield* Schema.decodeEffect(genericImportChunkSchema)({ items, failures });
	const manifest = yield* writeFitnessCapture([
		{ name: "application.json", contents: encodeChunk(chunk) },
	]);
	return yield* output({ ...manifest, done, offset });
});

export const runFitnessStage = Effect.fn(function* (
	source: string,
	input: typeof FitnessStageInput.Type,
) {
	switch (input.action) {
		case "collect":
			return yield* collect(source, input);
		case "merge":
			return yield* merge(input);
		case "normalize":
			return yield* normalize(source, input);
		case "application":
			return yield* application(input);
		default:
			throw new Error("Unsupported Fitness ingestion stage");
	}
});
