#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Config, Effect, Schema } from "effect";

import { resolveVersion } from "./version";

const serverRoot = Bun.fileURLToPath(new URL("..", import.meta.url));

const encodeStringLiteral = Schema.encodeEffect(Schema.fromJsonString(Schema.String));

const build = Effect.gen(function* () {
	const version = yield* encodeStringLiteral(yield* resolveVersion);
	const unkeyRootKey = yield* encodeStringLiteral(
		yield* Config.String("UNKEY_ROOT_KEY").pipe(Config.withDefault("")),
	);
	yield* Effect.tryPromise(() =>
		Bun.build({
			target: "bun",
			splitting: true,
			sourcemap: "linked",
			jsx: { development: false },
			outdir: `${serverRoot}/dist`,
			naming: { chunk: "[name]-[hash].[ext]" },
			entrypoints: [`${serverRoot}/src/main.ts`],
			external: ["@ryot-app/vite-compiler", "@tailwindcss/vite"],
			define: { "process.env.RYOT_VERSION": version, "process.env.UNKEY_ROOT_KEY": unkeyRootKey },
		}),
	);
	yield* Effect.tryPromise(() =>
		Bun.build({
			target: "bun",
			sourcemap: "linked",
			outdir: `${serverRoot}/dist`,
			entrypoints: [`${serverRoot}/tooling/prepare-sandbox-runtime.ts`],
		}),
	);
});

BunRuntime.runMain(
	// oxlint-disable-next-line effecttsgo/strict-effect-provide -- The server build is a command-line entrypoint
	build.pipe(Effect.provide(BunServices.layer)),
);
