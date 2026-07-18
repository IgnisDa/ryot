#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import dotenv from "dotenv";
import { Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";

import { assemble, readShippedSlugs } from "./assemble";

dotenv.config();

type ProcessCommand = readonly [string, ...string[]];

const repositoryRoot = Bun.fileURLToPath(new URL("../../..", import.meta.url));
const serverRoot = `${repositoryRoot}/apps/server`;

const pluginRoot = (slug: string) => `${repositoryRoot}/plugins/${slug}`;

const rendererSourceRoot = `${repositoryRoot}/packages/kernel-renderers/src`;

const sandboxRuntimeGenerator = `${repositoryRoot}/kernel/backend/scripts/generate-sandbox-runtime.ts`;

const runCommand = ([executable, ...args]: ProcessCommand, cwd?: string) =>
	ChildProcess.make(executable, args, {
		cwd,
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

const buildPlugin = (slug: string, ...flags: readonly string[]): ProcessCommand => [
	process.execPath,
	"run",
	"--cwd",
	pluginRoot(slug),
	"build",
	...flags,
];

const failWith = (exitCode: number) =>
	Effect.sync(() => {
		process.exitCode = exitCode;
	});

const program = Effect.gen(function* () {
	const path = yield* Path.Path;
	const slugs = yield* readShippedSlugs;
	const fs = yield* FileSystem.FileSystem;

	const generated = yield* runCommand(
		turboBuild("@ryot-app/kernel-backend", "@ryot-app/kernel-renderers"),
	);
	if (generated !== 0) {
		yield* failWith(generated);
		return;
	}
	const built = yield* Effect.forEach(slugs, (slug) => runCommand(buildPlugin(slug)), {
		concurrency: "unbounded",
	});
	const failedBuild = built.find((exitCode) => exitCode !== 0);
	if (failedBuild !== undefined) {
		yield* failWith(failedBuild);
		return;
	}
	yield* assemble;

	const archiveAssembled = Stream.mergeAll(
		slugs.map((slug) =>
			fs
				.watch(path.join(pluginRoot(slug), "dist"))
				.pipe(Stream.filter((event) => path.basename(event.path) === `${slug}.zip`)),
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
				runCommand([process.execPath, "run", "--watch", "src/main.ts"], serverRoot).pipe(
					Effect.map((exitCode) => ({ exitCode, restart: false as const })),
				),
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
		watchRenderers.pipe(Effect.as(0)),
		...slugs.map((slug) => runCommand(buildPlugin(slug, "--watch", "--skip-initial"))),
		runServer,
	]);
	yield* failWith(exitCode);
});

BunRuntime.runMain(program.pipe(Effect.provide(BunServices.layer)));
