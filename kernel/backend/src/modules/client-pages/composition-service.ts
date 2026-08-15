import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer } from "effect";

import { ImageClientArtifacts } from "#modules/client-artifacts/image-artifacts";
import { ClientArtifactStore } from "#modules/client-artifacts/store";

import { composeClientPage } from "./composition";
import type { ResolvedClientPageGraph } from "./graph";
import { ClientPagesRepository } from "./repository";

export class ClientPageCompositionService extends Context.Service<ClientPageCompositionService>()(
	"ClientPageCompositionService",
	{
		make: Effect.gen(function* () {
			const repository = yield* ClientPagesRepository;
			const store = yield* ClientArtifactStore;
			const image = yield* ImageClientArtifacts;
			const find = Effect.fn("ClientPageComposition.find")(function* (
				graph: ResolvedClientPageGraph,
			) {
				const composition = yield* repository.findComposition(graph.compositionKey);
				if (composition && !Bun.deepEquals(composition.identity, graph.identity)) {
					return yield* Effect.die(new Error("Client page composition key identity collision"));
				}
				return composition;
			});
			const materialize = Effect.fn("ClientPageComposition.materialize")(function* (
				graph: ResolvedClientPageGraph,
			) {
				const existing = yield* find(graph);
				const hashes = new Set([
					graph.identity.runtimeArtifactHash,
					...graph.identity.contributors.map((contributor) =>
						contributor.kind === "plugin"
							? contributor.clientArtifactHash
							: contributor.artifactHash,
					),
				]);
				const descriptions = new Map<
					string,
					NonNullable<Effect.Success<ReturnType<typeof store.describe>>>
				>();
				for (const hash of hashes) {
					const description = yield* store.describe(hash);
					if (!description) {
						return yield* Effect.die(new Error(`Client artifact is missing: ${hash}`));
					}
					descriptions.set(hash, description);
				}
				const manifest = yield* Effect.try(() =>
					composeClientPage({
						artifacts: descriptions,
						identity: graph.identity,
						runtimeEntries: image.runtime.entries,
					}),
				).pipe(Effect.orDie);
				const compositionHash = sha256Hex(stableStringify(manifest));
				if (existing) {
					if (
						existing.compositionHash !== compositionHash ||
						!Bun.deepEquals(existing.manifest, manifest)
					) {
						return yield* Effect.die(new Error("Conflicting immutable client page composition"));
					}
					return existing;
				}
				yield* repository.createComposition({
					manifest,
					compositionHash,
					identity: graph.identity,
					compositionKey: graph.compositionKey,
				});
				const stored = yield* find(graph);
				if (
					!stored ||
					stored.compositionHash !== compositionHash ||
					!Bun.deepEquals(stored.manifest, manifest)
				) {
					return yield* Effect.die(new Error("Conflicting immutable client page composition"));
				}
				return stored;
			});
			return { find, materialize };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
