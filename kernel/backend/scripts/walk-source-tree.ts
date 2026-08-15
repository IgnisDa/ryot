import { Data, Effect, FileSystem, Path } from "effect";
import type { PlatformError } from "effect/PlatformError";

export interface SourceWalkLimits {
	readonly maxDepth: number;
	readonly maxFiles: number;
	readonly maxTotalBytes: number;
}

export class SourceWalkError extends Data.TaggedError("SourceWalkError")<{
	readonly path: string;
	readonly message: string;
	readonly reason: "depth-limit" | "file-limit" | "size-limit" | "symbolic-link";
}> {}

export type SourceWalkBudget = { files: number; totalBytes: number };

export const createSourceWalkBudget = (): SourceWalkBudget => ({ files: 0, totalBytes: 0 });

export const unboundedSourceWalkLimits: SourceWalkLimits = {
	maxDepth: Number.MAX_SAFE_INTEGER,
	maxFiles: Number.MAX_SAFE_INTEGER,
	maxTotalBytes: Number.MAX_SAFE_INTEGER,
};

const walkError = (reason: SourceWalkError["reason"], path: string, message: string) =>
	new SourceWalkError({ path, reason, message });

const rejectSymbolicLink = (file: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const target = yield* fs.readLink(file).pipe(Effect.option);
		if (target._tag === "Some") {
			return yield* walkError(
				"symbolic-link",
				file,
				`Source walk input must not be a symbolic link: ${file}`,
			);
		}
		return undefined;
	});

const chargeBudget = (
	file: string,
	size: number,
	limits: SourceWalkLimits,
	budget: SourceWalkBudget,
) =>
	Effect.gen(function* () {
		if (budget.files >= limits.maxFiles) {
			return yield* walkError(
				"file-limit",
				file,
				`Source walk exceeds the ${limits.maxFiles} file limit at: ${file}`,
			);
		}
		if (budget.totalBytes + size > limits.maxTotalBytes) {
			return yield* walkError(
				"size-limit",
				file,
				`Source walk exceeds the ${limits.maxTotalBytes} byte limit at: ${file}`,
			);
		}
		budget.files += 1;
		budget.totalBytes += size;
		return undefined;
	});

export const readSourceWithin = (
	file: string,
	limits: SourceWalkLimits,
	budget: SourceWalkBudget,
): Effect.Effect<string, PlatformError | SourceWalkError, FileSystem.FileSystem> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		yield* rejectSymbolicLink(file);
		const info = yield* fs.stat(file);
		yield* chargeBudget(file, Number(info.size), limits, budget);
		return yield* fs.readFileString(file);
	});

export interface SourceWalkOptions {
	readonly limits?: SourceWalkLimits | undefined;
	readonly budget?: SourceWalkBudget | undefined;
}

export const walkSourcePaths = (
	directory: string,
	include: (absolutePath: string) => boolean,
	options: SourceWalkOptions = {},
): Effect.Effect<
	ReadonlyArray<string>,
	PlatformError | SourceWalkError,
	FileSystem.FileSystem | Path.Path
> => {
	const limits = options.limits ?? unboundedSourceWalkLimits;
	const budget = options.budget ?? createSourceWalkBudget();
	const walk = (
		current: string,
		depth: number,
	): Effect.Effect<
		ReadonlyArray<string>,
		PlatformError | SourceWalkError,
		FileSystem.FileSystem | Path.Path
	> =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			yield* rejectSymbolicLink(current);
			const paths: string[] = [];
			for (const entry of (yield* fs.readDirectory(current)).sort()) {
				const absolutePath = path.join(current, entry);
				const info = yield* fs.stat(absolutePath);
				if (info.type === "Directory") {
					if (depth >= limits.maxDepth) {
						return yield* walkError(
							"depth-limit",
							absolutePath,
							`Source walk exceeds the ${limits.maxDepth} directory depth limit at: ${absolutePath}`,
						);
					}
					paths.push(...(yield* walk(absolutePath, depth + 1)));
					continue;
				}
				if (!include(absolutePath)) {
					continue;
				}
				yield* rejectSymbolicLink(absolutePath);
				yield* chargeBudget(absolutePath, Number(info.size), limits, budget);
				paths.push(absolutePath);
			}
			return paths;
		});
	return walk(directory, 0);
};

export const walkSourceFiles = (
	directory: string,
	root: string,
	include: (absolutePath: string) => boolean,
	options: SourceWalkOptions = {},
) =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const paths = yield* walkSourcePaths(directory, include, options);
		const files: Record<string, string> = {};
		for (const absolutePath of paths) {
			const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
			files[relativePath] = yield* fs.readFileString(absolutePath);
		}
		return files;
	});
