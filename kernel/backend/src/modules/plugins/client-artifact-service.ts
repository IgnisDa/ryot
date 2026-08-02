import { Context, Effect, Layer } from "effect";

import { PluginRepository } from "./repository";

export class PluginClientArtifactService extends Context.Service<PluginClientArtifactService>()(
	"PluginClientArtifactService",
	{
		make: Effect.gen(function* () {
			const repository = yield* PluginRepository;

			const findArtifactFile = Effect.fn("PluginClientArtifactService.findArtifactFile")(function* (
				artifactHash: string,
				fileName: string,
			) {
				const artifact = yield* repository.findClientArtifactByHash(artifactHash);
				if (!artifact) {
					return null;
				}
				return artifact.files.find((file) => file.name === fileName) ?? null;
			});

			return { findArtifactFile };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
