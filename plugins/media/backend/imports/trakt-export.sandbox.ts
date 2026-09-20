import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import {
	collectMediaJson,
	compareMediaRecords,
	mediaRecordReader,
	normalizeMediaRecords,
	readMediaCapture,
	serializeMediaRecords,
	sourceOutput,
	writeMediaCapture,
} from "./collection";
import { MediaSourceInput, MediaSourceOutput } from "./collection-schemas";
import { adaptTraktExport } from "./trakt";
import { classifyTraktExportName } from "./trakt-files";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.trakt-export",
	name: "Collect Trakt export",
});
const encoder = new TextEncoder();
const ListMetadata = Schema.Array(
	Schema.Struct({
		name: Schema.String,
		ids: Schema.Struct({ trakt: Schema.optional(Schema.Finite) }),
	}),
);
export default defineScript({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) =>
		Effect.gen(function* () {
			if (input.action !== "normalize") {
				return yield* collectMediaJson(
					"trakt",
					input,
					() => ({ failures: [], entityGroups: [] }),
					"exportUploadToken",
					(row, itemIndex) => [
						{
							raw: row,
							itemIndex,
							eventIndex: 0,
							section: input.entry?.name ?? "",
							key:
								classifyTraktExportName(input.entry?.name ?? "")?.kind.type === "list-metadata"
									? "!metadata"
									: String(itemIndex).padStart(16, "0"),
						},
					],
				);
			}
			const read = mediaRecordReader();
			let offset = input.offset;
			let done = false;
			let itemIndex = input.itemIndex;
			const metadata: unknown[] = input.ingestionArtifacts?.captures["carry"]
				? [
						...(yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Schema.Unknown)))(
							new TextDecoder().decode(yield* readMediaCapture("carry")),
						)),
					]
				: [];
			const records = [];
			for (let count = 0; count < 20; count++) {
				const next = yield* read("records", offset);
				if (!next) {
					done = true;
					break;
				}
				offset = next.next;
				itemIndex++;
				const record = next.record;
				if (!record.section) {
					throw new Error("Trakt captured record is missing its source file");
				}
				if (classifyTraktExportName(record.section)?.kind.type === "list-metadata") {
					metadata.push(record.raw);
					continue;
				}
				const archive = {
					"lists-lists.json": encoder.encode(
						yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Schema.Unknown)))(
							metadata,
						),
					),
					[record.section]: encoder.encode(
						yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Schema.Unknown)))([
							record.raw,
						]),
					),
				};
				records.push(
					...normalizeMediaRecords(adaptTraktExport(archive), record.itemIndex, "trakt"),
				);
			}
			yield* Schema.decodeUnknownEffect(ListMetadata)(metadata);
			const carry = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Schema.Unknown)))(
				metadata,
			);
			return yield* sourceOutput({
				...(yield* writeMediaCapture([
					{
						name: "records.jsonl",
						contents: serializeMediaRecords(records.sort(compareMediaRecords)),
					},
					{ contents: carry, name: "metadata.json" },
				])),
				done,
				offset,
				itemIndex,
				carryFile: "metadata.json",
			});
		}),
});
