import { Effect } from "@ryot-app/sandbox-sdk/effect";
import {
	readArtifact,
	readArtifactRange,
	readNamedArtifact,
	writeScratchChunks,
} from "@ryot-app/sandbox-sdk/filesystem";
import { afterEach, expect, test } from "vitest";

const filesystemKey = Symbol.for("@ryot-app/sandbox-sdk/filesystem");

afterEach(() => {
	Reflect.deleteProperty(globalThis, filesystemKey);
});

test("fails closed when filesystem grants are unavailable", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const read = yield* Effect.flip(readArtifact);
			const readNamed = yield* Effect.flip(readNamedArtifact("historyFilePath"));
			const range = yield* Effect.flip(readArtifactRange(0, 1));
			const write = yield* Effect.flip(writeScratchChunks([]));

			expect(read.message).toBe("Sandbox artifact grant is unavailable");
			expect(readNamed.message).toBe("Sandbox artifact grant is unavailable");
			expect(range.message).toBe("Sandbox artifact grant is unavailable");
			expect(write.message).toBe("Sandbox scratch grant is unavailable");
		}),
	));

test("rejects invalid byte ranges before calling the binding", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			let calls = 0;
			Reflect.set(globalThis, filesystemKey, {
				readArtifactRange: () => {
					calls++;
					return Promise.resolve({ size: 0, bytes: new Uint8Array() });
				},
			});
			for (const [offset, length] of [
				[-1, 1],
				[0, 0],
				[0, 1048577],
				[0.5, 1],
			]) {
				expect((yield* Effect.flip(readArtifactRange(offset, length))).message).toContain(
					"Artifact range requires",
				);
			}
			expect(calls).toBe(0);
		}),
	));

test("reads the artifact and writes a batch of named chunks through the runner binding", () =>
	Effect.runPromise(
		Effect.gen(function* () {
			const writes: Array<{ readonly name: string; readonly contents: Uint8Array }> = [];
			Reflect.set(globalThis, filesystemKey, {
				readArtifact: () => Promise.resolve(new TextEncoder().encode("artifact")),
				readNamedArtifact: (key: string) =>
					Promise.resolve(new TextEncoder().encode(`named:${key}`)),
				writeScratchChunks: (
					chunks: ReadonlyArray<{ readonly name: string; readonly contents: Uint8Array }>,
				) => {
					writes.push(...chunks);
					return Promise.resolve();
				},
			});

			const artifact = yield* readArtifact;
			const namedArtifact = yield* readNamedArtifact("historyFilePath");
			const manifest = yield* writeScratchChunks([
				{ contents: "[0]", name: "chunk-0.json" },
				{ name: "chunk-1.bin", contents: new Uint8Array([1]) },
			]);

			expect(new TextDecoder().decode(artifact)).toBe("artifact");
			expect(new TextDecoder().decode(namedArtifact)).toBe("named:historyFilePath");
			expect(manifest).toEqual({ chunkFiles: ["chunk-0.json", "chunk-1.bin"] });
			expect(writes.map(({ name }) => name)).toEqual(["chunk-0.json", "chunk-1.bin"]);
			expect(new TextDecoder().decode(writes[0]?.contents)).toBe("[0]");
		}),
	));
