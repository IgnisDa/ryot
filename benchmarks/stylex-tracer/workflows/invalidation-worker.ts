/* oxlint-disable eslint/no-await-in-loop, perfectionist/sort-objects, typescript/consistent-type-imports, typescript/no-unsafe-type-assertion -- Sequential requests and root-local dynamic imports are required to observe one module generation. */
import { pathToFileURL } from "node:url";

const repositoryRoot = process.argv.at(2);
if (repositoryRoot === undefined) {
	throw new Error("Usage: bun invalidation-worker.ts <root>");
}
process.chdir(repositoryRoot);

const load = <T>(path: string) =>
	import(pathToFileURL(`${repositoryRoot}/${path}`).href) as Promise<T>;
const compiler = await load<typeof import("../../../packages/client-plugin-compiler/src/index")>(
	"packages/client-plugin-compiler/src/index.ts",
);
const benchmark = await load<typeof import("../benchmark")>(
	"benchmarks/stylex-tracer/benchmark.ts",
);
const { Effect } = await load<typeof import("effect")>(
	"packages/client-plugin-compiler/node_modules/effect/dist/index.js",
);

const decoder = new TextDecoder();
let buffered = "";
for await (const chunk of Bun.stdin.stream()) {
	buffered += decoder.decode(chunk, { stream: true });
	let newline = buffered.indexOf("\n");
	while (newline >= 0) {
		const command = buffered.slice(0, newline);
		buffered = buffered.slice(newline + 1);
		if (command === "fingerprint") {
			console.log(
				JSON.stringify({
					pid: process.pid,
					dependencyFingerprint: compiler.STYLEX_TRACER_BUILD_FINGERPRINT,
				}),
			);
			newline = buffered.indexOf("\n");
			continue;
		}
		const input = await benchmark.variantInput("stylex");
		const { artifact } = await Effect.runPromise(compiler.compileClientPlugin(input));
		const css = decoder.decode(artifact.files.find(({ name }) => name === "plugin.css")?.contents);
		console.log(
			JSON.stringify({
				pid: process.pid,
				artifactHash: artifact.hash,
				dependencyFingerprint: compiler.STYLEX_TRACER_BUILD_FINGERPRINT,
				cssSha256: new Bun.CryptoHasher("sha256").update(css).digest("hex"),
				containsVersionB: css.includes("#123456"),
			}),
		);
		newline = buffered.indexOf("\n");
	}
}
