import { BunServices } from "@effect/platform-bun";
import { layer } from "@effect/vitest";
import { sha256Base64Url, sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { expect } from "vitest";

import { ExecutionFileStore } from "./execution-files";
import { makeSandboxHostConfigLayer } from "./host.test-support";

class ArtifactRoot extends Context.Service<ArtifactRoot, string>()("test/ArtifactRoot") {}

const artifactStoreLayer = Layer.unwrap(
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const temporaryRoot = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-sandbox-artifacts-" });
		const root = yield* fs.realPath(temporaryRoot);
		return ExecutionFileStore.layer.pipe(
			Layer.provideMerge(makeSandboxHostConfigLayer({ tempDirectory: root })),
			Layer.merge(Layer.succeed(ArtifactRoot, root)),
		);
	}),
).pipe(Layer.provideMerge(BunServices.layer));

layer(artifactStoreLayer)((test) => {
	test.effect(
		"preserves ordered owner-derived handles and immutable bytes for an output batch",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const store = yield* ExecutionFileStore;
				const first = new Uint8Array([1, 2, 3]);
				const outputs = [first, new Uint8Array(), new Uint8Array([4, 5]), first];
				const expected = outputs.map((bytes) =>
					sha256Base64Url(`batch-owner\0${sha256Hex(bytes)}`),
				);
				const handles = yield* store.materializeOutputs("batch-owner", outputs);
				expect(handles).toEqual(expected);
				expect(yield* store.materializeOutputs("batch-owner", outputs)).toEqual(expected);
				first.fill(0);
				const paths = yield* store.resolveOutputs("batch-owner", handles);
				expect(
					yield* Effect.forEach(paths, (target) =>
						fs.readFile(target).pipe(Effect.map(Array.from)),
					),
				).toEqual([[1, 2, 3], [], [4, 5], [1, 2, 3]]);
				expect((yield* Effect.exit(store.resolveOutputs("other-owner", handles)))._tag).toBe(
					"Failure",
				);
			}),
	);

	test.effect("materializes immutable content-addressed input grants", () =>
		Effect.gen(function* () {
			const root = yield* ArtifactRoot;
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const store = yield* ExecutionFileStore;
			const first = path.join(root, "first.csv");
			const second = path.join(root, "second.csv");
			yield* fs.writeFileString(first, "same content");
			yield* fs.writeFileString(second, "same content");

			const grants = yield* store.materializeInputs("workflow-1", "orchestrator-1", {
				artifactPath: first,
				namedArtifactPaths: { history: second },
			});

			expect(grants.artifactOwnerExecutionId).toBe("workflow-1");
			expect(grants.artifactPath).toBe(grants.namedArtifactPaths?.["history"]);
			expect(grants.artifactPath).not.toBe(first);
			if (grants.artifactPath === undefined) {
				throw new Error("Artifact path was not materialized");
			}
			expect(yield* fs.readFileString(grants.artifactPath)).toBe("same content");
		}),
	);
});

layer(artifactStoreLayer)((test) => {
	test.effect("keeps opaque output handles while any workflow reference remains", () =>
		Effect.gen(function* () {
			const root = yield* ArtifactRoot;
			const fs = yield* FileSystem.FileSystem;
			const store = yield* ExecutionFileStore;
			const bytes = new TextEncoder().encode('{"items":[]}');
			yield* store.retain("workflow-1", "workflow-1");
			yield* store.retain("workflow-1", "child-1");

			const first = yield* store.materializeOutputs("workflow-1", [bytes]);
			const second = yield* store.materializeOutputs("workflow-1", [bytes]);
			expect(first).toEqual(second);
			expect(first[0]).not.toContain(root);
			const [stored] = yield* store.resolveOutputs("workflow-1", first);
			if (stored === undefined) {
				throw new Error("Output handle did not resolve");
			}
			expect(yield* fs.readFileString(stored)).toBe('{"items":[]}');
			expect((yield* Effect.exit(store.resolveOutputs("workflow-2", first)))._tag).toBe("Failure");
			const restarted = yield* ExecutionFileStore.make;
			expect(yield* restarted.resolveOutputs("workflow-1", first)).toEqual([stored]);

			yield* store.release("workflow-1", "workflow-1");
			expect(yield* store.resolveOutputs("workflow-1", first)).toEqual([stored]);
			yield* store.release("workflow-1", "child-1");
			expect((yield* Effect.exit(store.resolveOutputs("workflow-1", first)))._tag).toBe("Failure");
		}),
	);
});

layer(artifactStoreLayer)((test) => {
	test.effect("rejects symlinked input artifacts before publishing grants", () =>
		Effect.gen(function* () {
			const root = yield* ArtifactRoot;
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const store = yield* ExecutionFileStore;
			const source = path.join(root, "source.csv");
			const linked = path.join(root, "linked.csv");
			yield* fs.writeFileString(source, "content");
			yield* fs.symlink(source, linked);

			const result = yield* Effect.exit(
				store.materializeInputs("workflow-1", "orchestrator-1", { artifactPath: linked }),
			);
			expect(result._tag).toBe("Failure");
		}),
	);
});

layer(artifactStoreLayer)((test) => {
	test.effect("rejects input artifacts beneath a symlinked ancestor", () =>
		Effect.gen(function* () {
			const root = yield* ArtifactRoot;
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const store = yield* ExecutionFileStore;
			const outside = yield* fs.makeTempDirectory({ prefix: "ryot-artifact-outside-" });
			const source = path.join(outside, "source.csv");
			const linkedDirectory = path.join(root, "linked");
			yield* fs.writeFileString(source, "content");
			yield* fs.symlink(outside, linkedDirectory);

			const result = yield* Effect.exit(
				store.materializeInputs("workflow-1", "orchestrator-1", {
					artifactPath: path.join(linkedDirectory, "source.csv"),
				}),
			);
			expect(result._tag).toBe("Failure");
			yield* fs.remove(outside, { force: true, recursive: true });
		}),
	);
});
