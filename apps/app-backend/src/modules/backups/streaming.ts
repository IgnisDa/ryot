import { Schema } from "effect";

import { archiveError, BackupArchiveError } from "#modules/backup-data/archive-error";

const encoder = new TextEncoder();

export class IncrementalSha256 {
	readonly #hasher = new Bun.CryptoHasher("sha256");
	#bytes = 0;

	update(chunk: Uint8Array) {
		this.#bytes += chunk.byteLength;
		this.#hasher.update(chunk);
	}

	get bytes() {
		return this.#bytes;
	}

	digest() {
		return { bytes: this.#bytes, sha256: this.#hasher.digest("hex") };
	}
}

export function* encodeNdjson<A, I>(
	values: Iterable<A>,
	codec: Schema.Codec<A, I>,
): Generator<Uint8Array> {
	for (const value of values) {
		const encoded = Schema.encodeUnknownSync(codec)(value);
		yield encoder.encode(`${JSON.stringify(encoded)}\n`);
	}
}

export function* decodeNdjson<A, I>(
	chunks: Iterable<Uint8Array>,
	codec: Schema.Codec<A, I>,
	path = "ndjson",
): Generator<A, void, undefined> {
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let buffered = "";
	let line = 0;
	try {
		for (const chunk of chunks) {
			buffered += decoder.decode(chunk, { stream: true });
			let newline = buffered.indexOf("\n");
			while (newline >= 0) {
				const text = buffered.slice(0, newline);
				buffered = buffered.slice(newline + 1);
				line += 1;
				if (text.length === 0) {
					throw archiveError("invalid_entry", `Empty NDJSON line ${line}`, path);
				}
				yield Schema.decodeUnknownSync(codec)(JSON.parse(text));
				newline = buffered.indexOf("\n");
			}
		}
		buffered += decoder.decode();
	} catch (error) {
		if (error instanceof BackupArchiveError) {
			throw error;
		}
		throw archiveError("invalid_entry", `Invalid NDJSON at line ${line + 1}`, path);
	}
	if (buffered.length > 0) {
		throw archiveError("truncated_ndjson", "NDJSON must end with a newline", path);
	}
}
