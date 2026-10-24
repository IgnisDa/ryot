import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import {
	collectMediaJson,
	compareMediaRecords,
	mediaRawRecordReader,
	normalizeMediaRecords,
	readMediaCapture,
	serializeMediaRecords,
	sourceOutput,
	writeMediaCapture,
} from "./collection";
import { MediaSourceInput, MediaSourceOutput, type MediaSourceRecord } from "./collection-schemas";
import { normalizeTraktRecord, type TraktRecordContext } from "./trakt";
import { classifyTraktExportName } from "./trakt-files";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.trakt-export",
	name: "Collect Trakt export",
});
const ListMetadata = Schema.Struct({
	name: Schema.String,
	ids: Schema.Struct({ trakt: Schema.optional(Schema.Finite) }),
});
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
			const read = mediaRawRecordReader();
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
			const lists = new Map<number, string>();
			const rememberList = (list: typeof ListMetadata.Type) => {
				if (list.ids.trakt !== undefined) {
					lists.set(list.ids.trakt, list.name);
				}
			};
			for (const list of yield* Schema.decodeUnknownEffect(Schema.Array(ListMetadata))(metadata)) {
				rememberList(list);
			}
			const records: MediaSourceRecord[] = [];
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
				const entry = classifyTraktExportName(record.section);
				if (!entry) {
					throw new Error(`Unrecognized Trakt captured source file: ${record.section}`);
				}
				if (entry.kind.type === "list-metadata") {
					const list = yield* Schema.decodeUnknownEffect(ListMetadata)(record.raw);
					metadata.push(record.raw);
					rememberList(list);
					continue;
				}
				let context: TraktRecordContext;
				if (entry.kind.type === "collection") {
					context = { name: "Owned", type: "collection" };
				} else if (entry.kind.type === "system-list") {
					context = {
						type: "collection",
						name: entry.name.includes("watchlist") ? "Watchlist" : "Favorites",
					};
				} else if (entry.kind.type === "custom-list") {
					context = {
						type: "collection",
						name: lists.get(entry.kind.id) ?? `Trakt List ${entry.kind.id}`,
					};
				} else {
					context = { type: entry.kind.type };
				}
				records.push(
					...normalizeMediaRecords(
						normalizeTraktRecord(record.raw, context),
						record.itemIndex,
						"trakt",
					),
				);
			}
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
