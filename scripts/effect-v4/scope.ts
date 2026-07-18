import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SCOPE_ROOTS = [
	"apps/app-backend",
	"apps/app-client",
	"apps/website",
	"apps/browser-extension",
	"libs/contract",
	"libs/config",
	"libs/sandbox-sdk",
	"libs/plugin-kit",
	"libs/sandbox-compiler",
	"plugins/fitness",
	"plugins/media",
	"tests",
] as const;

export const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"] as const;
export const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const GENERATED_FILES = new Set(["runner.generated.ts"]);
const SOURCE_EXTENSION_SET = new Set<string>(SOURCE_EXTENSIONS);
const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".turbo", "dist", "build", "coverage"]);

const isWithin = (parent: string, candidate: string) => {
	const path = relative(parent, candidate);
	return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
};

const getScopeRoot = (rootDir: string, candidate: string) =>
	SCOPE_ROOTS.map((root) => resolve(rootDir, root)).find((root) => isWithin(root, candidate));

export const isInScopePath = (rootDir: string, candidate: string) => {
	const path = resolve(candidate);
	const scopeRoot = getScopeRoot(resolve(rootDir), path);
	if (!scopeRoot || GENERATED_FILES.has(basename(path))) return false;

	return !relative(scopeRoot, path)
		.split(sep)
		.some((part) => EXCLUDED_DIRECTORIES.has(part));
};

export const isSourcePath = (rootDir: string, candidate: string) =>
	isInScopePath(rootDir, candidate) && SOURCE_EXTENSION_SET.has(extname(candidate));

export const toRepositoryPath = (rootDir: string, candidate: string) =>
	relative(resolve(rootDir), resolve(candidate)).split(sep).join("/");

const isCanonicalInScope = async (rootDir: string, canonicalRoot: string, candidate: string) => {
	const scopeRoot = getScopeRoot(rootDir, candidate);
	if (!scopeRoot) return false;

	const [canonicalCandidate, canonicalScopeRoot] = await Promise.all([
		realpath(candidate),
		realpath(scopeRoot),
	]);
	return (
		isInScopePath(canonicalRoot, canonicalCandidate) &&
		isWithin(canonicalRoot, canonicalCandidate) &&
		isWithin(canonicalRoot, canonicalScopeRoot) &&
		isWithin(canonicalScopeRoot, canonicalCandidate)
	);
};

const readStats = async (path: string) => {
	try {
		return await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
};

const visitDirectory = async (
	rootDir: string,
	canonicalRoot: string,
	directory: string,
	files: string[],
) => {
	const entries = await readdir(directory, { withFileTypes: true });
	entries.sort((left, right) => left.name.localeCompare(right.name));

	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isSymbolicLink()) continue;
		if (entry.isDirectory()) {
			if (
				isInScopePath(rootDir, path) &&
				(await isCanonicalInScope(rootDir, canonicalRoot, path))
			) {
				await visitDirectory(rootDir, canonicalRoot, path, files);
			}
		} else if (
			entry.isFile() &&
			isSourcePath(rootDir, path) &&
			(await isCanonicalInScope(rootDir, canonicalRoot, path))
		) {
			files.push(path);
		}
	}
};

export const discoverSourceFiles = async (
	rootDir = REPOSITORY_ROOT,
	explicitPaths: readonly string[] = [],
) => {
	const root = resolve(rootDir);
	const canonicalRoot = await realpath(root);
	const targets = explicitPaths.length
		? explicitPaths.map((path) => resolve(root, path))
		: SCOPE_ROOTS.map((path) => resolve(root, path));

	if (explicitPaths.length) {
		for (const target of targets) {
			if (!isInScopePath(root, target)) {
				throw new Error(`Explicit path is outside Effect v4 scope: ${target}`);
			}
		}
	}

	const files: string[] = [];
	for (const target of targets) {
		const stats = await readStats(target);
		if (!stats) {
			if (explicitPaths.length) throw new Error(`Explicit path does not exist: ${target}`);
			continue;
		}
		if (stats.isSymbolicLink()) {
			if (explicitPaths.length) throw new Error(`Explicit path cannot be a symlink: ${target}`);
			continue;
		}
		if (!(await isCanonicalInScope(root, canonicalRoot, target))) {
			if (explicitPaths.length) {
				throw new Error(`Explicit path is outside Effect v4 scope: ${target}`);
			}
			continue;
		}
		if (stats.isDirectory()) {
			await visitDirectory(root, canonicalRoot, target, files);
		} else if (stats.isFile() && isSourcePath(root, target)) {
			files.push(target);
		}
	}

	return [...new Set(files)].sort();
};
