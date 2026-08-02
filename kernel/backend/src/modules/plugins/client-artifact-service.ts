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
				return yield* repository.findClientArtifactFile(artifactHash, fileName);
			});

			return { findArtifactFile };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
