#!/usr/bin/env bun

import { encodeJsonString } from "@ryot-app/ts-utils/json";
import { Effect } from "effect";

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
			(source) => `\t${encodeJsonString(`client/${path}`)}: ${encodeJsonString(source)},`,
		),
	),
);

await Bun.write(
	new URL("sources.generated.ts", sourceRoot),
	`export const kernelRendererSources = {\n${entries.join("\n")}\n} as const;\n`,
);
