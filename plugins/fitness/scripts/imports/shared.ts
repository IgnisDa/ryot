import { Effect } from "@ryot/sandbox-sdk/effect";
import { readArtifact, writeScratchChunks } from "@ryot/sandbox-sdk/filesystem";
import type {
	GenericImportChunk,
	GenericImportFailure,
	GenericImportWriteItem,
} from "@ryot/sandbox-sdk/imports";

const decoder = new TextDecoder();
const CHUNK_SIZE = 50;

export const readImportArtifactText = () =>
	readArtifact().pipe(Effect.map(decoder.decode.bind(decoder)));

export const writeImportChunks = (
	failures: ReadonlyArray<GenericImportFailure>,
	items: ReadonlyArray<GenericImportWriteItem>,
) => {
	const chunks: Array<{ name: string; contents: string }> = [];
	for (let index = 0; index < failures.length; index += CHUNK_SIZE) {
		const chunk = {
			items: [],
			failures: failures.slice(index, index + CHUNK_SIZE),
		} satisfies GenericImportChunk;
		chunks.push({ name: `failures-${index / CHUNK_SIZE}.json`, contents: JSON.stringify(chunk) });
	}
	for (let index = 0; index < items.length; index += CHUNK_SIZE) {
		const chunk = {
			failures: [],
			items: items.slice(index, index + CHUNK_SIZE),
		} satisfies GenericImportChunk;
		chunks.push({ name: `writes-${index / CHUNK_SIZE}.json`, contents: JSON.stringify(chunk) });
	}
	if (chunks.length === 0) {
		chunks.push({ name: "writes-0.json", contents: JSON.stringify({ failures: [], items: [] }) });
	}
	return writeScratchChunks(chunks).pipe(
		Effect.map(({ chunkFiles }) => ({
			chunkFiles,
			writeItemCount: items.length,
			failureCount: failures.length,
			totalItems: failures.length + items.length,
		})),
	);
};
