import { assert, expect, it } from "@effect/vitest";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Exit, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import { ImageClientArtifacts } from "#modules/client-artifacts/image-artifacts";
import { ClientArtifactStore } from "#modules/client-artifacts/store";

import type { composeClientPage } from "./composition";
import { ClientPageCompositionService } from "./composition-service";
import { ClientPagesRepository } from "./repository";
import { descriptions, identity } from "./test-fixtures";

const createdAt = new Date(0);

it.effect("persists only an immutable composition manifest and detects key conflicts", () => {
	const graphIdentity = identity();
	const graph = {
		identity: graphIdentity,
		compositionKey: sha256Hex(stableStringify(graphIdentity)),
	};
	const files = descriptions();
	let row: {
		compositionHash: string;
		compositionKey: string;
		identity: typeof graphIdentity;
		manifest: ReturnType<typeof composeClientPage>;
		createdAt: Date;
	} | null = null;
	const writes: string[] = [];
	const layers = ClientPageCompositionService.layer.pipe(
		Layer.provide(
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
				Layer.succeed(
					ClientPagesRepository,
					ClientPagesRepository.of(
						Object.assign(Object.create(null), {
							findComposition: () => Effect.sync(() => row),
							createComposition: (input: NonNullable<typeof row>) =>
								Effect.sync(() => {
									writes.push(input.compositionKey);
									row = { ...input, createdAt };
									return input.compositionKey;
								}),
						}),
					),
				),
			),
		),
	);
	return Effect.gen(function* () {
		const compositions = yield* ClientPageCompositionService;
		const stored = yield* compositions.materialize(graph);
		expect(writes).toEqual([graph.compositionKey]);
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
		expect(writes).toEqual([graph.compositionKey]);
		row = { ...stored, compositionHash: "changed" };
		expect(Exit.isFailure(yield* Effect.exit(compositions.materialize(graph)))).toBe(true);
	}).pipe(
		Effect.provide(layers),
		Effect.provideService(Database, Database.of(Object.create(null))),
	);
});
