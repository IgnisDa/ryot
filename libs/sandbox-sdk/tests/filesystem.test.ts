import { Effect } from "@ryot/sandbox-sdk/effect";
import { readArtifact, writeScratchChunks } from "@ryot/sandbox-sdk/filesystem";
import { afterEach, expect, test } from "vitest";

const filesystemKey = Symbol.for("@ryot/sandbox-sdk/filesystem");

afterEach(() => {
	Reflect.deleteProperty(globalThis, filesystemKey);
});

test("fails closed when filesystem grants are unavailable", async () => {
	const read = await Effect.runPromise(Effect.flip(readArtifact()));
	const write = await Effect.runPromise(Effect.flip(writeScratchChunks([])));

	expect(read.message).toBe("Sandbox artifact grant is unavailable");
	expect(write.message).toBe("Sandbox scratch grant is unavailable");
});

test("reads the artifact and writes a batch of named chunks through the runner binding", async () => {
	const writes: Array<{ readonly name: string; readonly contents: Uint8Array }> = [];
	Reflect.set(globalThis, filesystemKey, {
		readArtifact: () => Promise.resolve(new TextEncoder().encode("artifact")),
		writeScratchChunks: (
			chunks: ReadonlyArray<{ readonly name: string; readonly contents: Uint8Array }>,
		) => {
			writes.push(...chunks);
			return Promise.resolve();
		},
	});

	const artifact = await Effect.runPromise(readArtifact());
	const manifest = await Effect.runPromise(
		writeScratchChunks([
			{ name: "chunk-0.json", contents: "[0]" },
			{ name: "chunk-1.bin", contents: new Uint8Array([1]) },
		]),
	);

	expect(new TextDecoder().decode(artifact)).toBe("artifact");
	expect(manifest).toEqual({ chunkFiles: ["chunk-0.json", "chunk-1.bin"] });
	expect(writes.map(({ name }) => name)).toEqual(["chunk-0.json", "chunk-1.bin"]);
	expect(new TextDecoder().decode(writes[0]?.contents)).toBe("[0]");
});
