#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { makeSandboxCompilerSupervisor } from "@ryot-app/plugin-backend-compiler/supervisor";
import { SANDBOX_COMPILER_WARM_UP_SOURCE } from "@ryot-app/plugin-backend-compiler/warm-up";
import { makeClientCompilerSupervisor } from "@ryot-app/plugin-client-compiler/supervisor";
import { CLIENT_COMPILER_WARM_UP_INPUT } from "@ryot-app/plugin-client-compiler/warm-up";
import { Effect, Path } from "effect";

const packagedWorkerPath = (specifier: string, file: string) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		return import.meta.url.endsWith(".ts")
			? Bun.resolveSync(specifier, import.meta.dir)
			: path.join(import.meta.dir, file);
	});

const program = Effect.gen(function* () {
	const client = yield* makeClientCompilerSupervisor({
		verifyEnvironment: true,
		workerPath:
			process.argv[2] ??
			(yield* packagedWorkerPath(
				"@ryot-app/plugin-client-compiler/worker",
				"plugin-client-compiler-worker.js",
			)),
	});
	const artifact = yield* client.compile(CLIENT_COMPILER_WARM_UP_INPUT);
	const text = (name: string) =>
		new TextDecoder().decode(artifact.files.find((file) => file.name === name)?.contents);
	const svg = artifact.files.find(({ name }) => name.endsWith(".svg"));
	if (
		!svg ||
		!text("module.js").includes(svg.name) ||
		!text("module.css").includes(".bg-accent") ||
		!text("module.css").includes(".warm-up-logo")
	) {
		return yield* Effect.die(
			new Error("Client compiler emitted an incomplete page artifact graph"),
		);
	}
	yield* Effect.log("Client compiler worker smoke passed");

	const backend = yield* makeSandboxCompilerSupervisor({
		verifyEnvironment: true,
		workerPath: yield* packagedWorkerPath(
			"@ryot-app/plugin-backend-compiler/worker",
			"plugin-backend-compiler-worker.js",
		),
	});
	const compiled = yield* backend.compile(SANDBOX_COMPILER_WARM_UP_SOURCE);
	if (
		compiled.manifest.kind !== "script" ||
		!compiled.manifest.capabilities.includes("invokeCapability") ||
		compiled.javascript.length === 0
	) {
		return yield* Effect.die(new Error("Backend compiler emitted incomplete agent metadata"));
	}
	return yield* Effect.log("Backend compiler worker smoke passed");
});

BunRuntime.runMain(Effect.scoped(program).pipe(Effect.provide(BunServices.layer)));
