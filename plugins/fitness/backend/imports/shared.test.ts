import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { afterEach, expect, it } from "vitest";

import { readImportArtifactText } from "./shared";

const filesystemKey = Symbol.for("@ryot-app/sandbox-sdk/filesystem");

afterEach(() => {
	Reflect.deleteProperty(globalThis, filesystemKey);
});

it("reads the uploadToken named artifact used by every fitness importer", () => {
	const keys: string[] = [];
	Reflect.set(globalThis, filesystemKey, {
		writeScratchChunks: () => Promise.resolve(),
		readArtifact: () => Promise.reject(new Error("single artifact must not be read")),
		readNamedArtifact: (key: string) => {
			keys.push(key);
			return Promise.resolve(new TextEncoder().encode("upload contents"));
		},
	});

	return Effect.runPromise(
		readImportArtifactText().pipe(
			Effect.map((text) => {
				expect(text).toBe("upload contents");
				expect(keys).toEqual(["uploadToken"]);
				return text;
			}),
		),
	);
});
