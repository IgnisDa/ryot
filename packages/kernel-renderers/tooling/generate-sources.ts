#!/usr/bin/env bun

import { Effect, Schema } from "effect";

const encodeGeneratedString = Schema.encodeSync(Schema.fromJsonString(Schema.String));

const sourceRoot = new URL("../src/", import.meta.url);

const isRendererSource = (path: string) =>
	!path.includes(".test.") && !path.endsWith(".generated.ts") && path !== "index.ts";

const tsPaths = await Array.fromAsync(
	new Bun.Glob("*.{ts,tsx}").scan({ onlyFiles: true, cwd: Bun.fileURLToPath(sourceRoot) }),
);
const paths = tsPaths.filter(isRendererSource).sort();

const entries = await Effect.runPromise(
	Effect.forEach(paths, (path) =>
		Effect.map(
			Effect.promise(() => Bun.file(new URL(path, sourceRoot)).text()),
			(source) => `\t${encodeGeneratedString(`client/${path}`)}: ${encodeGeneratedString(source)},`,
		),
	),
);

await Bun.write(
	new URL("sources.generated.ts", sourceRoot),
	`export const kernelRendererSources = {\n${entries.join("\n")}\n} as const;\n`,
);
