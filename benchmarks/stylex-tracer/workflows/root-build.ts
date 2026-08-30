/* oxlint-disable perfectionist/sort-objects, typescript/consistent-type-imports, typescript/no-unsafe-type-assertion, typescript/require-array-sort-compare -- Evidence keys follow execution order and root-local dynamic imports prevent cross-root resolution. */
import { realpath, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = process.argv.at(2);
if (repositoryRoot === undefined) {
	throw new Error("Usage: bun root-build.ts <repository-root>");
}

process.chdir(repositoryRoot);

const sha256 = (contents: string | Uint8Array) => {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(typeof contents === "string" ? new TextEncoder().encode(contents) : contents);
	return hasher.digest("hex");
};

const importFromRoot = <T>(path: string) =>
	import(
		`${pathToFileURL(`${repositoryRoot}/${path}`).href}?root-build=${crypto.randomUUID()}`
	) as Promise<T>;

const compiler = await importFromRoot<
	typeof import("../../../packages/client-plugin-compiler/src/index")
>("packages/client-plugin-compiler/src/index.ts");
const contract = await importFromRoot<
	typeof import("../../../packages/client-plugin-contract/src/index")
>("packages/client-plugin-contract/src/index.ts");
const archive = await importFromRoot<typeof import("../../../packages/plugin-archive/src/index")>(
	"packages/plugin-archive/src/index.ts",
);
const benchmark = await importFromRoot<typeof import("../benchmark")>(
	"benchmarks/stylex-tracer/benchmark.ts",
);
const plugin = await importFromRoot<typeof import("../../../plugins/stylex-tracer/host/plugin")>(
	"plugins/stylex-tracer/host/plugin.ts",
);
const { Effect } = await importFromRoot<typeof import("effect")>(
	"packages/client-plugin-compiler/node_modules/effect/dist/index.js",
);

const fileInventory = async (root: string) => {
	const paths = [...new Bun.Glob("**/*").scanSync({ cwd: root, onlyFiles: true })].sort();
	return Promise.all(
		paths.map(async (path) => {
			const contents = new Uint8Array(await Bun.file(`${root}/${path}`).arrayBuffer());
			return { path, bytes: contents.byteLength, sha256: sha256(contents) };
		}),
	);
};

const sourceManifestRoots = [
	"benchmarks/stylex-tracer/benchmark.ts",
	"benchmarks/stylex-tracer/fixture",
	"bun.lock",
	"packages/client-plugin-compiler/package.json",
	"packages/client-plugin-compiler/src",
	"packages/client-plugin-contract/package.json",
	"packages/client-plugin-contract/src",
	"packages/client-sdk/package.json",
	"packages/client-sdk/src",
	"packages/client-ui-sdk/package.json",
	"packages/client-ui-sdk/src",
	"packages/contract/package.json",
	"packages/contract/src",
	"packages/plugin-archive/package.json",
	"packages/plugin-archive/src",
	"packages/ryotql/package.json",
	"packages/ryotql/src",
	"packages/ts-utils/package.json",
	"packages/ts-utils/src",
	"plugins/stylex-tracer/assets.d.ts",
	"plugins/stylex-tracer/client",
	"plugins/stylex-tracer/host",
	"plugins/stylex-tracer/package.json",
	"plugins/stylex-tracer/tsconfig.json",
] as const;

const completeSourceManifest = async () => {
	const sourcePaths = await Promise.all(
		sourceManifestRoots.map(async (root) => {
			const rootStat = await stat(`${repositoryRoot}/${root}`);
			if (rootStat.isFile()) {
				return [root];
			}
			return Array.fromAsync(
				new Bun.Glob("**/*").scan({ onlyFiles: true, cwd: `${repositoryRoot}/${root}` }),
			).then((files) => files.map((path) => `${root}/${path}`));
		}),
	);
	const paths = sourcePaths
		.flat()
		.filter((path) => !/\.(?:test|spec)\./.test(path) && !path.includes("/dist/"))
		.sort();
	const rootRealpath = await realpath(repositoryRoot);
	const files = await Promise.all(
		paths.map(async (path) => {
			const physicalPath = await realpath(`${repositoryRoot}/${path}`);
			const contents = new Uint8Array(await Bun.file(physicalPath).arrayBuffer());
			return {
				path,
				physicalPath,
				containedInRoot: !relative(rootRealpath, physicalPath).startsWith(".."),
				bytes: contents.byteLength,
				sha256: sha256(contents),
			};
		}),
	);
	const logical = files.map(({ path, bytes, sha256: fileSha256 }) => ({
		path,
		bytes,
		sha256: fileSha256,
	}));
	return { roots: sourceManifestRoots, files, sha256: sha256(JSON.stringify(logical)) };
};

const compile = async (variant: "stylex" | "tailwind") => {
	const input = await benchmark.variantInput(variant);
	const result = await Effect.runPromise(compiler.compileClientPlugin(input));
	const files = result.artifact.files.map(({ name, contentType, contents }) => ({
		name,
		contentType,
		bytes: contents.byteLength,
		sha256: sha256(contents),
	}));
	const filesByName = Object.fromEntries(
		Object.entries(input.contributors[variant].files).map(([name, contents]) => [name, contents]),
	);
	const canonicalArchive = archive.writePluginArchive({
		manifest:
			variant === "stylex"
				? { ...plugin.stylexTracerPlugin, scripts: [] }
				: {
						...plugin.stylexTracerPlugin,
						metadata: { ...plugin.stylexTracerPlugin.metadata, slug: "tailwind-tracer" },
						scripts: [],
					},
		files: filesByName,
	});
	await Effect.runPromise(archive.readPluginArchive(canonicalArchive));
	return {
		artifactHash: result.artifact.hash,
		archive: { bytes: canonicalArchive.byteLength, sha256: sha256(canonicalArchive) },
		files,
		input: await fileInventory(
			variant === "stylex"
				? `${repositoryRoot}/plugins/stylex-tracer/client`
				: `${repositoryRoot}/benchmarks/stylex-tracer/fixture/tailwind`,
		),
	};
};

const compilerRoot = `${repositoryRoot}/packages/client-plugin-compiler`;
const resolutionPaths = [
	"packages/client-plugin-compiler/src/index.ts",
	"packages/client-ui-sdk/src/stylex-tracer/panel.tsx",
	"plugins/stylex-tracer/client/page.tsx",
	"benchmarks/stylex-tracer/fixture/tailwind/page.tsx",
] as const;
const packagePaths = ["@stylexjs/stylex/package.json", "tailwindcss/package.json"] as const;
const repositoryRealpath = await realpath(repositoryRoot);
const manifest = await completeSourceManifest();
const lockfileSha256 = sha256(
	new Uint8Array(await Bun.file(`${repositoryRoot}/bun.lock`).arrayBuffer()),
);
const cacheRoots = {
	bunInstall: process.env.BUN_INSTALL_CACHE_DIR,
	xdg: process.env.XDG_CACHE_HOME,
	temporary: process.env.TMPDIR,
};
if (Object.values(cacheRoots).some((path) => path === undefined)) {
	throw new Error("BUN_INSTALL_CACHE_DIR, XDG_CACHE_HOME, and TMPDIR must be explicit");
}
const resolvedCacheRoots = Object.fromEntries(
	await Promise.all(
		Object.entries(cacheRoots).map(async ([name, path]) => [
			name,
			await realpath(resolve(path ?? "")),
		]),
	),
);

console.log(
	JSON.stringify({
		repositoryRoot: repositoryRealpath,
		revision: process.env.STYLEX_TRACER_REVISION ?? "unknown",
		bun: { version: Bun.version, revision: Bun.revision },
		lockfileSha256,
		dependencyFingerprint: compiler.STYLEX_TRACER_BUILD_FINGERPRINT,
		sourceManifest: manifest,
		treeIdentity: { kind: "source-manifest-sha256", value: manifest.sha256 },
		contentIdentity: sha256(
			JSON.stringify({
				manifest: manifest.sha256,
				lockfile: lockfileSha256,
				dependencyFingerprint: compiler.STYLEX_TRACER_BUILD_FINGERPRINT,
			}),
		),
		cacheRoots: resolvedCacheRoots,
		resolutions: {
			workspace: Object.fromEntries(
				await Promise.all(
					resolutionPaths.map(async (path) => {
						const physicalPath = await realpath(`${repositoryRoot}/${path}`);
						return [
							path,
							{
								physicalPath,
								containedInRoot: !relative(repositoryRealpath, physicalPath).startsWith(".."),
								sha256: sha256(new Uint8Array(await Bun.file(physicalPath).arrayBuffer())),
							},
						];
					}),
				),
			),
			packages: Object.fromEntries(
				await Promise.all(
					packagePaths.map(async (specifier) => {
						const physicalPath = await realpath(Bun.resolveSync(specifier, compilerRoot));
						return [
							specifier,
							{
								physicalPath,
								containedInRoot: !relative(repositoryRealpath, physicalPath).startsWith(".."),
								sha256: sha256(new Uint8Array(await Bun.file(physicalPath).arrayBuffer())),
							},
						];
					}),
				),
			),
		},
		apiVersion: contract.CLIENT_API_VERSION,
		variants: { stylex: await compile("stylex"), tailwind: await compile("tailwind") },
	}),
);
