import { generateClientSdkReference } from "@ryot-app/plugin-client-compiler/sdk-reference";
import { Effect, FileSystem, Schema } from "effect";

export const buildAgentDocs = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const topics = yield* generateClientSdkReference();
	const output = Bun.fileURLToPath(new URL("../dist", import.meta.url));
	yield* fs.makeDirectory(output, { recursive: true });
	yield* fs.writeFileString(
		`${output}/agent-docs.json`,
		yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(topics),
	);
});
