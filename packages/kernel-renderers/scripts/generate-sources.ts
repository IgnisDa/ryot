#!/usr/bin/env bun

import { Schema } from "effect";

const encodeGeneratedString = Schema.encodeSync(Schema.fromJsonString(Schema.String));

const sourceRoot = new URL("../src/", import.meta.url);

const isRendererSource = (path: string) =>
	!path.includes(".test.") && !path.endsWith(".generated.ts") && path !== "index.ts";

const tsPaths = await Array.fromAsync(
	new Bun.Glob("*.{ts,tsx}").scan({ cwd: Bun.fileURLToPath(sourceRoot), onlyFiles: true }),
);
const paths = tsPaths.filter(isRendererSource).sort();

const entries = await Promise.all(
	paths.map(async (path) => {
		const source = await Bun.file(new URL(path, sourceRoot)).text();
		return `\t${encodeGeneratedString(`client/${path}`)}: ${encodeGeneratedString(source)},`;
	}),
);

await Bun.write(
	new URL("sources.generated.ts", sourceRoot),
	`export const kernelRendererSources = {\n${entries.join("\n")}\n} as const;\n`,
);
