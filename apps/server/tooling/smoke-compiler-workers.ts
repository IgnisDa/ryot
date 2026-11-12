#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { SandboxScriptManifest } from "@ryot-app/contract/modules/scripts/schemas";
import {
	CompilerWorkerRequest,
	CompilerWorkerResponse,
} from "@ryot-app/plugin-backend-compiler/protocol";
import { PluginClientCompilerFailure } from "@ryot-app/plugin-client-compiler/diagnostics";
import {
	decodeClientCompilerWorkerResponse,
	encodeClientCompilerWorkerRequest,
} from "@ryot-app/plugin-client-compiler/protocol";
import { CLIENT_API_VERSION } from "@ryot-app/plugin-client-contract";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const program = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const workerPath =
		process.argv[2] ?? path.join(import.meta.dir, "plugin-client-compiler-worker.js");
	const workspaceParentPath = yield* fs.makeTempDirectoryScoped({
		prefix: "ryot-compiler-smoke-",
		directory: path.dirname(Bun.resolveSync("@ryot-app/plugin-client-compiler", import.meta.dir)),
	});
	const request = yield* encodeClientCompilerWorkerRequest({
		workspaceParentPath,
		workspaceJobId: "smoke",
		input: {
			kind: "page",
			name: "Compiler smoke",
			apiVersion: CLIENT_API_VERSION,
			pageDeclarationHash: "smoke-declaration",
			publicExports: { page: { kind: "page", entry: "client/index.tsx" } },
			files: Object.fromEntries(
				Object.entries({
					"client/styles.css": ".smoke-logo { display: block; }",
					"client/logo.svg": '<svg xmlns="http://www.w3.org/2000/svg" />',
					"client/index.tsx": `import "./styles.css";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { useState } from "react";
import logo from "./logo.svg";
export default function Page() {
 const [count, setCount] = useState(0);
 return <Button className="bg-accent" onClick={() => setCount(count + 1)}><img alt="" src={logo}/>{count}</Button>;
}`,
				}).map(([name, contents]) => [name, new TextEncoder().encode(contents)]),
			),
		},
	});
	const runWorker = Effect.fnUntraced(function* (filename: string, payload: string) {
		const worker = yield* spawner.spawn(
			ChildProcess.make(
				process.execPath,
				["--smol", "--no-orphans", "--no-install", "--no-env-file", filename],
				{
					stdout: "pipe",
					stderr: "inherit",
					stdin: Stream.succeed(new TextEncoder().encode(payload)),
				},
			),
		);
		const output = yield* worker.stdout.pipe(
			Stream.decodeText(),
			Stream.runFold(
				() => "",
				(text, chunk) => text + chunk,
			),
		);
		const exitCode = yield* worker.exitCode;
		if (Number(exitCode) !== 0) {
			return yield* Effect.die(new Error(`Compiler worker exited: ${exitCode}`));
		}
		return output;
	});
	const output = yield* runWorker(workerPath, request);
	const response = yield* decodeClientCompilerWorkerResponse(output);
	if (!response.success) {
		const error = yield* Schema.encodeEffect(Schema.fromJsonString(PluginClientCompilerFailure))(
			response.error,
		);
		return yield* Effect.die(new Error(error));
	}
	const artifact = response.value.artifact;
	const javascript = new TextDecoder().decode(
		artifact.files.find(({ name }) => name === "module.js")?.contents,
	);
	const css = new TextDecoder().decode(
		artifact.files.find(({ name }) => name === "module.css")?.contents,
	);
	const svg = artifact.files.find(({ name }) => name.endsWith(".svg"));
	if (
		!("kind" in artifact) ||
		!svg ||
		!javascript.includes(svg.name) ||
		!css.includes(".bg-accent") ||
		!css.includes(".smoke-logo")
	) {
		return yield* Effect.die(
			new Error("Client compiler emitted an incomplete page artifact graph"),
		);
	}
	if (yield* fs.exists(path.join(workspaceParentPath, "smoke"))) {
		return yield* Effect.die(new Error("Client compiler retained its workspace"));
	}
	yield* Effect.log("Client compiler worker smoke passed");
	const backendWorkerPath = import.meta.url.endsWith(".ts")
		? Bun.resolveSync("@ryot-app/plugin-backend-compiler/worker", import.meta.dir)
		: path.join(import.meta.dir, "plugin-backend-compiler-worker.js");
	const backendRequest = yield* Schema.encodeEffect(Schema.fromJsonString(CompilerWorkerRequest))({
		workspaceParentPath,
		workspaceJobId: "agent-smoke",
		source: `import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/agent";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";
export const manifest = defineManifest({ kind: "script", name: "Agent compiler smoke", slug: "agent-smoke" });
export default defineScript({ manifest, input: Schema.Struct({}), output: Schema.Unknown,
 run: (_input, host) => host.invokeOperation({ name: "testing.fixture.echo", arguments: {} }) });`,
	});
	const backendOutput = yield* runWorker(backendWorkerPath, backendRequest);
	const backendResponse = yield* Schema.decodeEffect(Schema.fromJsonString(CompilerWorkerResponse))(
		backendOutput,
	);
	if (!backendResponse.success) {
		return yield* Effect.die(new Error(backendResponse.error.message));
	}
	const manifest = yield* Schema.decodeUnknownEffect(SandboxScriptManifest)(
		backendResponse.value.manifest,
	);
	if (
		manifest.kind !== "script" ||
		!manifest.capabilities.includes("invokeOperation") ||
		backendResponse.value.javascript.length === 0 ||
		(yield* fs.exists(path.join(workspaceParentPath, "agent-smoke")))
	) {
		return yield* Effect.die(
			new Error("Backend compiler emitted incomplete agent metadata or retained its workspace"),
		);
	}
	return yield* Effect.log("Backend compiler worker smoke passed");
});

BunRuntime.runMain(Effect.scoped(program).pipe(Effect.provide(BunServices.layer)));
