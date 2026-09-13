import { gzipSync } from "node:zlib";

import { BunServices } from "@effect/platform-bun";
import { assert, expect, layer } from "@effect/vitest";
import { ServerLogsNotFound } from "@ryot-app/contract/modules/god-mode/logs";
import { Effect, FileSystem, Option, Path, Stream } from "effect";
import { unzipSync } from "fflate";

import { assertExitFails } from "#lib/test-utils/assertions";

import { makeServerLogs } from "./logs";

const activeName = "server.log";
const rotatedName = "20261001-1200-01-server.log.gz";
const encoder = new TextEncoder();

const withLogDirectory = <A, E, R>(
	run: (fs: FileSystem.FileSystem, path: Path.Path, directory: string) => Effect.Effect<A, E, R>,
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-server-logs-" });
			const directory = path.join(root, "logs");
			yield* fs.makeDirectory(directory);
			return yield* run(fs, path, directory);
		}),
	);

const concatenate = (chunks: ReadonlyArray<Uint8Array>) => {
	const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
};

const collectBytes = <E, R>(stream: Stream.Stream<Uint8Array, E, R>) =>
	Stream.runCollect(stream).pipe(Effect.map((chunks) => concatenate(Array.from(chunks))));

const notFound = () => new ServerLogsNotFound({ reason: { code: "log-file-unavailable" } });

layer(BunServices.layer)((test) => {
	test.effect("lists only regular active and matching rotated log files", () =>
		withLogDirectory((fs, path, directory) =>
			Effect.gen(function* () {
				const activeBytes = encoder.encode("active log");
				const rotatedBytes = new Uint8Array(gzipSync(encoder.encode("rotated log")));
				const outsideDirectory = path.join(directory, "..", "outside");
				const directoryEntry = "20261001-1200-02-server.log.gz";
				const symlinkEntry = "20261001-1200-03-server.log.gz";

				yield* fs.makeDirectory(outsideDirectory);
				yield* fs.writeFile(path.join(directory, activeName), activeBytes);
				yield* fs.writeFile(path.join(directory, rotatedName), rotatedBytes);
				yield* fs.writeFileString(path.join(directory, "server.log.stdout"), "ignored");
				yield* fs.writeFileString(path.join(directory, "server.log.stderr"), "ignored");
				yield* fs.writeFileString(path.join(directory, "server.log.txt"), "ignored");
				yield* fs.writeFileString(path.join(directory, "20261001-1200-01-other.log.gz"), "ignored");
				yield* fs.makeDirectory(path.join(directory, directoryEntry));
				yield* fs.writeFileString(path.join(outsideDirectory, "outside.log"), "outside");
				yield* fs.symlink(
					path.join(outsideDirectory, "outside.log"),
					path.join(directory, symlinkEntry),
				);

				const logs = yield* makeServerLogs(path.join(directory, activeName));
				const { files } = yield* logs.list(undefined, 100);
				expect(files.map((file) => file.name)).toEqual([activeName, rotatedName]);

				const active = files[0];
				const rotated = files[1];
				assert(active !== undefined);
				assert(rotated !== undefined);
				expect(active.active).toBe(true);
				expect(active.size).toBe(activeBytes.byteLength);
				const activeStat = yield* fs.stat(path.join(directory, activeName));
				expect(active.modifiedAt).toBe(Option.getOrThrow(activeStat.mtime).toISOString());
				expect(rotated.active).toBe(false);
				expect(rotated.size).toBe(rotatedBytes.byteLength);
				const rotatedStat = yield* fs.stat(path.join(directory, rotatedName));
				expect(rotated.modifiedAt).toBe(Option.getOrThrow(rotatedStat.mtime).toISOString());
			}),
		),
	);

	test.effect("lists log files in cursor pages without gaps or duplicates", () =>
		withLogDirectory((fs, path, directory) =>
			Effect.gen(function* () {
				const rotatedNames = [
					"20261001-1200-01-server.log.gz",
					"20261001-1200-02-server.log.gz",
					"20261001-1200-03-server.log.gz",
				];
				yield* fs.writeFileString(path.join(directory, activeName), "active");
				for (const name of rotatedNames) {
					yield* fs.writeFileString(path.join(directory, name), name);
				}

				const logs = yield* makeServerLogs(path.join(directory, activeName));
				const firstPage = yield* logs.list(undefined, 2);
				const nextCursor = firstPage.pageInfo.nextCursor;
				assert(nextCursor);
				const secondPage = yield* logs.list(nextCursor, 2);

				expect(firstPage.files.map((file) => file.name)).toEqual([activeName, rotatedNames[2]]);
				expect(firstPage.pageInfo).toEqual({
					limit: 2,
					hasMore: true,
					nextCursor: rotatedNames[2],
				});
				expect(secondPage.files.map((file) => file.name)).toEqual(
					rotatedNames.slice(0, 2).toReversed(),
				);
				expect(secondPage.pageInfo).toEqual({ limit: 2, hasMore: false, nextCursor: null });
			}),
		),
	);

	test.effect("downloads active and gzip files with their stored bytes and sizes", () =>
		withLogDirectory((fs, path, directory) =>
			Effect.gen(function* () {
				const activeBytes = encoder.encode("active bytes");
				const rotatedBytes = new Uint8Array(gzipSync(encoder.encode("gzip bytes")));
				yield* fs.writeFile(path.join(directory, activeName), activeBytes);
				yield* fs.writeFile(path.join(directory, rotatedName), rotatedBytes);

				const logs = yield* makeServerLogs(path.join(directory, activeName));
				const { files } = yield* logs.list(undefined, 100);
				const active = files.find((file) => file.name === activeName);
				const rotated = files.find((file) => file.name === rotatedName);
				assert(active !== undefined);
				assert(rotated !== undefined);

				const activeDownload = yield* logs.downloadFile(active.id);
				expect(activeDownload.fileName).toBe(activeName);
				expect(activeDownload.size).toBe(activeBytes.byteLength);
				expect(yield* collectBytes(activeDownload.stream)).toEqual(activeBytes);

				const rotatedDownload = yield* logs.downloadFile(rotated.id);
				expect(rotatedDownload.fileName).toBe(rotatedName);
				expect(rotatedDownload.size).toBe(rotatedBytes.byteLength);
				expect(yield* collectBytes(rotatedDownload.stream)).toEqual(rotatedBytes);
			}),
		),
	);

	test.effect("streams a ZIP of log files and a valid empty ZIP", () =>
		withLogDirectory((fs, path, directory) =>
			Effect.gen(function* () {
				const activeBytes = encoder.encode("active ZIP bytes");
				const rotatedBytes = new Uint8Array(gzipSync(encoder.encode("rotated ZIP bytes")));
				yield* fs.writeFile(path.join(directory, activeName), activeBytes);
				yield* fs.writeFile(path.join(directory, rotatedName), rotatedBytes);

				const logs = yield* makeServerLogs(path.join(directory, activeName));
				const archive = yield* logs.downloadAll();
				expect(archive.fileName).toMatch(/^ryot-server-logs-.*\.zip$/);
				const entries = unzipSync(yield* collectBytes(archive.stream));
				expect(Object.keys(entries).sort()).toEqual([activeName, rotatedName].sort());
				expect(entries[activeName]).toEqual(activeBytes);
				expect(entries[rotatedName]).toEqual(rotatedBytes);

				const emptyDirectory = path.join(directory, "empty");
				yield* fs.makeDirectory(emptyDirectory);
				const emptyLogs = yield* makeServerLogs(path.join(emptyDirectory, activeName));
				const emptyArchive = yield* emptyLogs.downloadAll();
				expect(Object.keys(unzipSync(yield* collectBytes(emptyArchive.stream)))).toEqual([]);
			}),
		),
	);

	test.effect("streams only the bytes present when the active file was snapshotted", () =>
		withLogDirectory((fs, path, directory) =>
			Effect.gen(function* () {
				const initialBytes = encoder.encode("initial bytes");
				yield* fs.writeFile(path.join(directory, activeName), initialBytes);
				const logs = yield* makeServerLogs(path.join(directory, activeName));
				const { files } = yield* logs.list(undefined, 100);
				const active = files[0];
				assert(active !== undefined);
				const snapshot = yield* logs.downloadFile(active.id);

				yield* fs.writeFileString(path.join(directory, activeName), " appended bytes", {
					flag: "a",
				});
				expect(yield* collectBytes(snapshot.stream)).toEqual(initialBytes);
			}),
		),
	);

	test.effect("keeps an open snapshot after rotation and rejects its old id for the new file", () =>
		withLogDirectory((fs, path, directory) =>
			Effect.gen(function* () {
				const initialBytes = encoder.encode("before rotation");
				const activePath = path.join(directory, activeName);
				yield* fs.writeFile(activePath, initialBytes);
				const logs = yield* makeServerLogs(activePath);
				const { files } = yield* logs.list(undefined, 100);
				const active = files[0];
				assert(active !== undefined);
				const snapshot = yield* logs.downloadFile(active.id);

				yield* fs.rename(activePath, path.join(directory, "server.log.1"));
				yield* fs.writeFileString(activePath, "after rotation");
				expect(yield* collectBytes(snapshot.stream)).toEqual(initialBytes);

				const replacement = yield* Effect.exit(logs.downloadFile(active.id));
				assertExitFails(replacement, notFound());
			}),
		),
	);

	test.effect("rejects invalid ids and fails a truncated snapshot during stream consumption", () =>
		withLogDirectory((fs, path, directory) =>
			Effect.gen(function* () {
				const activePath = path.join(directory, activeName);
				yield* fs.writeFile(activePath, encoder.encode("truncated snapshot"));
				const logs = yield* makeServerLogs(activePath);
				const { files } = yield* logs.list(undefined, 100);
				const active = files[0];
				assert(active !== undefined);

				const invalid = yield* Effect.exit(logs.downloadFile("invalid-id"));
				assertExitFails(invalid, notFound());
				const pathLike = yield* Effect.exit(logs.downloadFile("../server.log"));
				assertExitFails(pathLike, notFound());

				const snapshot = yield* logs.downloadFile(active.id);
				yield* fs.truncate(activePath, 0);
				const truncated = yield* Effect.exit(collectBytes(snapshot.stream));
				assertExitFails(truncated, notFound());
			}),
		),
	);
});
