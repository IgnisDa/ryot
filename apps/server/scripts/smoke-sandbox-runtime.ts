#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { hostSuccess } from "@ryot-app/sandbox-sdk/wire";
import { Clock, Crypto, Data, Effect, Encoding, FileSystem, Layer, Path, Schema } from "effect";

import { materializeSandboxCompiledModule } from "../../../kernel/backend/src/lib/infrastructure/sandbox-runtime/compiled-modules";
import { SANDBOX_RUNNER_LIMITS } from "../../../kernel/backend/src/lib/infrastructure/sandbox-runtime/limits";
import { sandboxRunnerSource } from "../../../kernel/backend/src/lib/infrastructure/sandbox-runtime/runner.generated";
import {
	BridgeService,
	PackageCacheManager,
	sandboxDenoRunFlags,
} from "../../../kernel/backend/src/lib/infrastructure/sandbox-runtime/runtime";
import { sandboxRuntimePayload } from "../../../kernel/backend/src/lib/infrastructure/sandbox-runtime/runtime-payload.generated";
import { runProcessCapturing } from "./run-process";

class SandboxRuntimeSmokeError extends Data.TaggedError("SandboxRuntimeSmokeError")<{
	readonly message: string;
}> {}

const manifest = {
	kind: "script",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Production runtime smoke",
	slug: "production-runtime-smoke",
	capabilities: ["getCachedValue"],
} as const;

const compiledSource = `
import { Effect as SdkEffect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { Effect as PluginKitEffect } from "@ryot-app/plugin-kit/effect";

export default {
  manifest: ${JSON.stringify(manifest)},
  definitionType: "ryot:sandbox-script",
  input: Schema.Struct({}),
  output: Schema.Struct({ aliasIdentity: Schema.Boolean, hostValue: Schema.String }),
  run: (_input, host) => host.getCachedValue("production-smoke").pipe(
    SdkEffect.map((hostValue) => ({ aliasIdentity: SdkEffect === PluginKitEffect, hostValue })),
  ),
};
`;

const encodeRequest = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const SmokeResponse = Schema.fromJsonString(
	Schema.Struct({
		success: Schema.Literal(true),
		value: Schema.Struct({
			aliasIdentity: Schema.Literal(true),
			hostValue: Schema.Literal("mediated-production-smoke"),
		}),
	}),
);

const program = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const bridge = yield* BridgeService;
	const runtime = yield* PackageCacheManager;
	const crypto = yield* Crypto.Crypto;
	const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-production-runtime-smoke-" });
	const runnerPath = `${root}/runner.mjs`;
	yield* fs.writeFileString(runnerPath, sandboxRunnerSource);
	const sourceHash = Encoding.encodeHex(
		yield* crypto.digest("SHA-256", new TextEncoder().encode(compiledSource)),
	);
	const modulePath = yield* materializeSandboxCompiledModule(runtime, sourceHash, compiledSource);
	const moduleUrl = (yield* path.toFileUrl(modulePath)).href;
	const executionId = "production-runtime-smoke";
	const token = "production-runtime-smoke-token";
	const parentSpan = yield* Effect.currentSpan;
	const now = yield* Clock.currentTimeMillis;
	yield* bridge.addSession(executionId, {
		token,
		parentSpan,
		hostCallLimit: 1,
		expiresAt: now + 30_000,
		apiFunctions: {
			getCachedValue: (args) =>
				args[0] === "production-smoke"
					? Effect.succeed(hostSuccess("mediated-production-smoke"))
					: Effect.fail(new SandboxRuntimeSmokeError({ message: "Unexpected smoke host call" })),
		},
	});

	const request = `${encodeRequest({
		token,
		moduleUrl,
		context: {},
		executionId,
		compiledFormat: 1,
		metadata: manifest,
		limits: SANDBOX_RUNNER_LIMITS,
		apiFunctions: ["getCachedValue"],
		scriptId: "production-runtime-smoke",
		startedAt: "2026-01-01T00:00:00.000Z",
		apiBase: `http://127.0.0.1:${bridge.port}`,
	})}\n`;
	const denoEnvironment = {
		DENO_DIR: runtime.cacheDirectory,
		PATH: Bun.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
	};
	const version = yield* runProcessCapturing("deno", ["--version"], { env: denoEnvironment });
	const installedDenoVersion = version.stdout.split("\n")[0]?.split(" ")[1];
	if (installedDenoVersion !== sandboxRuntimePayload.metadata.denoVersion) {
		return yield* new SandboxRuntimeSmokeError({
			message: `Deno ${installedDenoVersion ?? "unknown"} does not match the runtime payload built for Deno ${sandboxRuntimePayload.metadata.denoVersion}`,
		});
	}
	const { stdout, stderr, exitCode } = yield* runProcessCapturing(
		"deno",
		[
			"run",
			...sandboxDenoRunFlags({
				runnerPath,
				bridgePort: bridge.port,
				runtimeDirectory: runtime.directory,
				importMapPath: runtime.importMapPath,
			}),
			runnerPath,
		],
		{ input: request, env: denoEnvironment },
	);
	if (exitCode !== 0) {
		return yield* new SandboxRuntimeSmokeError({
			message: `Deno runtime smoke exited with code ${exitCode}: ${stderr || stdout}`,
		});
	}
	return yield* Schema.decodeEffect(SmokeResponse)(stdout.trim()).pipe(
		Effect.mapError(
			(error) =>
				new SandboxRuntimeSmokeError({
					message: `Deno runtime smoke returned an invalid response: ${String(error)}`,
				}),
		),
	);
}).pipe(Effect.withSpan("production-sandbox-runtime-smoke"));

const RuntimeSmokeLive = Layer.merge(BridgeService.layer, PackageCacheManager.layer).pipe(
	Layer.provideMerge(BunServices.layer),
);

BunRuntime.runMain(Effect.scoped(program).pipe(Effect.provide(RuntimeSmokeLive)));
