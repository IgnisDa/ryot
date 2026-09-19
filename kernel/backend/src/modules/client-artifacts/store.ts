import { Context, Effect, Layer } from "effect";

import { ImageClientArtifacts } from "./image-artifacts";
import { ClientArtifactsRepository } from "./repository";

export class ClientArtifactStore extends Context.Service<ClientArtifactStore>()(
	"ClientArtifactStore",
	{
		make: Effect.gen(function* () {
			const image = yield* ImageClientArtifacts;
			const repository = yield* ClientArtifactsRepository;
			const describe = (hash: string) => {
				const artifact = image.imageArtifactsByHash.get(hash);
				if (!artifact) {
					return repository.describe(hash);
				}
				const { files, ...metadata } = artifact;
				return Effect.succeed({
					...metadata,
					files: files
						.map(({ name, contentType }) => ({ name, contentType }))
						.sort((left, right) => left.name.localeCompare(right.name)),
				});
			};
			const findFile = (hash: string, fileName: string) => {
				const artifact = image.imageArtifactsByHash.get(hash);
				if (!artifact) {
					return repository.findArtifactFile(hash, fileName);
				}
				const file = artifact.files.find(({ name }) => name === fileName);
				return Effect.succeed(
					file ? { contents: file.contents, contentType: file.contentType } : null,
				);
			};
			return {
				describe,
				findFile,
				isPublic: (hash: string) => image.publicArtifactHashes.has(hash),
				exists: (hash: string) => Effect.map(describe(hash), (metadata) => metadata !== null),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
