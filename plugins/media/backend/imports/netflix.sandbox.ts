import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import {
	collectMediaCsv,
	compareMediaRecords,
	mediaRecordReader,
	normalizeMediaRecords,
	serializeMediaRecords,
	sourceOutput,
	WINDOW_BYTES,
	writeMediaCapture,
} from "./collection";
import { MediaSourceInput, MediaSourceOutput, type MediaSourceRecord } from "./collection-schemas";
import { adaptNetflixCsv, netflixViewingContext } from "./netflix";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.netflix",
	name: "Collect Netflix export",
	capabilities: ["artifact-read", "scratch"],
});
const TitleContext = Schema.Struct({
	title: Schema.String,
	preferred: Schema.Literals(["movie", "show"]),
});
const State = Schema.Struct({
	key: Schema.String,
	preferred: Schema.Literals(["movie", "show", ""]),
});
export default defineScript({
	manifest,
	input: MediaSourceInput,
	output: MediaSourceOutput,
	run: (input) =>
		Effect.gen(function* () {
			if (input.action !== "normalize") {
				const file = input.entry?.name.split(/[\\/]/).pop() ?? "";
				const profileName =
					typeof input.settings["profileName"] === "string"
						? input.settings["profileName"]
						: undefined;
				return yield* collectMediaCsv(
					"netflix",
					input,
					() => ({ failures: [], entityGroups: [] }),
					"uploadToken",
					(text, itemIndex) => {
						const records = normalizeMediaRecords(
							adaptNetflixCsv({ text, file, profileName, importedAt: input.importedAt }),
							itemIndex,
							"netflix",
						);
						const context =
							file === "ViewingActivity.csv" ? netflixViewingContext({ text, profileName }) : null;
						if (context) {
							records.push({
								itemIndex,
								raw: context,
								eventIndex: 0,
								section: "netflix-context",
								key: JSON.stringify(["netflix-title", context.title]),
							});
						}
						return records.sort(compareMediaRecords);
					},
				);
			}
			const read = mediaRecordReader();
			let offset = input.offset;
			let itemIndex = input.itemIndex;
			let done = false;
			let state: typeof State.Type = input.header
				? yield* Schema.decodeEffect(Schema.fromJsonString(State))(input.header)
				: { key: "", preferred: "" };
			const records: MediaSourceRecord[] = [];
			let bytes = 0;
			for (let count = 0; count < 100; count++) {
				const next = yield* read("records", offset);
				if (!next) {
					done = true;
					break;
				}
				offset = next.next;
				itemIndex++;
				const record = next.record;
				if (record.key !== state.key) {
					state = { preferred: "", key: record.key };
				}
				if (record.section === "netflix-context") {
					const context = yield* Schema.decodeUnknownEffect(TitleContext)(record.raw);
					state = { key: record.key, preferred: context.preferred };
					continue;
				}
				const group = record.group;
				const normalized =
					group?.entityRef.kind === "unresolved" &&
					group.events.some(
						(event) => event.eventSchemaSlug === "review" || event.eventSchemaSlug === "backlog",
					) &&
					state.preferred
						? {
								...record,
								group: {
									...group,
									entityRef: { ...group.entityRef, entitySchemaSlug: state.preferred },
								},
							}
						: record;
				records.push(normalized);
				bytes += new TextEncoder().encode(serializeMediaRecords([normalized])).length;
				if (bytes >= WINDOW_BYTES) {
					break;
				}
			}
			return yield* sourceOutput({
				...(yield* writeMediaCapture([
					{
						name: "records.jsonl",
						contents: serializeMediaRecords(records.sort(compareMediaRecords)),
					},
				])),
				done,
				offset,
				itemIndex,
				header: yield* Schema.encodeEffect(Schema.fromJsonString(State))(state),
			});
		}),
});
