import { Schema } from "effect";

import { archiveError, BackupArchiveError } from "./error";

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

export class NdjsonDecoder<A, I> {
	#line = 0;
	#buffered = "";
	readonly #path: string;
	readonly #codec: Schema.Codec<A, I>;
	readonly #decoder = new TextDecoder("utf-8", { fatal: true });

	constructor(codec: Schema.Codec<A, I>, path: string) {
		this.#path = path;
		this.#codec = codec;
	}

	*push(chunk: Uint8Array): Generator<A, void, undefined> {
		try {
			this.#buffered += this.#decoder.decode(chunk, { stream: true });
			let newline = this.#buffered.indexOf("\n");
			while (newline >= 0) {
				const text = this.#buffered.slice(0, newline);
				this.#buffered = this.#buffered.slice(newline + 1);
				this.#line += 1;
				if (text.length === 0) {
					throw archiveError("invalid_entry", `Empty NDJSON line ${this.#line}`, this.#path);
				}
				yield Schema.decodeUnknownSync(this.#codec)(JSON.parse(text));
				newline = this.#buffered.indexOf("\n");
			}
		} catch (error) {
			if (error instanceof BackupArchiveError) {
				throw error;
			}
			throw archiveError("invalid_entry", `Invalid NDJSON at line ${this.#line + 1}`, this.#path);
		}
	}

	end() {
		try {
			this.#buffered += this.#decoder.decode();
		} catch {
			throw archiveError("invalid_entry", `Invalid NDJSON at line ${this.#line + 1}`, this.#path);
		}
		if (this.#buffered.length > 0) {
			throw archiveError("truncated_ndjson", "NDJSON must end with a newline", this.#path);
		}
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
