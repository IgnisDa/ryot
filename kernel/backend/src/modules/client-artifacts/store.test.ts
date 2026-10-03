import { expect, layer } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot-app/client-plugin-contract";
import { Context, Effect, Layer, Ref } from "effect";

import { ImageClientArtifacts } from "./image-artifacts";
import { ClientArtifactsRepository } from "./repository";
import { ClientArtifactStore } from "./store";

const publicHash = "a".repeat(64);
const shippedHash = "b".repeat(64);
const privateHash = "c".repeat(64);
const metadata = {
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
};
const file = { name: "module.js", contentType: "text/javascript", contents: new Uint8Array([10]) };

const image = ImageClientArtifacts.of({
	renderers: new Map(),
	publicArtifactHashes: new Set([publicHash, shippedHash]),
	imageArtifactsByHash: new Map([[publicHash, { ...metadata, files: [file], hash: publicHash }]]),
	runtime: {
		entries: { bootstrap: file.name },
		artifact: { ...metadata, files: [file], hash: publicHash },
	},
});

class FakeClientArtifactsRepository extends Context.Service<
	FakeClientArtifactsRepository,
	{ readonly databaseReads: Effect.Effect<ReadonlyArray<string>> }
>()("test/FakeClientArtifactsRepository") {}

const fakeRepositoryLayer = Layer.effectContext(
	Effect.gen(function* () {
		const databaseReads = yield* Ref.make<ReadonlyArray<string>>([]);
		const record = (read: string) => Ref.update(databaseReads, (all) => [...all, read]);
		return Context.make(
			ClientArtifactsRepository,
			ClientArtifactsRepository.of({
				persistClientArtifact: () => Effect.void,
				loadClientArtifact: () => Effect.die(new Error("Unexpected full artifact read")),
				findArtifactFile: (hash, name) =>
					record(`file:${hash}/${name}`).pipe(
						Effect.as(
							name === file.name
								? { contentType: file.contentType, contents: new Uint8Array([20]) }
								: null,
						),
					),
				describe: (hash) =>
					record(`describe:${hash}`).pipe(
						Effect.as(
							hash === shippedHash || hash === privateHash
								? { ...metadata, hash, files: [{ name: file.name, contentType: file.contentType }] }
								: null,
						),
					),
			}),
		).pipe(Context.add(FakeClientArtifactsRepository, { databaseReads: Ref.get(databaseReads) }));
	}),
);

const storeLayer = ClientArtifactStore.layer.pipe(
	Layer.provideMerge(Layer.merge(Layer.succeed(ImageClientArtifacts, image), fakeRepositoryLayer)),
);

layer(storeLayer)((test) => {
	test.effect(
		"uses in-memory bytes for image artifacts and persisted bytes for shipped and private hashes",
		() =>
			Effect.gen(function* () {
				const store = yield* ClientArtifactStore;
				expect((yield* store.findFile(publicHash, file.name))?.contents).toEqual(
					new Uint8Array([10]),
				);
				expect(yield* store.describe(publicHash)).toMatchObject({ files: [{ name: "module.js" }] });
				expect((yield* store.findFile(shippedHash, file.name))?.contents).toEqual(
					new Uint8Array([20]),
				);
				expect(yield* store.exists(privateHash)).toBe(true);
				expect(store.isPublic(shippedHash)).toBe(true);
				expect(store.isPublic(privateHash)).toBe(false);
				expect(yield* (yield* FakeClientArtifactsRepository).databaseReads).toEqual([
					`file:${shippedHash}/module.js`,
					`describe:${privateHash}`,
				]);
			}),
	);
});
