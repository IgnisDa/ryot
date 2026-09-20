import { DateTime, Effect } from "@ryot-app/sandbox-sdk/effect";
import type { SandboxScratchManifest } from "@ryot-app/sandbox-sdk/filesystem";

import {
	normalizeMediaRecords,
	serializeMediaRecords,
	writeMediaCapture,
} from "../imports/collection";
import type { MediaIntegrationAdapterResult } from "../imports/schemas";

export const captureIntegrationRecords = Effect.fn(function* (
	source: string,
	result: MediaIntegrationAdapterResult | SandboxScratchManifest,
) {
	if ("chunkFiles" in result) {
		return result;
	}
	const records = normalizeMediaRecords(result, 0, source);
	if (!records.length) {
		return { chunkFiles: [], advancedAt: DateTime.formatIso(yield* DateTime.now) };
	}
	return {
		...(result.sourceFailure ? { sourceFailure: result.sourceFailure } : {}),
		...(yield* writeMediaCapture([
			{ name: "records.jsonl", contents: serializeMediaRecords(records) },
		])),
		advancedAt: DateTime.formatIso(yield* DateTime.now),
	};
});
export const captureIntegrationWindow = Effect.fn(function* (
	source: string,
	result: MediaIntegrationAdapterResult,
	carry: string | null,
	eventIndexBase = 0,
) {
	const chunks = [
		{
			name: "records.jsonl",
			contents: serializeMediaRecords(normalizeMediaRecords(result, 0, source, eventIndexBase)),
		},
	];
	if (carry !== null) {
		chunks.push({ contents: carry, name: "carry.json" });
	}
	return {
		...(yield* writeMediaCapture(chunks)),
		carryFile: carry === null ? null : "carry.json",
		advancedAt: DateTime.formatIso(yield* DateTime.now),
	};
});
