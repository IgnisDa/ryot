import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import {
	genericImportAdapterManifestSchema,
	type GenericImportWriteItem,
} from "@ryot/sandbox-sdk/imports";

import { adaptOpenScaleCsv } from "../../import-adapters/open-scale";
import { readImportArtifactText, writeImportChunks } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.open-scale",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Parse OpenScale import",
	capabilities: ["artifact-read", "scratch"],
});

export default defineScript({
	manifest,
	input: Schema.Struct({}),
	output: genericImportAdapterManifestSchema,
	run: () =>
		Effect.gen(function* () {
			const text = yield* readImportArtifactText();
			const result = adaptOpenScaleCsv(text);
			const items: GenericImportWriteItem[] = result.items.map((item) => ({
				events: [],
				relationships: [],
				itemIndex: item.itemIndex,
				sourceLabel: item.sourceLabel,
				subjectEntityAlias: "measurement",
				sourceIdentifier: item.sourceIdentifier,
				entities: [
					{
						alias: "measurement",
						entitySchemaSlug: "measurement",
						name: `Measurement - ${item.sourceLabel}`,
						properties: {
							recordedAt: item.properties.recordedAt,
							statistics: item.properties.statistics,
							...(item.properties.comment !== undefined
								? { comment: item.properties.comment }
								: {}),
						},
					},
				],
			}));
			return yield* writeImportChunks(result.failures, items);
		}),
});
