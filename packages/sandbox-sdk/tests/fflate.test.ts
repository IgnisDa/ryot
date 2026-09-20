import { Effect } from "@ryot-app/sandbox-sdk/effect";
import {
	gzipSync,
	listZipEntries,
	readGzipRange,
	readZipEntryRange,
} from "@ryot-app/sandbox-sdk/fflate";
import { zipSync } from "fflate";
import { assert, afterEach, expect, test } from "vitest";

const filesystemKey = Symbol.for("@ryot-app/sandbox-sdk/filesystem");

afterEach(() => {
	Reflect.deleteProperty(globalThis, filesystemKey);
});

test("pages a large admitted archive and replays expanded ranges without whole artifact reads", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const content = new Uint8Array(8 * 1024 * 1024);
			for (let index = 0; index < content.length; index++) {
				content[index] = index % 251;
			}
			const archive = zipSync({
				"large.json": content,
				"other.json": new Uint8Array([9, 8]),
				"padding.bin": [new Uint8Array(49 * 1024 * 1024), { level: 0 }],
			});
			expect(archive.length).toBeGreaterThan(49 * 1024 * 1024);
			expect(archive.length).toBeLessThanOrEqual(50 * 1024 * 1024);
			const requests: number[] = [];
			Reflect.set(globalThis, filesystemKey, {
				readArtifactRange: (offset: number, length: number, key?: string) => {
					expect(key).toBe("export");
					requests.push(length);
					const bytes = archive.slice(offset, offset + length);
					return Promise.resolve({ bytes, size: archive.length });
				},
			});
			const first = yield* listZipEntries({ limit: 1, key: "export" });
			expect(first.entries.map((entry) => entry.name)).toEqual(["large.json"]);
			expect(first.next).not.toBeNull();
			const second = yield* listZipEntries({
				limit: 1,
				key: "export",
				after: first.next ?? undefined,
			});
			expect(second.entries.map((entry) => entry.name)).toEqual(["other.json"]);
			const padding = yield* listZipEntries({
				limit: 1,
				key: "export",
				after: second.next ?? undefined,
			});
			expect(padding.entries.map((entry) => entry.name)).toEqual(["padding.bin"]);
			expect(padding.next).toBeNull();
			const entry = first.entries[0];
			assert(entry);
			const page = yield* readZipEntryRange({
				entry,
				length: 4096,
				key: "export",
				offset: 5 * 1024 * 1024 + 17,
			});
			expect(page.bytes).toEqual(content.slice(5 * 1024 * 1024 + 17, 5 * 1024 * 1024 + 17 + 4096));
			expect(
				yield* readZipEntryRange({
					entry,
					length: 4096,
					key: "export",
					offset: 5 * 1024 * 1024 + 17,
				}),
			).toEqual(page);
			const last = yield* readZipEntryRange({
				entry,
				length: 100,
				key: "export",
				offset: content.length - 19,
			});
			expect(last.bytes).toEqual(content.slice(-19));
			expect(last.next).toBeNull();
			expect(
				(yield* Effect.flip(
					readZipEntryRange({
						length: 100,
						key: "export",
						offset: content.length - 20,
						entry: { ...entry, size: entry.size - 1 },
					}),
				)).message,
			).toBe("ZIP entry exceeds declared size");
			expect(Math.max(...requests)).toBeLessThanOrEqual(65557);
		}),
	));

test("bounds directory metadata even when entry names are large", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const archive = zipSync(
				Object.fromEntries(
					Array.from({ length: 5 }, (_, index) => [
						`${index}${"a".repeat(59999)}`,
						new Uint8Array(),
					]),
				),
			);
			Reflect.set(globalThis, filesystemKey, {
				readArtifactRange: (offset: number, length: number) =>
					Promise.resolve({ size: archive.length, bytes: archive.slice(offset, offset + length) }),
			});
			const first = yield* listZipEntries({});
			expect(first.entries).toHaveLength(4);
			expect(first.next).not.toBeNull();
			const second = yield* listZipEntries({ after: first.next ?? undefined });
			expect(second.entries).toHaveLength(1);
			expect(second.next).toBeNull();
		}),
	));

test("streams expanded gzip ranges, replays them, and uses exact artifact grants", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const content = new Uint8Array(8 * 1024 * 1024);
			for (let index = 0; index < content.length; index++) {
				content[index] = index % 251;
			}
			const compressed = gzipSync(content);
			const artifactKeys: Array<string | undefined> = [];
			const readLengths: number[] = [];
			const namedArtifacts = new Map<string, Uint8Array>([["myanimelist-export.gz", compressed]]);
			Reflect.set(globalThis, filesystemKey, {
				readArtifactRange: (offset: number, length: number, key?: string) => {
					artifactKeys.push(key);
					readLengths.push(length);
					const artifact = key === undefined ? compressed : namedArtifacts.get(key);
					return artifact
						? Promise.resolve({
								size: artifact.length,
								bytes: artifact.slice(offset, offset + length),
							})
						: Promise.reject(new Error("Sandbox artifact grant is unavailable"));
				},
			});

			const offset = 5 * 1024 * 1024 + 17;
			const page = yield* readGzipRange({ offset, length: 4096, key: "myanimelist-export.gz" });
			expect(page.bytes).toEqual(content.slice(offset, offset + 4096));
			expect(page.next).toBe(offset + 4096);
			expect(yield* readGzipRange({ offset, length: 4096, key: "myanimelist-export.gz" })).toEqual(
				page,
			);
			const last = yield* readGzipRange({
				length: 32,
				offset: content.length - 17,
				key: "myanimelist-export.gz",
			});
			expect(last).toEqual({ next: null, bytes: content.slice(-17) });
			const namedReadCount = artifactKeys.length;
			expect(yield* readGzipRange({ offset: 0, length: 32 })).toEqual({
				next: 32,
				bytes: content.slice(0, 32),
			});
			const missing = yield* Effect.flip(
				readGzipRange({ offset: 0, length: 1, key: "myanimelist-export.gz.backup" }),
			);
			expect(missing.message).toBe("Sandbox artifact grant is unavailable");
			expect(
				artifactKeys.slice(0, namedReadCount).every((key) => key === "myanimelist-export.gz"),
			).toBe(true);
			expect(artifactKeys.slice(namedReadCount, -1).every((key) => key === undefined)).toBe(true);
			expect(artifactKeys.at(-1)).toBe("myanimelist-export.gz.backup");
			expect(readLengths.every((length) => length <= 65536)).toBe(true);
		}),
	));

test("rejects invalid gzip ranges and malformed gzip data", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const compressed = gzipSync(new Uint8Array([1, 2, 3]));
			let calls = 0;
			Reflect.set(globalThis, filesystemKey, {
				readArtifactRange: (offset: number, length: number) => {
					calls++;
					return Promise.resolve({
						size: compressed.length,
						bytes: compressed.slice(offset, offset + length),
					});
				},
			});
			for (const [offset, length] of [
				[-1, 1],
				[Number.MAX_SAFE_INTEGER + 1, 1],
				[0, 0],
				[0, 1024 * 1024 + 1],
				[0.5, 1],
			]) {
				expect((yield* Effect.flip(readGzipRange({ offset, length }))).message).toBe(
					"Invalid GZIP range",
				);
			}
			expect(calls).toBe(0);
			expect((yield* Effect.flip(readGzipRange({ offset: 4, length: 1 }))).message).toBe(
				"GZIP range is past the expanded data end",
			);

			compressed[0] = 0;
			expect((yield* Effect.flip(readGzipRange({ offset: 0, length: 1 }))).message).toBe(
				"invalid gzip data",
			);
		}),
	));

test("rejects malformed archives and over-limit output pages", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			Reflect.set(globalThis, filesystemKey, {
				readArtifactRange: () => Promise.resolve({ size: 30, bytes: new Uint8Array(30) }),
			});
			expect((yield* Effect.flip(listZipEntries({}))).message).toBe("ZIP directory was not found");
			expect(
				(yield* Effect.flip(
					readZipEntryRange({
						offset: 0,
						length: 1024 * 1024 + 1,
						entry: { size: 0, name: "a", compression: 8, localOffset: 0, compressedSize: 0 },
					}),
				)).message,
			).toBe("Invalid ZIP entry range");
		}),
	));
