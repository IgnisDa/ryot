import { BunServices } from "@effect/platform-bun";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { expect } from "vitest";

import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { SandboxArtifactStore } from "./artifacts";

const makeStoreLayer = (root: string) =>
	SandboxArtifactStore.layer.pipe(
		Layer.provide(
			Layer.merge(BunServices.layer, makeAppConfigLayer({ fileStorage: { localTempDir: root } })),
		),
	);

const withArtifactStore = <A, E>(
	use: (
		root: string,
	) => Effect.Effect<A, E, SandboxArtifactStore | FileSystem.FileSystem | Path.Path>,
) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const temporaryRoot = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-sandbox-artifacts-" });
		const root = yield* fs.realPath(temporaryRoot);
		return yield* use(root).pipe(Effect.provide(makeStoreLayer(root)));
	}).pipe(Effect.provide(BunServices.layer));

it.effect("materializes immutable content-addressed input grants", () =>
	withArtifactStore((root) =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const store = yield* SandboxArtifactStore;
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
	),
);

it.effect("keeps opaque output handles while any workflow reference remains", () =>
	withArtifactStore((root) =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const store = yield* SandboxArtifactStore;
			const source = path.join(root, "chunk.json");
			yield* fs.writeFileString(source, '{"items":[]}');
			yield* store.retain("workflow-1", "workflow-1");
			yield* store.retain("workflow-1", "child-1");

			const first = yield* store.materializeOutputs("workflow-1", [source]);
			const second = yield* store.materializeOutputs("workflow-1", [source]);
			expect(first).toEqual(second);
			expect(first[0]).not.toContain(root);
			const [stored] = yield* store.resolveOutputs("workflow-1", first);
			if (stored === undefined) {
				throw new Error("Output handle did not resolve");
			}
			expect(yield* fs.readFileString(stored)).toBe('{"items":[]}');
			expect((yield* Effect.exit(store.resolveOutputs("workflow-2", first)))._tag).toBe("Failure");
			expect(
				yield* Effect.gen(function* () {
					const restarted = yield* SandboxArtifactStore;
					return yield* restarted.resolveOutputs("workflow-1", first);
				}).pipe(Effect.provide(makeStoreLayer(root))),
			).toEqual([stored]);

			yield* store.release("workflow-1", "workflow-1");
			expect(yield* store.resolveOutputs("workflow-1", first)).toEqual([stored]);
			yield* store.release("workflow-1", "child-1");
			expect((yield* Effect.exit(store.resolveOutputs("workflow-1", first)))._tag).toBe("Failure");
		}),
	),
);

it.effect("rejects symlinked input artifacts before publishing grants", () =>
	withArtifactStore((root) =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const store = yield* SandboxArtifactStore;
			const source = path.join(root, "source.csv");
			const linked = path.join(root, "linked.csv");
			yield* fs.writeFileString(source, "content");
			yield* fs.symlink(source, linked);

			const result = yield* Effect.exit(
				store.materializeInputs("workflow-1", "orchestrator-1", { artifactPath: linked }),
			);
			expect(result._tag).toBe("Failure");
		}),
	),
);

it.effect("rejects input artifacts beneath a symlinked ancestor", () =>
	withArtifactStore((root) =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const store = yield* SandboxArtifactStore;
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
	),
);
