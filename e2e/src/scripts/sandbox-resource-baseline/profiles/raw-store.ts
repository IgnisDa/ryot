import { chmod, mkdir, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { Data, Effect } from "effect";

/**
 * Raw profiles can hold provider responses and identifiers, so every operation here refuses paths
 * inside a git checkout and keeps the directory and files owner-only.
 */
export class RawStoreError extends Data.TaggedError("RawStoreError")<{
	readonly path: string;
	readonly reason: string;
	readonly cause?: unknown;
}> {}

const attempt = <A>(path: string, reason: string, run: () => Promise<A>) =>
	Effect.tryPromise({ try: run, catch: (cause) => new RawStoreError({ path, cause, reason }) });

const exists = (path: string) =>
	stat(path).then(
		() => true,
		() => false,
	);

/** Resolves symlinks through the nearest existing ancestor so a link into a checkout is caught. */
const canonicalPath = async (path: string): Promise<string> => {
	if (await exists(path)) {
		return realpath(path);
	}
	const parent = dirname(path);
	return parent === path ? path : join(await canonicalPath(parent), relative(parent, path));
};

const enclosingRepository = async (directory: string): Promise<string | null> => {
	if (await exists(join(directory, ".git"))) {
		return directory;
	}
	const parent = dirname(directory);
	return parent === directory ? null : enclosingRepository(parent);
};

export const findEnclosingRepository = (path: string) =>
	attempt(path, "could not resolve the path", async () =>
		enclosingRepository(await canonicalPath(resolve(path))),
	);

const ensureOutsideRepository = (path: string) =>
	findEnclosingRepository(path).pipe(
		Effect.flatMap((repository) =>
			repository === null
				? Effect.void
				: Effect.fail(
						new RawStoreError({
							path,
							reason: "raw profiles must stay outside the git repository",
						}),
					),
		),
	);

const verifyMode = (path: string, expected: number) =>
	attempt(path, "could not read the mode", () => stat(path)).pipe(
		Effect.flatMap((stats) =>
			(stats.mode & 0o777) === expected
				? Effect.void
				: Effect.fail(
						new RawStoreError({
							path,
							reason: `mode is ${(stats.mode & 0o777).toString(8)}, expected ${expected.toString(8)}`,
						}),
					),
		),
	);

export const createRestrictedDirectory = (path: string) =>
	ensureOutsideRepository(path).pipe(
		Effect.andThen(
			attempt(path, "could not create the directory", async () => {
				await mkdir(path, { mode: 0o700, recursive: true });
				await chmod(path, 0o700);
			}),
		),
		Effect.andThen(verifyMode(path, 0o700)),
	);

export const writeRestrictedFile = (path: string, contents: string | Uint8Array) =>
	ensureOutsideRepository(path).pipe(
		Effect.andThen(
			attempt(path, "could not write the file", async () => {
				await writeFile(path, contents, { mode: 0o600 });
				await chmod(path, 0o600);
			}),
		),
		Effect.andThen(verifyMode(path, 0o600)),
	);

export type RawFile = { readonly relativePath: string; readonly bytes: number };

const walk = async (root: string, directory: string): Promise<Array<RawFile>> => {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				return walk(root, path);
			}
			const { size } = await stat(path);
			return [{ bytes: size, relativePath: relative(root, path) }];
		}),
	);
	return nested.flat().sort((left, right) => left.relativePath.localeCompare(right.relativePath));
};

export const listRawFiles = (directory: string) =>
	ensureOutsideRepository(directory).pipe(
		Effect.andThen(
			attempt(directory, "could not list the directory", () => walk(directory, directory)),
		),
	);

export type RawDeletion = {
	readonly deleted: boolean;
	readonly bytesDeleted: number;
	readonly remainingEntries: number;
};

const totalBytes = (files: ReadonlyArray<RawFile>) =>
	files.reduce((total, file) => total + file.bytes, 0);

/** Deletes the whole raw directory, then confirms it is gone rather than trusting `rm`. */
export const deleteRawProfiles = (directory: string) =>
	Effect.gen(function* () {
		const before = yield* listRawFiles(directory);
		yield* attempt(directory, "could not delete the directory", () =>
			rm(directory, { force: true, recursive: true }),
		);
		const stillExists = yield* attempt(directory, "could not verify deletion", () =>
			exists(directory),
		);
		const remaining = stillExists ? yield* listRawFiles(directory) : [];
		return {
			deleted: !stillExists,
			remainingEntries: remaining.length,
			bytesDeleted: totalBytes(before) - totalBytes(remaining),
		} satisfies RawDeletion;
	});
