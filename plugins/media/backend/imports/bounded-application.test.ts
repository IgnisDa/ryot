import { afterEach, expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { genericImportChunkSchema } from "@ryot-app/sandbox-sdk/imports";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";

import { serializeMediaRecords } from "./collection";
import { mediaFilesystem, mediaFilesystemKey } from "./ingestion.test-support";
import reader from "./read-batch.sandbox";
import writer, { manifest } from "./write-chunks.sandbox";

const unexpected = () =>
	Effect.die(new Error("Ordinary import used an integration host capability"));

afterEach(() => Reflect.deleteProperty(globalThis, mediaFilesystemKey));
it.live(
	"keeps large event properties in artifacts and restores original provider attribution before application",
	() =>
		Effect.gen(function* () {
			const attribution = {
				recordId: "provider-session-77",
				sourceLabel: "Original episode",
				sourceIdentifier: "original-session-77",
			};
			const text = "review ".repeat(15000);
			const fs = mediaFilesystem({
				records: new TextEncoder().encode(
					serializeMediaRecords([
						{
							key: "book",
							itemIndex: 77,
							eventIndex: 0,
							operationId: "provider-operation-77",
							group: {
								itemIndex: 77,
								collectionMemberships: [{ collectionName: "Imported" }],
								entityRef: {
									kind: "resolved",
									externalId: "42",
									entitySchemaSlug: "book",
									providerSlug: "book.hardcover",
									sourceLabel: "Source title".repeat(1000),
								},
								events: [
									{
										attribution,
										sourceItemIndex: 77,
										properties: { text },
										eventSchemaSlug: "review",
										occurredAt: "2026-01-01T00:00:00Z",
										operationId: "provider-operation-77",
									},
								],
							},
						},
					]),
				),
			});
			const prepared = yield* reader.run({
				offset: 0,
				itemIndex: 0,
				dedupKey: null,
				ingestionArtifacts: { runId: "run", captures: { records: "records" } },
			});
			expect(
				new TextEncoder().encode(
					yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(prepared.batch),
				).length,
			).toBeLessThan(4096);
			expect(prepared.batch.entityGroups[0]?.events[0]?.properties).toEqual({});
			fs.files.set("batch", fs.scratch.get("batch.json") ?? new Uint8Array());
			yield* writer.run(
				{
					...prepared.batch,
					ownershipSyncedAt: "2026-01-01T00:00:00Z",
					ingestionArtifacts: { runId: "run", captures: { batch: "batch" } },
					populationResults: [{ index: 0, entityId: "book", status: "completed" }],
				},
				defineSandboxTestHost(manifest, {
					log: unexpected,
					executeRyotql: unexpected,
					getPluginConfig: unexpected,
					getCurrentIntegration: unexpected,
				}),
			);
			const chunk = yield* Schema.decodeEffect(Schema.fromJsonString(genericImportChunkSchema))(
				new TextDecoder().decode(fs.scratch.get("writes.json")),
			);
			expect(chunk.items[0]?.events[0]).toMatchObject({
				attribution,
				properties: { text },
				operationId: "provider-operation-77",
				outcome: { unit: "events", recordKind: "review" },
			});
			expect(chunk.items[0]?.collectionMemberships?.[0]?.collectionName).toBe("Imported");
		}),
);
