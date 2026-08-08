import { ClientPluginCompilerFailure } from "@ryot-app/client-plugin-compiler";
import type { PluginClientArtifact } from "@ryot-app/client-plugin-contract";
import { Context, Effect, Layer } from "effect";

import { ClientPluginCompiler } from "#modules/plugins/client-plugin-compiler";
import { PluginRepository } from "#modules/plugins/repository";

import type { ResolvedClientPageArtifactGraph, ResolvedClientPageGraph } from "./graph";
import { ClientPagesRepository } from "./repository";

export class ClientPageBuildService extends Context.Service<ClientPageBuildService>()(
	"ClientPageBuildService",
	{
		make: Effect.gen(function* () {
			const repository = yield* ClientPagesRepository;
			const plugins = yield* PluginRepository;
			const compiler = yield* ClientPluginCompiler;
			const inFlight = new Map<string, Promise<PluginClientArtifact>>();
			const find = Effect.fn("ClientPageBuild.find")(function* (
				graph: ResolvedClientPageArtifactGraph,
			) {
				const build = yield* repository.findBuild(graph.artifactKey);
				if (build && !Bun.deepEquals(build.artifactIdentity, graph.identity)) {
					return yield* Effect.die(new Error("Client page artifact key identity collision"));
				}
				return build;
			});
			const materialize = Effect.fn("ClientPageBuild.materialize")(function* (
				graph: ResolvedClientPageGraph,
			) {
				const existing = yield* find(graph);
				if (existing) {
					return existing;
				}
				const artifact = yield* Effect.tryPromise({
					catch: (error) =>
						error instanceof ClientPluginCompilerFailure
							? error
							: new ClientPluginCompilerFailure({ diagnostics: [], message: String(error) }),
					try: () => {
						const current = inFlight.get(graph.artifactKey);
						if (current) {
							return current;
						}
						const promise = Effect.runPromiseWith(Context.empty())(
							compiler.compile(graph.compilerInput),
						);
						inFlight.set(graph.artifactKey, promise);
						void promise.finally(() => inFlight.delete(graph.artifactKey)).catch(() => {});
						return promise;
					},
				}).pipe(Effect.withSpan("ClientPageBuild.compile"));
				yield* plugins
					.persistClientArtifact(artifact)
					.pipe(Effect.withSpan("ClientPageBuild.persist-artifact"));
				yield* repository
					.createBuild({
						artifactHash: artifact.hash,
						artifactKey: graph.artifactKey,
						artifactIdentity: graph.identity,
					})
					.pipe(Effect.withSpan("ClientPageBuild.persist-build"));
				const stored = yield* find(graph);
				if (!stored) {
					return yield* Effect.die(new Error("Client page build was not persisted"));
				}
				return stored;
			});
			return { find, materialize };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
