import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { readNamedArtifact, writeScratchChunks } from "@ryot-app/sandbox-sdk/filesystem";
import type {
	GenericImportChunk,
	GenericImportFailure,
	GenericImportWriteItem,
} from "@ryot-app/sandbox-sdk/imports";

const decoder = new TextDecoder();
const CHUNK_SIZE = 50;

export const readImportArtifactText = () =>
	readNamedArtifact("uploadToken").pipe(Effect.map(decoder.decode.bind(decoder)));

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
		chunks.push({ contents: JSON.stringify(chunk), name: `failures-${index / CHUNK_SIZE}.json` });
	}
	for (let index = 0; index < items.length; index += CHUNK_SIZE) {
		const chunk = {
			failures: [],
			items: items.slice(index, index + CHUNK_SIZE),
		} satisfies GenericImportChunk;
		chunks.push({ contents: JSON.stringify(chunk), name: `writes-${index / CHUNK_SIZE}.json` });
	}
	if (chunks.length === 0) {
		chunks.push({ name: "writes-0.json", contents: JSON.stringify({ items: [], failures: [] }) });
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
