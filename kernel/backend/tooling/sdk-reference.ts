#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { generateClientSdkReference } from "@ryot-app/plugin-client-compiler/sdk-reference";
import { Effect, FileSystem, Path, Schema } from "effect";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const program = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const scriptPath = yield* path.fromFileUrl(new URL(import.meta.url));
	const topics = yield* generateClientSdkReference();
	yield* fs.writeFileString(
		path.resolve(path.dirname(scriptPath), "../src/modules/agent-tools/sdk-reference.generated.ts"),
		`export const sdkReferenceTopics: ReadonlyArray<{ readonly topic: string; readonly content: string }> = ${yield* encodeJson(topics)};\n`,
	);
	yield* Effect.logInfo("Generated page SDK reference topics");
});

BunRuntime.runMain(program.pipe(Effect.provide(BunServices.layer)));
