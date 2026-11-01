import { afterEach, assert, expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { installSandboxTestFilesystem } from "@ryot-app/plugin-backend-sdk/testing";

import { FitnessRecord } from "./schemas";
import { csvRecordEnds, runFitnessStage } from "./shared";

afterEach(() => installSandboxTestFilesystem(undefined));

it("frames quoted newlines, escaped quotes, CRLF and partial UTF-8 without decoding a partial record", () => {
	const encoder = new TextEncoder();
	const text = 'date,comment\r\n2026-01-01,"a\n""quoted"" 🏋️"\r\n';
	const bytes = encoder.encode(text);
	const first = encoder.encode("date,comment\r\n").length;
	for (let end = first; end < bytes.length - 1; end++) {
		expect(csvRecordEnds(bytes.slice(0, end), false)).toEqual([first]);
	}
	expect(csvRecordEnds(bytes, true)).toEqual([first, bytes.length]);
	expect(() => csvRecordEnds(encoder.encode('date\n"broken'), true)).toThrow("quoted field");
});

it.effect("normalizes OpenScale readings with the timezone pinned in the stage input", () =>
	Effect.gen(function* () {
		const encoder = new TextEncoder();
		const encodeRecord = Schema.encodeEffect(Schema.fromJsonString(FitnessRecord));
		const source = encoder.encode(
			(yield* encodeRecord({
				itemIndex: 7,
				failures: [],
				key: "000000000007",
				row: { weight: "75", dateTime: "2026-04-01 08:00:00" },
			})) + "\n",
		);
		const files = new Map<string, Uint8Array>();
		installSandboxTestFilesystem({
			readArtifact: () => Promise.reject(new Error("Unexpected full artifact read")),
			readNamedArtifact: () => Promise.reject(new Error("Unexpected full artifact read")),
			writeScratchChunks: (chunks) => {
				for (const chunk of chunks) {
					files.set(chunk.name, chunk.contents);
				}
				return Promise.resolve();
			},
			readArtifactRange: (offset, length, key) => {
				expect(key).toBe("records");
				return Promise.resolve({
					size: source.length,
					bytes: source.slice(offset, offset + length),
				});
			},
		});
		return yield* runFitnessStage("open_scale", {
			offset: 0,
			final: true,
			carry: null,
			action: "normalize",
			timezone: "Asia/Kolkata",
			ingestionArtifacts: { runId: "run-1", captures: { records: "records-capture" } },
		}).pipe(
			Effect.flatMap((output) => {
				expect(output).toMatchObject({ done: true, itemIndex: 1, carryFile: null });
				const bytes = files.get("records.jsonl");
				assert(bytes);
				return Schema.decodeEffect(Schema.fromJsonString(FitnessRecord))(
					new TextDecoder().decode(bytes).trim(),
				);
			}),
			Effect.map((record) => {
				expect(record.failures).toEqual([]);
				expect(record.item).toMatchObject({
					itemIndex: 7,
					sourceIdentifier: "2026-04-01T02:30:00.000Z",
					events: [{ occurredAt: "2026-04-01T02:30:00.000Z" }],
				});
			}),
		);
	}),
);
