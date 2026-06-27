import { Effect } from "@ryot/sandbox-sdk/effect";
import { readArtifact, readNamedArtifact } from "@ryot/sandbox-sdk/filesystem";

const decoder = new TextDecoder();

export const readImportArtifactText = () =>
	readArtifact().pipe(Effect.map(decoder.decode.bind(decoder)));

export const readNamedImportArtifactText = (key: string) =>
	readNamedArtifact(key).pipe(Effect.map(decoder.decode.bind(decoder)));
