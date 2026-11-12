import { generateClientSdkReference } from "@ryot-app/plugin-client-compiler/sdk-reference";
import { Effect, FileSystem } from "effect";

export const buildAssistantSdkReference = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const reference = yield* generateClientSdkReference();
	const output = Bun.fileURLToPath(new URL("../dist", import.meta.url));
	yield* fs.makeDirectory(output, { recursive: true });
	yield* fs.writeFileString(`${output}/assistant-sdk-reference.md`, reference);
});
