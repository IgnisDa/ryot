#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { pluginClientCompilerPlatformLayer } from "@ryot-app/plugin-client-compiler";
import dotenv from "dotenv";
import { Effect, FileSystem, Layer, Path, Stream } from "effect";
import { ChildProcess } from "effect/process";

import { assemble } from "./tooling/assemble";
import { readShippedPlugins } from "./tooling/shipped-plugins";
import { resolveVersion } from "./tooling/version";

dotenv.config();

type ProcessCommand = readonly [string, ...string[]];

const repositoryRoot = Bun.fileURLToPath(new URL("../..", import.meta.url));
const serverRoot = `${repositoryRoot}/apps/server`;

const rendererSourceRoot = `${repositoryRoot}/packages/kernel-renderers/src`;

const sandboxRuntimeGenerator = `${repositoryRoot}/kernel/sandbox/tooling/runtime.ts`;
const kernelScriptsGenerator = `${repositoryRoot}/kernel/backend/tooling/kernel-scripts.ts`;

const runCommand = (
	[executable, ...args]: ProcessCommand,
	cwd?: string,
	env?: Record<string, string>,
) =>
	ChildProcess.make(executable, args, {
		cwd,
		env,
		extendEnv: true,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	}).pipe(
		Effect.flatMap((process) => process.exitCode),
		Effect.scoped,
	);

const turboBuild = (...packages: readonly string[]): ProcessCommand => [
	process.execPath,
	"turbo",
	...packages.map((name) => `--filter=${name}`),
	"build",
];

const buildPlugin = (root: string, ...flags: readonly string[]): ProcessCommand => [
	process.execPath,
	"run",
	"--cwd",
	root,
	"build",
	...flags,
];

const failWith = (exitCode: number) =>
	Effect.sync(() => {
		process.exitCode = exitCode;
	});

const program = Effect.gen(function* () {
	const path = yield* Path.Path;
	const plugins = yield* readShippedPlugins;
	const fs = yield* FileSystem.FileSystem;
	const version = yield* resolveVersion;

	yield* assemble;

	const archiveAssembled = Stream.mergeAll(
		plugins.map(({ root }) =>
			fs
				.watch(path.join(root, "dist"), { recursive: true })
				.pipe(Stream.filter((event) => path.basename(event.path).endsWith(".zip"))),
		),
		{ concurrency: "unbounded" },
	).pipe(Stream.debounce("500 millis"), Stream.runHead, Effect.andThen(assemble));

	const watchRenderers = fs.watch(rendererSourceRoot, { recursive: true }).pipe(
		Stream.filter((event) => !event.path.endsWith(".generated.ts")),
		Stream.debounce("500 millis"),
		Stream.runForEach(() => runCommand(turboBuild("@ryot-app/kernel-renderers"))),
	);

	const runServer = Effect.gen(function* () {
		let restart = true;
		let outerExitCode = 0;
		while (restart) {
			const result = yield* Effect.raceFirst(
				runCommand([process.execPath, "run", "--watch", "src/main.ts"], serverRoot, {
					RYOT_VERSION: version,
				}).pipe(Effect.map((exitCode) => ({ exitCode, restart: false as const }))),
				archiveAssembled.pipe(Effect.as({ restart: true as const })),
			);
			restart = result.restart;
			if (!result.restart) {
				outerExitCode = result.exitCode;
			}
		}
		return outerExitCode;
	});

	const exitCode = yield* Effect.raceAllFirst([
		runCommand([process.execPath, "run", sandboxRuntimeGenerator, "--watch", "--skip-initial"]),
		runCommand([process.execPath, "run", kernelScriptsGenerator, "--watch", "--skip-initial"]),
		watchRenderers.pipe(Effect.as(0)),
		...plugins.map(({ root }) => runCommand(buildPlugin(root, "--watch", "--skip-initial"))),
		runServer,
	]);
	yield* failWith(exitCode);
});

BunRuntime.runMain(
	// oxlint-disable-next-line effecttsgo/strict-effect-provide -- The development supervisor is a command-line entrypoint
	program.pipe(Effect.provide(Layer.merge(BunServices.layer, pluginClientCompilerPlatformLayer))),
);
