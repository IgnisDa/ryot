import { BunServices } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const runtimeBuildPaths = [
	".dockerignore",
	".github",
	"Dockerfile",
	"apps",
	"ci",
	"e2e",
	"kernel",
	"package.json",
	"packages",
	"plugins",
	"turbo.json",
];

const allowedPaths = [
	/^kernel\/sandboxd\//,
	/^kernel\/backend\/src\/lib\/infrastructure\/sandbox-runtime\/deno-removal\.test\.ts$/,
];

const executableDependency =
	/\bdeno\s+(run|cache|compile|install|eval|check)\b|\bDENO_(DIR|VERSION|INSTALL)\b|\bSANDBOX_DENO\w*|\bdenoDir\b|\bdenoVersion\b|\bdenoHeapMiB\b|\bdeno\.json\b|denoland\/deno\/releases|\bDeno\.(Command|run|env|readFile|writeFile|open)\b|\.deno\/bin/;

layer(BunServices.layer)((test) =>
	test.effect("runtime_build_has_no_deno_executable_dependency", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const root = path.resolve(
				yield* path.fromFileUrl(new URL(".", import.meta.url)),
				"../../../../../..",
			);
			const listed = yield* spawner.string(
				ChildProcess.make(
					"git",
					["ls-files", "--cached", "--others", "--exclude-standard", "--", ...runtimeBuildPaths],
					{ cwd: root },
				),
			);
			const files = listed
				.split("\n")
				.filter((file) => file !== "" && !allowedPaths.some((pattern) => pattern.test(file)));
			expect(files).toContain("Dockerfile");
			const offenders: string[] = [];
			for (const file of files) {
				const bytes = yield* fs
					.readFile(path.join(root, file))
					.pipe(Effect.orElseSucceed(() => null));
				if (
					bytes !== null &&
					!bytes.includes(0) &&
					executableDependency.test(new TextDecoder().decode(bytes))
				) {
					offenders.push(file);
				}
			}
			expect(offenders).toEqual([]);
		}),
	),
);
