/* oxlint-disable perfectionist/sort-objects, typescript/no-explicit-any -- Evidence keys follow the workflow sequence; parsed worker evidence is validated by explicit assertions. */
import { pathToFileURL } from "node:url";

const roots = process.argv.slice(2);
if (roots.length !== 2 || roots[0] === roots[1]) {
	throw new Error("Usage: bun compare-roots.ts <root-a> <root-b>");
}

const worker = Bun.fileURLToPath(new URL("./root-build.ts", import.meta.url));
const run = (root: string, index: number) => {
	const suffix = index === 0 ? "A" : "B";
	const cache = process.env[`STYLEX_TRACER_CACHE_ROOT_${suffix}`];
	const xdg = process.env[`STYLEX_TRACER_XDG_ROOT_${suffix}`];
	const temporary = process.env[`STYLEX_TRACER_TMP_ROOT_${suffix}`];
	if (cache === undefined || xdg === undefined || temporary === undefined) {
		throw new Error(`Explicit cache roots are required for relocation root ${suffix}`);
	}
	const result = Bun.spawnSync([process.execPath, worker, root], {
		cwd: root,
		env: { ...process.env, BUN_INSTALL_CACHE_DIR: cache, XDG_CACHE_HOME: xdg, TMPDIR: temporary },
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) {
		throw new Error(new TextDecoder().decode(result.stderr));
	}
	return JSON.parse(new TextDecoder().decode(result.stdout));
};

const [left, right] = roots.map(run);
const comparable = (result: typeof left) => ({
	revision: result.revision,
	lockfileSha256: result.lockfileSha256,
	dependencyFingerprint: result.dependencyFingerprint,
	treeIdentity: result.treeIdentity,
	contentIdentity: result.contentIdentity,
	sourceManifest: {
		sha256: result.sourceManifest.sha256,
		files: result.sourceManifest.files.map(({ path, bytes, sha256 }: Record<string, unknown>) => ({
			path,
			bytes,
			sha256,
		})),
	},
	apiVersion: result.apiVersion,
	variants: result.variants,
});
const contained = (result: typeof left) =>
	[
		...Object.values(result.resolutions.workspace),
		...Object.values(result.resolutions.packages),
	].every((resolution: any) => resolution.containedInRoot) &&
	result.sourceManifest.files.every((file: any) => file.containedInRoot);
const equality = {
	logicalOutputs: Bun.deepEquals(comparable(left), comparable(right)),
	revision: left.revision === right.revision && left.revision !== "unknown",
	treeIdentity: Bun.deepEquals(left.treeIdentity, right.treeIdentity),
	contentIdentity: left.contentIdentity === right.contentIdentity,
	sourceManifest: Bun.deepEquals(comparable(left).sourceManifest, comparable(right).sourceManifest),
	rootContainment: contained(left) && contained(right),
	isolatedCacheRoots:
		Object.values(left.cacheRoots).every(
			(path) => !Object.values(right.cacheRoots).includes(path),
		) &&
		new Set(Object.values(left.cacheRoots)).size === Object.values(left.cacheRoots).length &&
		new Set(Object.values(right.cacheRoots)).size === Object.values(right.cacheRoots).length,
	stylexArtifactFiles: Bun.deepEquals(left.variants.stylex.files, right.variants.stylex.files),
	stylexArchive: Bun.deepEquals(left.variants.stylex.archive, right.variants.stylex.archive),
	tailwindArtifactFiles: Bun.deepEquals(
		left.variants.tailwind.files,
		right.variants.tailwind.files,
	),
	tailwindArchive: Bun.deepEquals(left.variants.tailwind.archive, right.variants.tailwind.archive),
};

const evidence = JSON.stringify(
	{
		generatedAt: new Date().toISOString(),
		command: [process.execPath, pathToFileURL(import.meta.path).pathname, ...roots],
		roots: [left, right],
		equality,
		pass: Object.values(equality).every(Boolean),
	},
	null,
	2,
);
const evidencePath = process.env.STYLEX_TRACER_EVIDENCE;
if (evidencePath !== undefined) {
	await Bun.write(evidencePath, `${evidence}\n`);
}
console.log(
	JSON.stringify({ evidencePath, equality, pass: Object.values(equality).every(Boolean) }),
);
