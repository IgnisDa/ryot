import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { readNamedArtifact } from "@ryot-app/sandbox-sdk/filesystem";

const decoder = new TextDecoder();

export const readImportArtifactText = () =>
	readNamedArtifact("uploadToken").pipe(Effect.map(decoder.decode.bind(decoder)));

export const readNamedImportArtifactText = (key: string) =>
	readNamedArtifact(key).pipe(Effect.map(decoder.decode.bind(decoder)));
