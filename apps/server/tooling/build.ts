#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { pluginBackendCompilerPlatformLayer } from "@ryot-app/plugin-backend-compiler/platform";
import { Effect, Layer, Schema } from "effect";

import { buildSandboxSmokeFixtures } from "./build-sandbox-smoke-fixtures";
import { resolveVersion } from "./version";

const serverRoot = Bun.fileURLToPath(new URL("..", import.meta.url));

const encodeStringLiteral = Schema.encodeEffect(Schema.fromJsonString(Schema.String));

const build = Effect.gen(function* () {
	yield* buildSandboxSmokeFixtures;
	const version = yield* encodeStringLiteral(yield* resolveVersion);
	yield* Effect.promise(() =>
		Bun.build({
			target: "bun",
			splitting: true,
			sourcemap: "linked",
			jsx: { development: false },
			outdir: `${serverRoot}/dist`,
			define: { "process.env.RYOT_VERSION": version },
			naming: { entry: "[name].[ext]", chunk: "[name]-[hash].[ext]" },
			external: [
				"@ryot-app/plugin-client-compiler/worker",
				"@ryot-app/plugin-backend-compiler/worker",
			],
			entrypoints: [
				`${serverRoot}/src/main.ts`,
				`${serverRoot}/tooling/plugin-client-compiler-worker.ts`,
				`${serverRoot}/tooling/plugin-backend-compiler-worker.ts`,
				`${serverRoot}/tooling/smoke-compiler-workers.ts`,
				Bun.resolveSync(
					"@ryot-app/kernel-backend/modules/plugins/packages/definition-set-worker",
					serverRoot,
				),
			],
		}),
	);
	yield* Effect.promise(() =>
		Bun.build({
			target: "bun",
			sourcemap: "linked",
			outdir: `${serverRoot}/dist`,
			entrypoints: [`${serverRoot}/tooling/prepare-sandbox-runtime.ts`],
		}),
	);
});

BunRuntime.runMain(
	build.pipe(Effect.provide(Layer.merge(BunServices.layer, pluginBackendCompilerPlatformLayer))),
);
