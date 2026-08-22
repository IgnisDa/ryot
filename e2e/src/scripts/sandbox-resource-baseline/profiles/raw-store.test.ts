import { mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import { describe, expect, it } from "~/support/effect-test";

import {
	createRestrictedDirectory,
	deleteRawProfiles,
	listRawFiles,
	writeRestrictedFile,
} from "./raw-store";

const temporaryRoot = Effect.acquireRelease(
	Effect.promise(() => mkdtemp(join(tmpdir(), "ryot-raw-store-"))),
	(root) => Effect.promise(() => rm(root, { force: true, recursive: true })),
);
const modeOf = (path: string) =>
	Effect.promise(() => stat(path)).pipe(Effect.map(({ mode }) => mode & 0o777));

describe("raw profile store", () => {
	it.live("refuses a directory inside the git repository", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				createRestrictedDirectory(join(import.meta.dirname, "raw-profiles-must-not-exist")),
			);

			expect(error.reason).toBe("raw profiles must stay outside the git repository");
		}),
	);

	it.live("refuses a directory that reaches the repository through a symlink", () =>
		Effect.gen(function* () {
			const root = yield* temporaryRoot;
			const link = join(root, "linked");
			yield* Effect.promise(() => symlink(import.meta.dirname, link));

			const error = yield* Effect.flip(listRawFiles(link));

			expect(error.reason).toBe("raw profiles must stay outside the git repository");
		}),
	);

	it.live("keeps raw files owner-only and verifies deletion", () =>
		Effect.gen(function* () {
			const directory = join(yield* temporaryRoot, "raw");
			const nested = join(directory, "ytm-search-cpu-1", "attempt-1");
			yield* createRestrictedDirectory(nested);
			yield* writeRestrictedFile(join(nested, "profile.cpuprofile"), "0123456789");
			yield* writeRestrictedFile(join(directory, "ytm-search-cpu-1", "meta.json"), "{}");

			expect(yield* modeOf(nested)).toBe(0o700);
			expect(yield* modeOf(join(nested, "profile.cpuprofile"))).toBe(0o600);
			expect(yield* listRawFiles(directory)).toEqual([
				{ bytes: 10, relativePath: join("ytm-search-cpu-1", "attempt-1", "profile.cpuprofile") },
				{ bytes: 2, relativePath: join("ytm-search-cpu-1", "meta.json") },
			]);
			expect(yield* deleteRawProfiles(directory)).toEqual({
				deleted: true,
				bytesDeleted: 12,
				remainingEntries: 0,
			});
			expect(
				yield* Effect.promise(() =>
					stat(directory).then(
						() => true,
						() => false,
					),
				),
			).toBe(false);
		}),
	);
});
