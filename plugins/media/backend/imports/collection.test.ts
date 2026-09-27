import { afterEach, expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import anilist from "./anilist.sandbox";
import {
	compareMediaRecords,
	mergeMediaRecords,
	normalizeMediaRecords,
	serializeMediaRecords,
	writeMediaCapture,
} from "./collection";
import type { MediaSourceRecord } from "./collection-schemas";
import { mediaEventOperationId } from "./identity";
import imdb from "./imdb.sandbox";
import { mediaFilesystem, mediaFilesystemKey, mediaStageInput } from "./ingestion.test-support";
import reader from "./read-batch.sandbox";
import { MediaImportAdapterBatch } from "./schemas";

const encoder = new TextEncoder();
afterEach(() => Reflect.deleteProperty(globalThis, mediaFilesystemKey));
const makeRecord = (itemIndex: number): MediaSourceRecord => ({
	itemIndex,
	key: "show",
	eventIndex: 0,
	operationId: mediaEventOperationId(itemIndex, 0),
	group: {
		itemIndex,
		collectionMemberships: [],
		entityRef: {
			externalId: "1",
			kind: "resolved",
			sourceLabel: "Show",
			entitySchemaSlug: "show",
			providerSlug: "show.tmdb",
		},
		events: [
			{
				eventSchemaSlug: "progress",
				properties: { text: "x".repeat(9000) },
				operationId: mediaEventOperationId(itemIndex, 0),
				occurredAt: itemIndex % 2 ? "2026-01-01T02:00:00+02:00" : "2026-01-01T00:00:00Z",
			},
		],
	},
});
it.live("frames quoted CSV and UTF-8 across bounded windows without rereading source bytes", () =>
	Effect.gen(function* () {
		const rows = Array.from(
			{ length: 90 },
			(_, index) => `tt${index},"Title ${index} ${"é".repeat(3000)}\nwith a quoted ""line""",movie`,
		);
		const fs = mediaFilesystem({
			uploadToken: encoder.encode(`Const,Title,Title Type\n${rows.join("\n")}`),
		});
		let input = mediaStageInput();
		const records: MediaSourceRecord[] = [];
		let calls = 0;
		for (;;) {
			const result = yield* imdb.run(input);
			calls++;
			records.push(...(yield* fs.records()));
			if (result.done) {
				break;
			}
			if (result.carryFile) {
				fs.files.set("carry", fs.scratch.get(result.carryFile) ?? new Uint8Array());
			}
			Object.assign(input, {
				offset: result.offset,
				header: result.header,
				itemIndex: result.itemIndex,
				...(result.carryFile
					? { ingestionArtifacts: { runId: "run", captures: { carry: "carry" } } }
					: {}),
			});
		}
		expect(calls).toBeGreaterThan(1);
		expect(records).toHaveLength(90);
		expect(records.map((record) => record.itemIndex).sort((a, b) => a - b)).toEqual(
			Array.from({ length: 90 }, (_, index) => index),
		);
		expect(records[0]?.group?.entityRef.sourceLabel).toContain('with a quoted "line"');
		const reads = fs.reads.filter((read) => read.key === "uploadToken");
		for (let index = 1; index < reads.length; index++) {
			expect(reads[index]?.offset).toBe(
				(reads[index - 1]?.offset ?? 0) + (reads[index - 1]?.length ?? 0),
			);
		}
	}),
);
it.live("merges multiple capture windows with chronological and original equal-time ordering", () =>
	Effect.gen(function* () {
		const left = Array.from({ length: 40 }, (_, index) => makeRecord(index * 2));
		const right = Array.from({ length: 40 }, (_, index) => makeRecord(index * 2 + 1));
		const fs = mediaFilesystem({
			left: encoder.encode(serializeMediaRecords(left)),
			right: encoder.encode(serializeMediaRecords(right)),
		});
		let leftOffset = 0;
		let rightOffset = 0;
		let pages = 0;
		const records: MediaSourceRecord[] = [];
		for (;;) {
			const result = yield* mergeMediaRecords(
				mediaStageInput({
					leftOffset,
					rightOffset,
					action: "merge",
					leftFinal: true,
					rightFinal: true,
					ingestionArtifacts: { runId: "run", captures: { left: "left", right: "right" } },
				}),
			);
			records.push(...(yield* fs.records()));
			pages++;
			leftOffset = result.leftOffset;
			rightOffset = result.rightOffset;
			if (result.leftDone && result.rightDone) {
				break;
			}
		}
		expect(pages).toBeGreaterThan(1);
		expect(records.map((item) => item.itemIndex)).toEqual(
			Array.from({ length: 80 }, (_, index) => index),
		);
		expect(records.slice().sort(compareMediaRecords)).toEqual(records);
	}),
);
it.live("captures AniList metadata after the arrays and uses it during bounded normalization", () =>
	Effect.gen(function* () {
		const fs = mediaFilesystem({
			uploadToken: encoder.encode(
				yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
					user: { custom_lists: { anime: ["Late metadata"] } },
					lists: [
						{
							id: 1,
							score: 0,
							progress: 0,
							series_id: 42,
							series_type: 0,
							progress_volume: 0,
							status: "PLANNING",
							custom_lists: "[0]",
						},
					],
				}),
			),
		});
		const result = yield* anilist.run(mediaStageInput({ settings: { timezone: "UTC" } }));
		expect(result.done).toBe(true);
		const raw = (yield* fs.records()).sort(compareMediaRecords);
		fs.files.set("records", encoder.encode(serializeMediaRecords(raw)));
		yield* anilist.run(
			mediaStageInput({
				action: "normalize",
				settings: { timezone: "UTC" },
				ingestionArtifacts: { runId: "run", captures: { records: "records" } },
			}),
		);
		fs.files.set("records", fs.scratch.get("records.jsonl") ?? new Uint8Array());
		const prepared = yield* reader.run({
			offset: 0,
			itemIndex: 0,
			dedupKey: null,
			ingestionArtifacts: { runId: "run", captures: { records: "records" } },
		});
		const captured = yield* Schema.decodeEffect(Schema.fromJsonString(MediaImportAdapterBatch))(
			new TextDecoder().decode(fs.scratch.get("batch.json")),
		);
		expect(captured.entityGroups[0]).toMatchObject({
			collectionMemberships: [{ collectionName: "Late metadata" }],
			events: [
				{
					eventSchemaSlug: "backlog",
					attribution: { sourceIdentifier: "42", recordId: '["media-source",0]' },
				},
			],
		});
		expect(prepared.batch.entityGroups[0]?.collectionMemberships).toEqual([]);
	}),
);
it.live("gives every record of an oversized source row its own failure identity", () =>
	Effect.gen(function* () {
		const records = normalizeMediaRecords(
			{
				failures: [],
				entityGroups: [
					{
						itemIndex: 0,
						collectionMemberships: [{ collectionName: "Pinned" }],
						events: ["complete", "review"].map((eventSchemaSlug) => ({
							properties: {},
							eventSchemaSlug,
							occurredAt: "2026-01-01T00:00:00Z",
						})),
						entityRef: {
							kind: "unresolved",
							identifierType: "imdb",
							sourceLabel: "Oversized",
							entitySchemaSlug: "movie",
							identifierValue: "tt".repeat(600),
						},
					},
				],
			},
			7,
			"imdb",
		);
		const fs = mediaFilesystem({ records: encoder.encode(serializeMediaRecords(records)) });
		yield* reader.run({
			offset: 0,
			itemIndex: 0,
			dedupKey: null,
			ingestionArtifacts: { runId: "run", captures: { records: "records" } },
		});
		const batch = yield* Schema.decodeEffect(Schema.fromJsonString(MediaImportAdapterBatch))(
			new TextDecoder().decode(fs.scratch.get("batch.json")),
		);
		expect(batch.failures.map(({ operationId }) => operationId).sort()).toEqual([
			'["media-event",7,0]',
			'["media-event",7,1]',
			'["media-membership",7,"Pinned"]',
		]);
	}),
);
it.live("rejects capture and scratch overflow before publishing any files", () =>
	Effect.gen(function* () {
		const fs = mediaFilesystem({});
		expect(
			(yield* writeMediaCapture([
				{ name: "large", contents: new Uint8Array(4 * 1024 * 1024 + 1) },
			]).pipe(Effect.exit))._tag,
		).toBe("Failure");
		expect(
			(yield* writeMediaCapture([
				{ name: "left", contents: new Uint8Array(3 * 1024 * 1024) },
				{ name: "right", contents: new Uint8Array(3 * 1024 * 1024) },
			]).pipe(Effect.exit))._tag,
		).toBe("Failure");
		expect(fs.scratch.size).toBe(0);
	}),
);
