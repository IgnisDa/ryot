import { Effect, FileSystem } from "effect";

export const loadAssistantSdkReference = Effect.gen(function* () {
	if (import.meta.url.endsWith(".ts")) {
		const { generateClientSdkReference } = yield* Effect.promise(
			() => import("@ryot-app/plugin-client-compiler/sdk-reference"),
		);
		return yield* generateClientSdkReference();
	}
	const fs = yield* FileSystem.FileSystem;
	return yield* fs.readFileString(
		Bun.fileURLToPath(new URL("./assistant-sdk-reference.md", import.meta.url)),
	);
});
