import { expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { BackupArchiveError } from "./error";
import { ARCHIVE_MAX_RECORD_BYTES, encodeArchiveJsonLine, NdjsonDecoder } from "./streaming";

const encoder = new TextEncoder();
const record = Schema.Struct({ value: Schema.String });

const decodeChunks = <A, I>(
	chunks: Iterable<Uint8Array>,
	codec: Schema.Codec<A, I>,
	path: string,
	maxRecordBytes?: number,
) => {
	const decoder = new NdjsonDecoder(codec, path, maxRecordBytes);
	const values: A[] = [];
	for (const chunk of chunks) {
		values.push(...decoder.push(chunk));
	}
	decoder.end();
	return values;
};

const captureError = (run: () => unknown) => {
	try {
		run();
	} catch (error) {
		return error;
	}
	throw new Error("Expected the operation to fail");
};

it("accepts a record at the byte limit across multi-byte UTF-8 chunk splits", () => {
	const value = "é".repeat((ARCHIVE_MAX_RECORD_BYTES - 12) / 2);
	const line = encoder.encode(`${JSON.stringify({ value })}\n`);
	expect(line.byteLength - 1).toBe(ARCHIVE_MAX_RECORD_BYTES);

	const split = encoder.encode('{"value":"').byteLength + 1;
	const values = decodeChunks(
		[
			line.subarray(0, split),
			line.subarray(split, line.byteLength - 1),
			line.subarray(line.byteLength - 1),
		],
		record,
		"records.ndjson",
	);
	expect(values).toEqual([{ value }]);
});

it("rejects oversized terminated and unterminated records with their byte counts and path", () => {
	for (const payload of ['"abc"\n', '"abc"']) {
		const error = captureError(() =>
			decodeChunks([encoder.encode(payload)], Schema.String, "records.ndjson", 4),
		);
		expect(error).toBeInstanceOf(BackupArchiveError);
		expect(error).toMatchObject({
			maxBytes: 4,
			actualBytes: 5,
			path: "records.ndjson",
			reason: "entry_too_large",
		});
	}
});

it("applies the limit per record rather than to the whole stream", () => {
	const values = decodeChunks([encoder.encode('"a"\n"b"\n')], Schema.String, "records.ndjson", 3);
	expect(values).toEqual(["a", "b"]);
});

it("rejects malformed UTF-8 and reports the correct line number", () => {
	const error = captureError(() =>
		decodeChunks([new Uint8Array([0x22, 0xc3, 0x28, 0x22, 0x0a])], Schema.String, "records.ndjson"),
	);
	expect(error).toBeInstanceOf(BackupArchiveError);
	expect(error).toMatchObject({
		path: "records.ndjson",
		reason: "invalid_entry",
		message: "Invalid NDJSON at line 1",
	});

	const secondLineError = captureError(() =>
		decodeChunks([encoder.encode('"valid"\nnot-json\n')], Schema.String, "records.ndjson"),
	);
	expect(secondLineError).toMatchObject({
		path: "records.ndjson",
		reason: "invalid_entry",
		message: "Invalid NDJSON at line 2",
	});
});

it("requires the final record to end with a newline", () => {
	const error = captureError(() =>
		decodeChunks([encoder.encode('"valid"')], Schema.String, "records.ndjson"),
	);
	expect(error).toBeInstanceOf(BackupArchiveError);
	expect(error).toMatchObject({ path: "records.ndjson", reason: "truncated_ndjson" });
});

it("enforces the record limit while encoding except for metadata entries", () => {
	const value = "x".repeat(ARCHIVE_MAX_RECORD_BYTES - 1);
	const error = captureError(() => encodeArchiveJsonLine(Schema.String, value, "records.ndjson"));
	expect(error).toBeInstanceOf(BackupArchiveError);
	expect(error).toMatchObject({
		path: "records.ndjson",
		reason: "entry_too_large",
		maxBytes: ARCHIVE_MAX_RECORD_BYTES,
		actualBytes: ARCHIVE_MAX_RECORD_BYTES + 1,
	});

	for (const path of ["manifest.json", "profile.json"]) {
		const line = encodeArchiveJsonLine(Schema.String, value, path);
		expect(line.byteLength - 1).toBe(ARCHIVE_MAX_RECORD_BYTES + 1);
	}
});
