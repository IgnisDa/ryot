import { SandboxScriptManifest } from "@ryot-app/contract/modules/sandbox/schemas";
import { sandboxCompilerPlatformLayer } from "@ryot-app/sandbox-compiler/platform";
import { compilePluginSandboxSourceEntries } from "@ryot-app/sandbox-compiler/plugins";
import { Effect, FileSystem, Layer, Schema } from "effect";

import {
	SandboxSmokeFixturesJson,
	smokeHostCallKey,
	smokeSourceManifest,
	smokeTiers,
} from "./sandbox-smoke-fixtures";

const serverRoot = Bun.fileURLToPath(new URL("..", import.meta.url));
const ambientGlobals = [
	"Deno",
	"Bun",
	"process",
	"require",
	"Blob",
	"File",
	"MessageChannel",
	"MessagePort",
	"BroadcastChannel",
	"SharedArrayBuffer",
	"Atomics",
	"WebAssembly",
	"Worker",
	"SharedWorker",
];
const entryForTier = (tier: (typeof smokeTiers)[number]) => `${tier}.sandbox.ts`;

const makeDefinitionSource = (tier: (typeof smokeTiers)[number]) => {
	let dependencyImports = "";
	let dependencyProbe = "";
	if (tier === "data") {
		dependencyImports = `import { gzipSync, gunzipSync, strFromU8 } from "@ryot-app/sandbox-sdk/fflate";`;
		dependencyProbe = `
			const compressed = gzipSync(new TextEncoder().encode("production-smoke"));
			if (strFromU8(gunzipSync(compressed)) !== "production-smoke") {
				throw new Error("The fflate smoke operation failed");
			}
			`;
	} else if (tier === "full") {
		dependencyImports = `import { createYoutubeMusicClient } from "@ryot-app/sandbox-sdk/youtubei";`;
		dependencyProbe = `
			if (typeof createYoutubeMusicClient !== "function") {
				throw new Error("The youtubei smoke import is unavailable");
			}
			`;
	}

	return `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect as SdkEffect, Schema as SdkSchema } from "@ryot-app/sandbox-sdk/effect";
import { Schema as PluginKitSchema } from "@ryot-app/plugin-kit/effect";
${dependencyImports}

export const manifest = defineManifest(${JSON.stringify(smokeSourceManifest)});

export default defineScript({
  manifest,
  input: SdkSchema.Struct({}),
  output: SdkSchema.Struct({
    aliasIdentity: SdkSchema.Boolean,
    ambient: SdkSchema.Array(SdkSchema.String),
    hostValue: SdkSchema.Unknown,
  }),
  run: (_input, host) => host.getCachedValue("${smokeHostCallKey}").pipe(
    SdkEffect.map((hostValue) => {
      ${dependencyProbe}
      const ambient: string[] = [];
      for (const name of ${JSON.stringify(ambientGlobals)}) {
        if (name in globalThis) ambient.push("global:" + name);
      }
      const generators: ReadonlyArray<readonly [string, () => unknown]> = [
        ["eval", () => (0, eval)("1")],
        ["Function", () => new Function("return 1")()],
      ];
      for (const [label, generate] of generators) {
        try { generate(); ambient.push("codegen:" + label); } catch {}
      }
      for (const symbol of Object.getOwnPropertySymbols(globalThis)) {
        ambient.push("symbol:" + String(symbol.description));
      }
      return {
        ambient,
        aliasIdentity: SdkSchema === PluginKitSchema,
        hostValue,
      };
    }),
  ),
});
`;
};

export const SandboxSmokeFixturesBuildLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const compiled = yield* compilePluginSandboxSourceEntries(
			Object.fromEntries(
				smokeTiers.map((tier) => [entryForTier(tier), makeDefinitionSource(tier)]),
			),
			smokeTiers.map((tier) => ({ entry: entryForTier(tier), kind: smokeSourceManifest.kind })),
		);
		const fixtureForTier = Effect.fnUntraced(function* (tier: (typeof smokeTiers)[number]) {
			const fixture = compiled.find(({ entry }) => entry === entryForTier(tier));
			if (fixture === undefined) {
				throw new Error(`Sandbox compiler returned no smoke fixture for ${tier}`);
			}
			return {
				...fixture.compiled,
				manifest: yield* Schema.decodeUnknownEffect(SandboxScriptManifest)(
					fixture.compiled.manifest,
				),
			};
		});
		const fixtures = {
			core: yield* fixtureForTier("core"),
			data: yield* fixtureForTier("data"),
			full: yield* fixtureForTier("full"),
		};
		const encoded = yield* Schema.encodeEffect(SandboxSmokeFixturesJson)(fixtures);
		yield* fs.makeDirectory(`${serverRoot}/dist`, { recursive: true });
		yield* fs.writeFileString(`${serverRoot}/dist/sandbox-smoke-fixtures.json`, encoded);
	}),
).pipe(Layer.provide(sandboxCompilerPlatformLayer));
