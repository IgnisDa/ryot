import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import {
	configureSandboxFilesystem,
	type SandboxFilesystemBinding,
} from "@ryot-app/sandbox-sdk/filesystem";

import { MediaSourceRecord, type MediaSourceInput } from "./collection-schemas";

let filesystemBinding: SandboxFilesystemBinding | undefined;
configureSandboxFilesystem(() => filesystemBinding);

export const resetMediaFilesystem = () => {
	filesystemBinding = undefined;
};
export const mediaImportTestCommand = (integrationId?: string) =>
	Schema.decodeSync(LifecycleCommand)({
		itemIdentity: "run",
		occurredAt: "2026-01-01T00:00:00.000Z",
		accountGeneration: { userId: "user", token: "generation" },
		causation: {
			depth: 0,
			parentRunId: null,
			importRunId: "run",
			parentTriggerId: null,
			executionId: "execution",
			rootExecutionId: "execution",
			...(integrationId
				? {
						integrationId,
						source: "integration",
						initiator: { id: integrationId, kind: "integration" },
					}
				: { source: "import", initiator: { id: "user", kind: "user" } }),
		},
	});
export const mediaStageInput = (fields: Partial<MediaSourceInput> = {}): MediaSourceInput => ({
	offset: 0,
	header: "",
	fileIndex: 0,
	itemIndex: 0,
	settings: {},
	action: "collect",
	importedAt: "2026-01-01T00:00:00.000Z",
	...fields,
});
export const mediaFilesystem = (sources: Record<string, Uint8Array>) => {
	const files = new Map(Object.entries(sources));
	const scratch = new Map<string, Uint8Array>();
	const reads: Array<{ key: string; offset: number; length: number }> = [];
	filesystemBinding = {
		readArtifact: () => Promise.reject(new Error("Whole artifact reads are forbidden")),
		readNamedArtifact: () => Promise.reject(new Error("Whole named artifact reads are forbidden")),
		writeScratchChunks: (chunks: ReadonlyArray<{ name: string; contents: Uint8Array }>) => {
			if (chunks.reduce((sum, chunk) => sum + chunk.contents.length, 0) > 5 * 1024 * 1024) {
				return Promise.reject(new Error("Scratch limit exceeded"));
			}
			for (const chunk of chunks) {
				scratch.set(chunk.name, chunk.contents.slice());
			}
			return Promise.resolve();
		},
		readArtifactRange: (offset: number, length: number, key = "") => {
			if (length < 1 || length > 1024 * 1024) {
				return Promise.reject(new Error("Invalid bounded range"));
			}
			const bytes = files.get(key);
			if (!bytes) {
				return Promise.reject(new Error(`Missing artifact ${key}`));
			}
			reads.push({ key, offset, length });
			return Promise.resolve({ size: bytes.length, bytes: bytes.slice(offset, offset + length) });
		},
	};
	const records = Effect.fn(function* () {
		const text = new TextDecoder().decode(scratch.get("records.jsonl"));
		return yield* Effect.forEach(text.split("\n").filter(Boolean), (line) =>
			Schema.decodeEffect(Schema.fromJsonString(MediaSourceRecord))(line),
		);
	});
	return { files, reads, scratch, records };
};
