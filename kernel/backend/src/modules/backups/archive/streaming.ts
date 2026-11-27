import { Result, Schema } from "effect";

import { archiveEntryTooLarge, archiveError, BackupArchiveError } from "./error";

const encoder = new TextEncoder();

export const ARCHIVE_MAX_RECORD_BYTES = 4 * 1024 * 1024;

export class IncrementalSha256 {
	get bytes() {
		return this.#bytes;
	}
	#bytes = 0;

	readonly #hasher = new Bun.CryptoHasher("sha256");

	digest() {
		return { bytes: this.#bytes, sha256: this.#hasher.digest("hex") };
	}

	update(chunk: Uint8Array) {
		this.#bytes += chunk.byteLength;
		this.#hasher.update(chunk);
	}
}

export class NdjsonDecoder<A, I> {
	#line = 0;
	#recordBytes = 0;
	readonly #path: string;
	#buffered = new Uint8Array(0);
	readonly #maxRecordBytes: number;
	readonly #codec: Schema.Codec<A, I>;
	readonly #decoder = new TextDecoder("utf-8", { fatal: true });

	constructor(codec: Schema.Codec<A, I>, path: string, maxRecordBytes = ARCHIVE_MAX_RECORD_BYTES) {
		this.#path = path;
		this.#codec = codec;
		this.#maxRecordBytes = maxRecordBytes;
	}

	end() {
		if (this.#recordBytes === 0) {
			return;
		}
		const buffered = this.#takeBuffered();
		try {
			this.#decoder.decode(buffered);
		} catch {
			throw archiveError("invalid_entry", `Invalid NDJSON at line ${this.#line + 1}`, this.#path);
		}
		throw archiveError("truncated_ndjson", "NDJSON must end with a newline", this.#path);
	}

	*push(chunk: Uint8Array): Generator<A, void, undefined> {
		let start = 0;
		for (let index = 0; index <= chunk.byteLength; index += 1) {
			if (index < chunk.byteLength && chunk[index] !== 0x0a) {
				continue;
			}
			this.#appendRecordBytes(chunk.subarray(start, index));
			if (index === chunk.byteLength) {
				break;
			}

			this.#line += 1;
			const line = this.#takeBuffered();
			if (line.byteLength === 0) {
				throw archiveError("invalid_entry", `Empty NDJSON line ${this.#line}`, this.#path);
			}
			try {
				const text = this.#decoder.decode(line);
				const decoded = Schema.decodeUnknownResult(this.#codec)(JSON.parse(text));
				if (Result.isFailure(decoded)) {
					throw archiveError("invalid_entry", `Invalid NDJSON at line ${this.#line}`, this.#path);
				}
				yield decoded.success;
			} catch (error) {
				if (error instanceof BackupArchiveError) {
					throw error;
				}
				throw archiveError("invalid_entry", `Invalid NDJSON at line ${this.#line}`, this.#path);
			}
			start = index + 1;
		}
	}

	#takeBuffered() {
		const byteLength = this.#recordBytes;
		this.#recordBytes = 0;
		return this.#buffered.subarray(0, byteLength);
	}

	#appendRecordBytes(bytes: Uint8Array) {
		const actualBytes = this.#recordBytes + bytes.byteLength;
		if (actualBytes > this.#maxRecordBytes) {
			throw archiveEntryTooLarge(this.#path, actualBytes, this.#maxRecordBytes);
		}
		if (actualBytes > this.#buffered.byteLength) {
			const capacity = Math.min(
				this.#maxRecordBytes,
				Math.max(actualBytes, this.#buffered.byteLength * 2, 1_024),
			);
			const buffer = new Uint8Array(capacity);
			buffer.set(this.#buffered.subarray(0, this.#recordBytes));
			this.#buffered = buffer;
		}
		this.#buffered.set(bytes, this.#recordBytes);
		this.#recordBytes = actualBytes;
	}
}

export const decodeArchiveJson = <A, I>(
	codec: Schema.Codec<A, I>,
	value: unknown,
	path: string,
) => {
	const decoded = Schema.decodeUnknownResult(codec)(value);
	if (Result.isFailure(decoded)) {
		throw archiveError("invalid_entry", `Invalid ${path}`, path);
	}
	return decoded.success;
};

export const encodeArchiveJsonLine = <A, I>(codec: Schema.Codec<A, I>, value: A, path: string) => {
	const encoded = Schema.encodeResult(codec)(value);
	if (Result.isFailure(encoded)) {
		throw archiveError("invalid_entry", `Invalid ${path}`, path);
	}
	const line = encoder.encode(`${JSON.stringify(encoded.success)}\n`);
	const recordBytes = line.byteLength - 1;
	if (
		path !== "manifest.json" &&
		path !== "profile.json" &&
		recordBytes > ARCHIVE_MAX_RECORD_BYTES
	) {
		throw archiveEntryTooLarge(path, recordBytes, ARCHIVE_MAX_RECORD_BYTES);
	}
	return line;
};

export function* encodeNdjson<A, I>(
	values: Iterable<A>,
	codec: Schema.Codec<A, I>,
	path = "ndjson",
): Generator<Uint8Array> {
	for (const value of values) {
		yield encodeArchiveJsonLine(codec, value, path);
	}
}

export function* decodeNdjson<A, I>(
	chunks: Iterable<Uint8Array>,
	codec: Schema.Codec<A, I>,
	path = "ndjson",
): Generator<A, void, undefined> {
	const decoder = new NdjsonDecoder(codec, path);
	for (const chunk of chunks) {
		yield* decoder.push(chunk);
	}
	decoder.end();
}
