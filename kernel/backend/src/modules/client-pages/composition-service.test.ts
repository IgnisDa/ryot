import { assert, expect, layer } from "@effect/vitest";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Exit, Layer, Ref } from "effect";

import { ImageClientArtifacts } from "#modules/client-artifacts/image-artifacts";
import { ClientArtifactStore } from "#modules/client-artifacts/store";

import type { composeClientPage } from "./composition";
import { ClientPageCompositionService } from "./composition-service";
import { ClientPagesRepository } from "./repository";
import { descriptions, identity } from "./test-fixtures";

const createdAt = new Date(0);

const graphIdentity = identity();
const graph = {
	identity: graphIdentity,
	compositionKey: sha256Hex(stableStringify(graphIdentity)),
};
const files = descriptions();

type CompositionRow = {
	compositionHash: string;
	compositionKey: string;
	identity: typeof graphIdentity;
	manifest: ReturnType<typeof composeClientPage>;
	createdAt: Date;
};

class FakeCompositionRepository extends Context.Service<
	FakeCompositionRepository,
	{
		readonly writes: Effect.Effect<ReadonlyArray<string>>;
		readonly replaceRow: (row: CompositionRow) => Effect.Effect<void>;
	}
>()("test/FakeCompositionRepository") {}

const fakeRepositoryLayer = Layer.effectContext(
	Effect.gen(function* () {
		const row = yield* Ref.make<CompositionRow | null>(null);
		const writes = yield* Ref.make<ReadonlyArray<string>>([]);
		return Context.make(
			ClientPagesRepository,
			ClientPagesRepository.of(
				Object.assign(Object.create(null), {
					findComposition: () => Ref.get(row),
					createComposition: (input: Omit<CompositionRow, "createdAt">) =>
						Ref.update(writes, (all) => [...all, input.compositionKey]).pipe(
							Effect.andThen(Ref.set(row, { ...input, createdAt })),
							Effect.as(input.compositionKey),
						),
				}),
			),
		).pipe(
			Context.add(FakeCompositionRepository, {
				writes: Ref.get(writes),
				replaceRow: (next) => Ref.set(row, next),
			}),
		);
	}),
);

const compositionLayer = ClientPageCompositionService.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			Layer.succeed(
				ImageClientArtifacts,
				ImageClientArtifacts.of(
					Object.assign(Object.create(null), {
						runtime: { entries: { sdk: "runtime.js", bootstrap: "bootstrap.js" } },
					}),
				),
			),
			Layer.succeed(
				ClientArtifactStore,
				ClientArtifactStore.of({
					isPublic: () => true,
					findFile: () => Effect.succeed(null),
					exists: (hash) => Effect.succeed(files.has(hash)),
					describe: (hash) => {
						if (!files.has(hash)) {
							return Effect.succeed(null);
						}
						const description = files.get(hash);
						assert(description);
						return Effect.succeed({
							...description,
							hash,
							format: 1,
							apiVersion: 1,
							bridgeVersion: 1,
							compilerVersion: 1,
						});
					},
				}),
			),
			fakeRepositoryLayer,
		),
	),
);

layer(compositionLayer)((test) => {
	test.effect("persists only an immutable composition manifest and detects key conflicts", () =>
		Effect.gen(function* () {
			const repository = yield* FakeCompositionRepository;
			const compositions = yield* ClientPageCompositionService;
			const stored = yield* compositions.materialize(graph);
			expect(yield* repository.writes).toEqual([graph.compositionKey]);
			expect(stored.compositionHash).toBe(sha256Hex(stableStringify(stored.manifest)));
			expect(stored.manifest.imports["sdk"]).toEqual({
				file: "runtime.js",
				artifactHash: "a".repeat(64),
			});
			expect(Object.keys(stored.manifest).sort()).toEqual([
				"bootstrap",
				"descriptor",
				"identity",
				"imports",
			]);
			yield* compositions.materialize(graph);
			expect(yield* repository.writes).toEqual([graph.compositionKey]);
			yield* repository.replaceRow({ ...stored, compositionHash: "changed" });
			expect(Exit.isFailure(yield* Effect.exit(compositions.materialize(graph)))).toBe(true);
		}),
	);
});
