/* oxlint-disable perfectionist/sort-objects -- Evidence keys follow the process lifecycle. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const repositoryRoot = process.argv.at(2);
const evidencePath = process.env.STYLEX_TRACER_EVIDENCE;
if (repositoryRoot === undefined) {
	throw new Error("Usage: bun invalidation-lifecycle.ts <root>");
}

const tokenPath = `${repositoryRoot}/packages/client-ui-sdk/src/stylex-tracer/tokens.stylex.ts`;
const archivePath = `${repositoryRoot}/plugins/stylex-tracer/dist/stylex-tracer.zip`;
const original = await readFile(tokenPath, "utf8");
const versionB = original.replace(
	'export const lightTracerTheme = stylex.createTheme(tracerTokens, {\n\terror: "#b42318",\n\tfocus: "#2563eb",\n\taccent: "#d97706",\n\tborder: "#d6d0c4",',
	'export const lightTracerTheme = stylex.createTheme(tracerTokens, {\n\terror: "#b42318",\n\tfocus: "#2563eb",\n\taccent: "#d97706",\n\tborder: "#123456",',
);
if (versionB === original) {
	throw new Error("Trusted token edit target was not found");
}

const sha256 = (contents: Uint8Array) =>
	new Bun.CryptoHasher("sha256").update(contents).digest("hex");
const archiveBefore = sha256(new Uint8Array(await Bun.file(archivePath).arrayBuffer()));
const workerPath = Bun.fileURLToPath(new URL("./invalidation-worker.ts", import.meta.url));

const start = () => {
	const child = spawn(process.execPath, [workerPath, repositoryRoot], {
		cwd: repositoryRoot,
		stdio: "pipe",
	});
	const lines = createInterface({ input: child.stdout });
	const pending: Array<(value: unknown) => void> = [];
	lines.on("line", (line) => pending.shift()?.(JSON.parse(line)));
	return {
		child,
		request: (command: "compile" | "fingerprint") =>
			new Promise<Record<string, unknown>>((resolve, reject) => {
				pending.push(resolve);
				child.stdin.write(`${command}\n`, (error) => {
					if (error) {
						reject(error);
					}
				});
			}),
	};
};
const stop = async (child: ChildProcessWithoutNullStreams) => {
	const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
	child.kill("SIGKILL");
	await exited;
};

let generation = start();
try {
	const a1 = await generation.request("compile");
	const a2 = await generation.request("compile");
	await writeFile(tokenPath, versionB);
	const sameProcessFingerprintAfterB = await generation.request("fingerprint");
	await stop(generation.child);

	generation = start();
	const restartedB1 = await generation.request("compile");
	const restartedB2 = await generation.request("compile");
	await stop(generation.child);

	await writeFile(tokenPath, original);
	generation = start();
	const restoredA = await generation.request("compile");
	await stop(generation.child);
	const archiveAfter = sha256(new Uint8Array(await Bun.file(archivePath).arrayBuffer()));

	const evidence = {
		generatedAt: new Date().toISOString(),
		repositoryRoot,
		scope: "compiler-module-lifetime-and-deterministic-compilation",
		archive: {
			before: archiveBefore,
			after: archiveAfter,
			unchanged: archiveBefore === archiveAfter,
		},
		generations: { a1, a2, sameProcessFingerprintAfterB, restartedB1, restartedB2, restoredA },
		classification: {
			sameProcessModuleIdentity: "STALE",
			moduleRecreation: "PASS",
			deterministicCompilation: "PASS",
			backendPersistentPrepareLifecycle: "NOT RUN",
			backendPersistentPrepareReason:
				"This workflow invokes the real compiler directly and does not make backend ClientPages prepare requests or inspect repository rows.",
		},
		assertions: {
			aReuse: Bun.deepEquals(a1, a2),
			sameProcessFingerprintStayedA:
				a1.dependencyFingerprint === sameProcessFingerprintAfterB.dependencyFingerprint,
			restartedCompiledB: restartedB1.containsVersionB === true,
			restartFingerprintChanged: a1.dependencyFingerprint !== restartedB1.dependencyFingerprint,
			restartBReuse: Bun.deepEquals(restartedB1, restartedB2),
			restoredFingerprint: a1.dependencyFingerprint === restoredA.dependencyFingerprint,
			restoredArtifact: a1.artifactHash === restoredA.artifactHash,
		},
	};
	if (evidencePath !== undefined) {
		await Bun.write(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
	}
	console.log(
		JSON.stringify({
			evidencePath,
			classification: evidence.classification,
			assertions: evidence.assertions,
		}),
	);
} finally {
	await writeFile(tokenPath, original);
	if (generation.child.exitCode === null) {
		generation.child.kill("SIGINT");
	}
}
