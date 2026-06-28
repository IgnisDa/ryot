#!/usr/bin/env bun

import { BunServices, BunRuntime } from "@effect/platform-bun";
import { ClientCompilerWorkerResponse } from "@ryot/client-plugin-compiler/protocol";
import { CompilerWorkerResponse } from "@ryot/sandbox-compiler/protocol";
import { Data, Effect, Schema, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";

class CompilerWorkerSmokeError extends Data.TaggedError("CompilerWorkerSmokeError")<{
	message: string;
}> {}

const sandboxSource = `
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot/sandbox-sdk/workflow";

export const manifest = defineManifest({
	name: "Smoke",
	slug: "smoke",
	kind: "workflow",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineWorkflow({
	manifest,
	input: Schema.Struct({}),
	output: Schema.String,
	run: () => Effect.succeed("smoke"),
});
`;

const clientRequest = JSON.stringify({
	apiVersion: 1,
	entry: "client/index.tsx",
	files: {
		"client/index.tsx": `
import "./styles.css";
import { bootstrapClientPlugin, defineClientPlugin } from "@ryot/client-sdk/plugin";
import { Button } from "@ryot/client-ui-sdk";
import { useState } from "react";

const Home = () => {
	const [count, setCount] = useState(0);
	return <Button className="bg-accent" onClick={() => setCount(count + 1)}>{count}</Button>;
};

bootstrapClientPlugin(defineClientPlugin({ home: Home }));
`,
		"client/styles.css": '@import "tailwindcss";\n',
	},
});

const decodeSandboxResponse = Schema.decodeUnknownEffect(
	Schema.fromJsonString(CompilerWorkerResponse),
);
const decodeClientResponse = Schema.decodeUnknownEffect(
	Schema.fromJsonString(ClientCompilerWorkerResponse),
);

const runWorker = (name: string, workerPath: string, input: string) =>
	Effect.gen(function* () {
		const command = ChildProcess.make(
			process.execPath,
			["--smol", "--no-orphans", "--no-install", "--no-env-file", workerPath],
			{
				stdout: "pipe",
				stderr: "pipe",
				stdin: Stream.succeed(new TextEncoder().encode(input)),
			},
		);
		const worker = yield* command;
		yield* Effect.addFinalizer(() => worker.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore));
		const { exitCode, stderr, stdout } = yield* Effect.all(
			{
				stdout: worker.stdout.pipe(
					Stream.decodeText({ encoding: "utf-8" }),
					Stream.runFold(
						() => "",
						(output, chunk) => output + chunk,
					),
				),
				stderr: worker.stderr.pipe(
					Stream.decodeText({ encoding: "utf-8" }),
					Stream.runFold(
						() => "",
						(output, chunk) => output + chunk,
					),
				),
				exitCode: worker.exitCode,
			},
			{ concurrency: "unbounded" },
		);
		if (exitCode !== 0) {
			return yield* new CompilerWorkerSmokeError({
				message: `${name} worker exited with code ${exitCode}: ${stderr.length > 0 ? stderr : stdout}`,
			});
		}
		return stdout;
	});

const program = Effect.gen(function* () {
	const sandboxWorkerPath = process.argv[2];
	const clientWorkerPath = process.argv[3];
	if (!sandboxWorkerPath || !clientWorkerPath) {
		return yield* new CompilerWorkerSmokeError({
			message: "Sandbox and client compiler worker paths are required",
		});
	}

	const sandboxOutput = yield* runWorker("Sandbox compiler", sandboxWorkerPath, sandboxSource);
	const sandboxResponse = yield* decodeSandboxResponse(sandboxOutput).pipe(
		Effect.mapError(
			(error) =>
				new CompilerWorkerSmokeError({
					message: `Sandbox compiler worker returned an invalid response: ${String(error)}`,
				}),
		),
	);
	if (!sandboxResponse.success) {
		return yield* new CompilerWorkerSmokeError({
			message: `Sandbox compiler worker failed to compile: ${sandboxOutput}`,
		});
	}

	const clientOutput = yield* runWorker("Client compiler", clientWorkerPath, clientRequest);
	const clientResponse = yield* decodeClientResponse(clientOutput).pipe(
		Effect.mapError(
			(error) =>
				new CompilerWorkerSmokeError({
					message: `Client compiler worker returned an invalid response: ${String(error)}`,
				}),
		),
	);
	if (!clientResponse.success) {
		return yield* new CompilerWorkerSmokeError({
			message: `Client compiler worker failed to compile: ${clientOutput}`,
		});
	}

	const artifactNames = new Set(clientResponse.value.artifact.files.map(({ name }) => name));
	const missingArtifacts = ["index.html", "plugin.js", "plugin.css"].filter(
		(name) => !artifactNames.has(name),
	);
	if (missingArtifacts.length > 0) {
		return yield* new CompilerWorkerSmokeError({
			message: `Client compiler worker omitted artifacts: ${missingArtifacts.join(", ")}`,
		});
	}
	return yield* Effect.void;
});

BunRuntime.runMain(Effect.scoped(program).pipe(Effect.provide(BunServices.layer)));
