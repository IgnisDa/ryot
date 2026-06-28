#!/usr/bin/env bun

import { BunServices, BunRuntime } from "@effect/platform-bun";
import {
	decodeClientCompilerWorkerResponse,
	encodeClientCompilerWorkerRequest,
} from "@ryot-app/client-plugin-compiler/protocol";
import { CompilerWorkerResponse } from "@ryot-app/sandbox-compiler/protocol";
import { Data, Effect, Schema, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";

class CompilerWorkerSmokeError extends Data.TaggedError("CompilerWorkerSmokeError")<{
	message: string;
}> {}

const sandboxSource = `
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";

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

const clientRequest = encodeClientCompilerWorkerRequest({
	apiVersion: 1,
	name: "Smoke plugin",
	application: "plugin-route",
	contributorOrder: ["smoke"],
	entry: { contributor: "smoke", path: "client/index.tsx" },
	routeRegistry: { home: "@ryot-app/plugins/smoke/home", routes: [] },
	publicExports: {
		"@ryot-app/plugins/smoke/home": {
			kind: "page",
			contributor: "smoke",
			entry: "client/index.tsx",
		},
	},
	contributors: {
		smoke: {
			files: {
				"client/styles.css": new TextEncoder().encode('@import "tailwindcss";\n'),
				"client/logo.svg": new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" />'),
				"client/index.tsx": new TextEncoder().encode(`
import "./styles.css";
import { Button } from "@ryot-app/client-ui-sdk";
import { useState } from "react";
import logo from "./logo.svg";

export default function Home() {
	const [count, setCount] = useState(0);
	return <Button className="bg-accent" onClick={() => setCount(count + 1)}><img alt="" src={logo} />{count}</Button>;
}
`),
			},
		},
	},
});

const decodeSandboxResponse = Schema.decodeUnknownEffect(
	Schema.fromJsonString(CompilerWorkerResponse),
);

const runWorker = (name: string, workerPath: string, input: string) =>
	Effect.gen(function* () {
		const command = ChildProcess.make(
			process.execPath,
			["--smol", "--no-orphans", "--no-install", "--no-env-file", workerPath],
			{ stdout: "pipe", stderr: "pipe", stdin: Stream.succeed(new TextEncoder().encode(input)) },
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
	const clientResponse = yield* decodeClientCompilerWorkerResponse(clientOutput).pipe(
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
	const fontNames = [...artifactNames].filter((name) => name.endsWith(".woff2"));
	const stylesheet = clientResponse.value.artifact.files.find(({ name }) => name === "plugin.css");
	const stylesheetText = stylesheet && new TextDecoder().decode(stylesheet.contents);
	if (
		fontNames.length !== 9 ||
		!stylesheetText?.includes("Outfit Variable") ||
		!stylesheetText.includes("Lora Variable") ||
		fontNames.some((name) => !stylesheetText.includes(`./${name}`))
	) {
		return yield* new CompilerWorkerSmokeError({
			message: "Client compiler worker omitted compiler-owned fonts",
		});
	}
	return yield* Effect.void;
});

BunRuntime.runMain(Effect.scoped(program).pipe(Effect.provide(BunServices.layer)));
