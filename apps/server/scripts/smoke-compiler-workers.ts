#!/usr/bin/env bun

import { BunServices, BunRuntime } from "@effect/platform-bun";
import {
	decodeClientCompilerWorkerResponse,
	encodeClientCompilerWorkerRequest,
} from "@ryot-app/client-plugin-compiler/protocol";
import { CompilerWorkerRequest, CompilerWorkerResponse } from "@ryot-app/sandbox-compiler/protocol";
import { Data, Effect, FileSystem, Schema, Stream } from "effect";
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

const sandboxRequest = Schema.encodeSync(Schema.fromJsonString(CompilerWorkerRequest))({
	source: sandboxSource,
	workspaceJobId: "production-smoke-sandbox",
	workspaceParentPath: process.argv[4] ?? `${process.cwd()}/work`,
});

const clientRequest = encodeClientCompilerWorkerRequest({
	apiVersion: 1,
	name: "Smoke plugin",
	application: "plugin-route",
	contributorOrder: ["smoke"],
	entry: { contributor: "smoke", path: "client/index.tsx" },
	routeRegistry: { routes: [], home: "@ryot-app/plugins/smoke/home" },
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
				"client/styles.css": new TextEncoder().encode(".smoke-logo { display: block; }\n"),
				"client/logo.svg": new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" />'),
				"client/index.tsx": new TextEncoder().encode(`
import "./styles.css";
import { Button } from "@ryot-app/client-ui-sdk";
import { useState } from "react";
import logo from "./logo.svg";

export default function Home() {
	const [count, setCount] = useState(0);
	return <Button className="bg-accent" onClick={() => setCount(count + 1)}><img className="smoke-logo" alt="" src={logo} />{count}</Button>;
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
		const { stderr, stdout, exitCode } = yield* Effect.all(
			{
				exitCode: worker.exitCode,
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
	const fs = yield* FileSystem.FileSystem;
	const forbiddenRuntimeDependencies = [
		`${process.cwd()}/tsconfig.options.json`,
		`${process.cwd()}/node_modules/tsconfig-moon`,
	];
	if ((yield* Effect.filter(forbiddenRuntimeDependencies, (path) => fs.exists(path))).length > 0) {
		return yield* new CompilerWorkerSmokeError({
			message: "Compiler worker smoke layout contains repository TypeScript configuration",
		});
	}

	const sandboxWorkerPath = process.argv[2];
	const clientWorkerPath = process.argv[3];
	if (!sandboxWorkerPath || !clientWorkerPath) {
		return yield* new CompilerWorkerSmokeError({
			message: "Sandbox and client compiler worker paths are required",
		});
	}

	const sandboxOutput = yield* runWorker("Sandbox compiler", sandboxWorkerPath, sandboxRequest);
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

	const artifactFiles = clientResponse.value.artifact.files;
	const artifactNames = new Set(artifactFiles.map(({ name }) => name));
	if (
		artifactNames.size !== artifactFiles.length ||
		artifactFiles.some(({ contents }) => !contents.length)
	) {
		return yield* new CompilerWorkerSmokeError({
			message: "Client compiler worker emitted duplicate or empty artifacts",
		});
	}
	const missingArtifacts = ["index.html", "plugin.js", "plugin.css"].filter(
		(name) => !artifactNames.has(name),
	);
	if (missingArtifacts.length > 0) {
		return yield* new CompilerWorkerSmokeError({
			message: `Client compiler worker omitted artifacts: ${missingArtifacts.join(", ")}`,
		});
	}
	const fontNames = [...artifactNames].filter((name) => name.endsWith(".woff2"));
	const stylesheet = artifactFiles.find(({ name }) => name === "plugin.css");
	const stylesheetText = stylesheet && new TextDecoder().decode(stylesheet.contents);
	if (
		fontNames.length === 0 ||
		!stylesheetText?.includes("Outfit Variable") ||
		!stylesheetText.includes("Lora Variable") ||
		!stylesheetText.includes(".bg-accent") ||
		!stylesheetText.includes(".smoke-logo") ||
		!stylesheetText.includes("box-sizing:border-box") ||
		fontNames.some((name) => !stylesheetText.includes(`./${name}`))
	) {
		return yield* new CompilerWorkerSmokeError({
			message: "Client compiler worker omitted compiler-owned fonts",
		});
	}
	const javascriptText = new TextDecoder().decode(
		artifactFiles.find(({ name }) => name === "plugin.js")?.contents,
	);
	const documentText = new TextDecoder().decode(
		artifactFiles.find(({ name }) => name === "index.html")?.contents,
	);
	const svgName = [...artifactNames].find((name) => name.endsWith(".svg"));
	if (
		!svgName ||
		!javascriptText.includes(svgName) ||
		!documentText.includes('src="./plugin.js"') ||
		!documentText.includes('href="./plugin.css"')
	) {
		return yield* new CompilerWorkerSmokeError({
			message: "Client compiler worker emitted an incomplete Vite artifact graph",
		});
	}
	return yield* Effect.void;
});

BunRuntime.runMain(Effect.scoped(program).pipe(Effect.provide(BunServices.layer)));
