import type { PluginClientArtifact } from "@ryot-app/client-plugin-contract";
import { Context, Effect, Layer } from "effect";

import { PluginRepository } from "#modules/plugins/repository";

import { composeClientPage } from "./composition";
import type { ResolvedClientPageArtifactGraph } from "./graph";
import { ImageClientArtifacts } from "./image-artifacts";
import { ClientPagesRepository } from "./repository";

export class ClientPageBuildService extends Context.Service<ClientPageBuildService>()(
	"ClientPageBuildService",
	{
		make: Effect.gen(function* () {
			const repository = yield* ClientPagesRepository;
			const plugins = yield* PluginRepository;
			const imageArtifacts = yield* ImageClientArtifacts;
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
				graph: ResolvedClientPageArtifactGraph,
			) {
				const existing = yield* find(graph);
				if (existing) {
					return existing;
				}
				const artifact = yield* Effect.gen(function* () {
					const pluginArtifacts = yield* Effect.forEach(
						graph.identity.contributors.filter((contributor) => contributor.kind === "plugin"),
						(contributor) =>
							Effect.gen(function* () {
								const clientArtifact = yield* plugins.findClientArtifactForSource({
									pluginId: contributor.pluginId,
									sourceHash: contributor.sourceHash,
								});
								if (!clientArtifact) {
									return yield* Effect.die(
										new Error(
											`Client plugin artifact is missing for ${contributor.pluginSlug} at source hash ${contributor.sourceHash}`,
										),
									);
								}
								return [contributor.pluginSlug, clientArtifact] as const;
							}),
					);

					const rendererArtifacts: Array<readonly [string, PluginClientArtifact]> = [];
					for (const contributor of graph.identity.contributors) {
						if (contributor.kind !== "kernel-renderer") {
							continue;
						}
						const renderer = imageArtifacts.renderers.get(contributor.name);
						if (!renderer) {
							return yield* Effect.die(
								new Error(`Kernel renderer artifact is missing: ${contributor.name}`),
							);
						}
						if (renderer.sourceHash !== contributor.sourceHash) {
							return yield* Effect.die(
								new Error(`Kernel renderer artifact source hash mismatch: ${contributor.name}`),
							);
						}
						rendererArtifacts.push([contributor.name, renderer.artifact]);
					}

					return yield* Effect.sync(() =>
						composeClientPage({
							identity: graph.identity,
							runtime: imageArtifacts.runtime,
							plugins: Object.fromEntries(pluginArtifacts),
							renderers: Object.fromEntries(rendererArtifacts),
						}),
					);
				}).pipe(Effect.withSpan("ClientPageBuild.compose"));
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
