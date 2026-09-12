import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import { mediaNormalizedRecordReader, writeMediaCapture } from "./collection";
import { MediaSourceRecord } from "./collection-schemas";
import { importEntityRefKey, importEntityRefIdentifier } from "./groups";
import { MediaReadBatchInput, MediaReadBatchOutput } from "./process";
import {
	type MediaImportFailure,
	MediaImportAdapterBatch,
	type MediaImportBatchEntityGroup,
} from "./schemas";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.read-batch",
	name: "Prepare captured media application batch",
});
export default defineScript({
	manifest,
	input: MediaReadBatchInput,
	output: MediaReadBatchOutput,
	run: (input) =>
		Effect.gen(function* () {
			const read = mediaNormalizedRecordReader();
			let offset = input.offset;
			let itemIndex = input.itemIndex;
			let dedupKey = input.dedupKey;
			let done = false;
			const entityGroups: MediaImportBatchEntityGroup[] = [];
			const failures: MediaImportFailure[] = [];
			let bytes = 0;
			let operations = 0;
			for (let count = 0; count < 25; count++) {
				const next = yield* read("records", offset);
				if (!next) {
					done = true;
					break;
				}
				const record = next.record;
				const size = new TextEncoder().encode(
					yield* Schema.encodeEffect(Schema.fromJsonString(MediaSourceRecord))(record),
				).length;
				const cost = record.group
					? 3 + record.group.events.length + record.group.collectionMemberships.length
					: 1;
				if (count && bytes + size > 512 * 1024) {
					break;
				}
				if (operations + cost > 900) {
					break;
				}
				offset = next.next;
				bytes += size;
				operations += cost;
				if (record.dedupKey && record.dedupKey === dedupKey) {
					continue;
				}
				dedupKey = record.dedupKey ?? null;
				if (record.failure) {
					failures.push(record.failure);
				}
				if (record.group) {
					if (
						new TextEncoder().encode(importEntityRefIdentifier(record.group.entityRef)).length >
							1024 ||
						record.group.events.some(
							(event) => new TextEncoder().encode(event.operationId).length > 512,
						)
					) {
						failures.push({
							itemIndex: record.itemIndex,
							stage: "input_transformation",
							operationId: record.operationId,
							sourceLabel: record.group.entityRef.sourceLabel,
							sourceIdentifier: importEntityRefIdentifier(record.group.entityRef),
							message: "Media source identity exceeds its bounded application descriptor",
						});
						continue;
					}
					const previous = entityGroups.at(-1);
					const sameEntity =
						previous &&
						importEntityRefKey(previous.entityRef) === importEntityRefKey(record.group.entityRef);
					if (sameEntity && previous.events.length + record.group.events.length <= 6) {
						entityGroups[entityGroups.length - 1] = {
							...previous,
							events: [...previous.events, ...record.group.events],
							collectionMemberships: [
								...new Map(
									[...previous.collectionMemberships, ...record.group.collectionMemberships].map(
										(membership) => [membership.collectionName, membership],
									),
								).values(),
							],
						};
					} else {
						entityGroups.push({ ...record.group, itemIndex: itemIndex++ });
					}
				}
			}
			const batch = { failures, entityGroups, totalItems: entityGroups.length + failures.length };
			const result = yield* writeMediaCapture([
				{
					name: "batch.json",
					contents: yield* Schema.encodeEffect(Schema.fromJsonString(MediaImportAdapterBatch))(
						batch,
					),
				},
			]);
			return {
				...result,
				done,
				offset,
				dedupKey,
				itemIndex,
				batch: {
					...batch,
					failures: [],
					entityGroups: entityGroups.map((group) =>
						Object.assign(group, {
							collectionMemberships: [],
							entityRef: {
								...group.entityRef,
								sourceLabel: group.entityRef.sourceLabel.slice(0, 512),
							},
							events: group.events.map((event) => ({
								...event,
								properties: {},
								...(event.attribution
									? {
											attribution: {
												sourceLabel: null,
												sourceIdentifier: null,
												recordId: event.attribution.recordId,
											},
										}
									: {}),
							})),
						}),
					),
				},
			};
		}),
});
