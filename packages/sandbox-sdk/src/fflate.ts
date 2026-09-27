import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { readArtifactRange } from "@ryot-app/sandbox-sdk/filesystem";
import {
	Gunzip,
	Inflate,
	gzipSync as gzipSyncFunction,
	gunzipSync as gunzipSyncFunction,
	strFromU8 as strFromU8Function,
	unzipSync as unzipSyncFunction,
} from "fflate";

export const zipEntrySchema = Schema.Struct({
	name: Schema.String,
	size: Schema.Finite,
	compression: Schema.Finite,
	localOffset: Schema.Finite,
	compressedSize: Schema.Finite,
});

export type ZipEntry = Schema.Schema.Type<typeof zipEntrySchema>;

const zipError = (error: unknown) => ({
	_tag: "SandboxFilesystemError" as const,
	message: error instanceof Error ? error.message : String(error),
});
const gzipError = (error: unknown) => ({
	_tag: "SandboxFilesystemError" as const,
	message: error instanceof Error ? error.message : String(error),
});

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const requireZip = (condition: boolean, message: string) => {
	if (!condition) {
		throw new Error(message);
	}
};

export const listZipEntries = Effect.fn("filesystem.listZipEntries")(function* (input: {
	key?: string;
	after?: number;
	limit?: number;
}) {
	const limit = input.limit ?? 100;
	if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
		return yield* Effect.fail(zipError("ZIP page limit must be 1..100"));
	}
	const { size: archiveSize } = yield* readArtifactRange(0, 1, input.key);
	const tail = yield* readArtifactRange(Math.max(0, archiveSize - 65557), 65557, input.key);
	const directory = yield* Effect.try({
		catch: zipError,
		try: () => {
			const data = view(tail.bytes);
			for (let index = tail.bytes.length - 22; index >= 0; index--) {
				if (
					data.getUint32(index, true) !== 0x06054b50 ||
					index + 22 + data.getUint16(index + 20, true) !== tail.bytes.length
				) {
					continue;
				}
				requireZip(
					data.getUint16(index + 4, true) === 0 && data.getUint16(index + 6, true) === 0,
					"Multi-volume ZIP is unsupported",
				);
				requireZip(data.getUint16(index + 10, true) !== 65535, "ZIP64 is unsupported");
				const start = data.getUint32(index + 16, true);
				const end = start + data.getUint32(index + 12, true);
				requireZip(end <= archiveSize - tail.bytes.length + index, "Invalid ZIP directory");
				return { end, start };
			}
			throw new Error("ZIP directory was not found");
		},
	});
	let offset = input.after ?? directory.start;
	if (!Number.isSafeInteger(offset) || offset < directory.start || offset > directory.end) {
		return yield* Effect.fail(zipError("Invalid ZIP cursor"));
	}
	const entries: ZipEntry[] = [];
	let nameBytes = 0;
	while (offset < directory.end && entries.length < limit) {
		const header = yield* readArtifactRange(offset, 46, input.key);
		const metadata = yield* Effect.try({
			catch: zipError,
			try: () => {
				const data = view(header.bytes);
				requireZip(
					header.bytes.length === 46 && data.getUint32(0, true) === 0x02014b50,
					"Invalid ZIP entry",
				);
				requireZip((data.getUint16(8, true) & 1) === 0, "Encrypted ZIP is unsupported");
				const compression = data.getUint16(10, true);
				requireZip(compression === 0 || compression === 8, "Unsupported ZIP compression");
				const compressedSize = data.getUint32(20, true);
				const size = data.getUint32(24, true);
				const localOffset = data.getUint32(42, true);
				requireZip(
					compressedSize !== 0xffffffff && size !== 0xffffffff && localOffset !== 0xffffffff,
					"ZIP64 is unsupported",
				);
				const nameSize = data.getUint16(28, true);
				const next = offset + 46 + nameSize + data.getUint16(30, true) + data.getUint16(32, true);
				requireZip(next <= directory.end, "Invalid ZIP entry size");
				return { next, size, nameSize, compression, localOffset, compressedSize };
			},
		});
		if (nameBytes + metadata.nameSize > 256 * 1024) {
			break;
		}
		const name = metadata.nameSize
			? (yield* readArtifactRange(offset + 46, metadata.nameSize, input.key)).bytes
			: new Uint8Array();
		entries.push({
			size: metadata.size,
			name: strFromU8Function(name),
			compression: metadata.compression,
			localOffset: metadata.localOffset,
			compressedSize: metadata.compressedSize,
		});
		nameBytes += metadata.nameSize;
		offset = metadata.next;
	}
	return { entries, next: offset < directory.end ? offset : null };
});

export const readZipEntryRange = Effect.fn("filesystem.readZipEntryRange")(function* (input: {
	entry: ZipEntry;
	offset: number;
	length: number;
	key?: string;
}) {
	const { key, entry, offset, length } = input;
	if (
		![offset, entry.localOffset, entry.compressedSize, entry.size].every(
			(value) => Number.isSafeInteger(value) && value >= 0,
		) ||
		!Number.isInteger(length) ||
		length < 1 ||
		length > 1024 * 1024 ||
		(entry.compression !== 0 && entry.compression !== 8)
	) {
		return yield* Effect.fail(zipError("Invalid ZIP entry range"));
	}
	const header = yield* readArtifactRange(entry.localOffset, 30, key);
	const start = yield* Effect.try({
		catch: zipError,
		try: () => {
			const data = view(header.bytes);
			requireZip(
				header.bytes.length === 30 && data.getUint32(0, true) === 0x04034b50,
				"Invalid ZIP local header",
			);
			requireZip(
				(data.getUint16(6, true) & 1) === 0 && data.getUint16(8, true) === entry.compression,
				"Invalid ZIP local compression",
			);
			const dataOffset =
				entry.localOffset + 30 + data.getUint16(26, true) + data.getUint16(28, true);
			requireZip(dataOffset + entry.compressedSize <= header.size, "Truncated ZIP entry");
			return dataOffset;
		},
	});
	const output = new Uint8Array(Math.min(length, Math.max(0, entry.size - offset)));
	if (offset > entry.size) {
		return yield* Effect.fail(zipError("ZIP range is past the entry end"));
	}
	if (entry.compression === 0) {
		if (entry.compressedSize !== entry.size) {
			return yield* Effect.fail(zipError("Invalid stored ZIP entry size"));
		}
		const bytes = output.length
			? (yield* readArtifactRange(start + Math.min(offset, entry.size), output.length, key)).bytes
			: output;
		return { bytes, next: offset + bytes.length < entry.size ? offset + bytes.length : null };
	}
	let produced = 0;
	let copied = 0;
	const inflater = new Inflate((bytes) => {
		const from = Math.max(0, offset - produced);
		const count = Math.min(bytes.length - from, output.length - copied);
		if (count > 0) {
			output.set(bytes.subarray(from, from + count), copied);
			copied += count;
		}
		produced += bytes.length;
		requireZip(produced <= entry.size, "ZIP entry exceeds declared size");
	});
	let consumed = 0;
	while (
		consumed < entry.compressedSize &&
		(copied < output.length || offset + output.length === entry.size)
	) {
		const chunk = yield* readArtifactRange(
			start + consumed,
			Math.min(65536, entry.compressedSize - consumed),
			key,
		);
		if (!chunk.bytes.length) {
			return yield* Effect.fail(zipError("Truncated ZIP entry"));
		}
		for (
			let index = 0;
			index < chunk.bytes.length &&
			(copied < output.length || offset + output.length === entry.size);
			index += 256
		) {
			const compressed = chunk.bytes.subarray(index, index + 256);
			consumed += compressed.length;
			yield* Effect.try({
				catch: zipError,
				try: () => inflater.push(compressed, consumed === entry.compressedSize),
			});
		}
	}
	if (copied !== output.length || (consumed === entry.compressedSize && produced !== entry.size)) {
		return yield* Effect.fail(zipError("Invalid ZIP expanded size"));
	}
	return { bytes: output, next: offset + copied < entry.size ? offset + copied : null };
});

export const readGzipRange = Effect.fn("filesystem.readGzipRange")(function* (input: {
	key?: string;
	offset: number;
	length: number;
}) {
	const { key, offset, length } = input;
	if (
		!Number.isSafeInteger(offset) ||
		offset < 0 ||
		!Number.isInteger(length) ||
		length < 1 ||
		length > 1024 * 1024
	) {
		return yield* Effect.fail(gzipError("Invalid GZIP range"));
	}
	const { size } = yield* readArtifactRange(0, 1, key);
	if (!Number.isSafeInteger(size) || size < 20) {
		return yield* Effect.fail(gzipError("Invalid gzip data"));
	}
	const output = new Uint8Array(length);
	let produced = 0;
	let copied = 0;
	const inflater = new Gunzip((bytes) => {
		const from = Math.max(0, offset - produced);
		const count = Math.min(bytes.length - from, output.length - copied);
		if (from < bytes.length && count > 0) {
			output.set(bytes.subarray(from, from + count), copied);
			copied += count;
		}
		produced += bytes.length;
	});
	let consumed = 0;
	while (consumed < size) {
		const chunk = yield* readArtifactRange(consumed, Math.min(65536, size - consumed), key);
		if (!chunk.bytes.length) {
			return yield* Effect.fail(gzipError("Truncated GZIP artifact"));
		}
		for (let index = 0; index < chunk.bytes.length; index += 256) {
			const compressed = chunk.bytes.subarray(index, index + 256);
			consumed += compressed.length;
			yield* Effect.try({
				catch: gzipError,
				try: () => inflater.push(compressed, consumed === size),
			});
		}
	}
	if (offset > produced) {
		return yield* Effect.fail(gzipError("GZIP range is past the expanded data end"));
	}
	const bytes = output.subarray(0, copied);
	return { bytes, next: offset + copied < produced ? offset + copied : null };
});

export type * from "fflate";
export const gzipSync: typeof gzipSyncFunction = (data, options) =>
	gzipSyncFunction(data, { ...options, mtime: options?.mtime ?? 0 });
export const unzipSync: typeof unzipSyncFunction = unzipSyncFunction;
export const strFromU8: typeof strFromU8Function = strFromU8Function;
export const gunzipSync: typeof gunzipSyncFunction = gunzipSyncFunction;
