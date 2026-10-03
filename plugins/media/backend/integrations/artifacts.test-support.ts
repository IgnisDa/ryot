import type { ExecutionMetadata } from "@ryot-app/sandbox-sdk/core";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import type { SandboxScratchManifest } from "@ryot-app/sandbox-sdk/filesystem";

import type { MediaSourceRecord } from "../imports/collection-schemas";
import { mediaFilesystem } from "../imports/ingestion.test-support";
import type { MediaImportFailure, MediaIntegrationAdapterResult } from "../imports/schemas";

export const runIntegrationTestScript = <
	Input extends Schema.Codec<unknown, unknown>,
	Host,
	Failure,
>(
	script: {
		readonly input: Input;
		readonly output: Schema.ConstraintDecoder<SandboxScratchManifest>;
		readonly run: (
			input: Input["Type"],
			host: Host,
			execution: ExecutionMetadata,
		) => Effect.Effect<SandboxScratchManifest, Failure>;
	},
	input: Schema.Codec.Encoded<Input>,
	host: NoInfer<Host>,
	execution: ExecutionMetadata,
) =>
	Effect.gen(function* () {
		const fs = mediaFilesystem({});
		const records: MediaSourceRecord[] = [];
		let value: unknown = input;
		for (;;) {
			const output = yield* script
				.run(yield* Schema.decodeUnknownEffect(script.input)(value), host, execution)
				.pipe(Effect.flatMap(Schema.decodeUnknownEffect(script.output)));
			records.push(...(yield* fs.records()));
			if (!("carryFile" in output) || typeof output.carryFile !== "string") {
				break;
			}
			const carry = fs.scratch.get(output.carryFile);
			if (!carry) {
				throw new Error("Missing integration test carry");
			}
			fs.files.set("carry", carry);
			value = {
				...(yield* Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown))(input)),
				ingestionArtifacts: { runId: "run", captures: { carry: "carry" } },
			};
		}
		return integrationTestResult(records);
	});

export const integrationTestResult = (
	records: readonly MediaSourceRecord[],
): Omit<MediaIntegrationAdapterResult, "failures"> & {
	readonly failures: readonly MediaImportFailure[];
} => {
	const groups = new Map<string, MediaIntegrationAdapterResult["entityGroups"][number]>();
	for (const { group } of records) {
		if (!group) {
			continue;
		}
		const key = JSON.stringify([group.itemIndex, group.entityRef, group.ownershipProvider]);
		const previous = groups.get(key);
		groups.set(key, {
			...group,
			collectionMemberships: [
				...(previous?.collectionMemberships ?? []),
				...group.collectionMemberships,
			],
			events: [
				...(previous?.events ?? []),
				...group.events.map(
					({
						attribution: _attribution,
						operationId: _operationId,
						sourceItemIndex: _sourceItemIndex,
						...event
					}) => event,
				),
			],
		});
	}
	return {
		failures: records.flatMap(({ failure }) => (failure ? [failure] : [])),
		entityGroups: [...groups.values()].sort((left, right) => left.itemIndex - right.itemIndex),
	};
};
