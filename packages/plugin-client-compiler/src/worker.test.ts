import { expect } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import { CLIENT_API_VERSION } from "@ryot-app/plugin-client-contract";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, FileSystem, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { decodeClientCompilerWorkerResponse, encodeClientCompilerWorkerRequest } from "./protocol";

const runWorker = Effect.fn(function* (input: string) {
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const worker = yield* spawner.spawn(
		ChildProcess.make(
			process.execPath,
			["--no-install", new URL("./worker.ts", import.meta.url).pathname],
			{ stdout: "pipe", stderr: "inherit", stdin: Stream.succeed(new TextEncoder().encode(input)) },
		),
	);
	const output = yield* worker.stdout.pipe(
		Stream.decodeText(),
		Stream.runFold(
			() => "",
			(text, chunk) => text + chunk,
		),
	);
	expect(Number(yield* worker.exitCode)).toBe(0);
	return yield* decodeClientCompilerWorkerResponse(output);
});

it.layer(BunServices.layer)("client compiler worker", (test) => {
	test.effect(
		"returns diagnostics for malformed requests",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const response = yield* runWorker("{}");
					expect(response.success).toBe(false);
					if (!response.success) {
						expect(response.error.diagnostics[0]?.code).toBe("RYOT_CLIENT_COMPILER_PROCESS");
					}
				}),
			),
		testTimeout,
	);
	test.effect(
		"compiles page source bytes and releases the workspace",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const workspaceParentPath = yield* fs.makeTempDirectoryScoped({
						directory: import.meta.dir,
						prefix: "ryot-worker-test-",
					});
					const input = yield* encodeClientCompilerWorkerRequest({
						workspaceParentPath,
						workspaceJobId: "page",
						input: {
							kind: "page",
							name: "Worker page",
							apiVersion: CLIENT_API_VERSION,
							pageDeclarationHash: "declaration",
							publicExports: { page: { kind: "page", entry: "client/page.tsx" } },
							files: {
								"client/page.tsx": new TextEncoder().encode(
									'export default function Page() { return <p className="bg-accent">Page</p>; }',
								),
							},
						},
					});
					const response = yield* runWorker(input);
					expect(response.success).toBe(true);
					if (response.success) {
						expect(response.value.artifact.files.map(({ name }) => name)).toContain("module.js");
						expect(response.value.artifact.files.map(({ name }) => name)).toContain("module.css");
						expect("kind" in response.value.artifact && response.value.artifact.kind).toBe("page");
					}
					expect(yield* fs.exists(`${workspaceParentPath}/page`)).toBe(false);
				}),
			),
		testTimeout,
	);
});
