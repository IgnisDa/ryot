import { expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot-app/client-plugin-contract";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";

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

it.effect(
	"uses in-memory bytes for image artifacts and persisted bytes for shipped and private hashes",
	() => {
		const databaseReads: string[] = [];
		const image = ImageClientArtifacts.of({
			renderers: new Map(),
			publicArtifactHashes: new Set([publicHash, shippedHash]),
			imageArtifactsByHash: new Map([
				[publicHash, { ...metadata, files: [file], hash: publicHash }],
			]),
			runtime: {
				entries: { bootstrap: file.name },
				artifact: { ...metadata, files: [file], hash: publicHash },
			},
		});
		const repository = ClientArtifactsRepository.of({
			persistClientArtifact: () => Effect.succeed(undefined),
			loadClientArtifact: () => Effect.die(new Error("Unexpected full artifact read")),
			findArtifactFile: (hash, name) =>
				Effect.sync(() => {
					databaseReads.push(`file:${hash}/${name}`);
					return name === file.name
						? { contentType: file.contentType, contents: new Uint8Array([20]) }
						: null;
				}),
			describe: (hash) =>
				Effect.sync(() => {
					databaseReads.push(`describe:${hash}`);
					return hash === shippedHash || hash === privateHash
						? { ...metadata, hash, files: [{ name: file.name, contentType: file.contentType }] }
						: null;
				}),
		});
		const layer = ClientArtifactStore.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(ImageClientArtifacts, image),
					Layer.succeed(ClientArtifactsRepository, repository),
					Layer.succeed(Database, Database.of(Object.create(null))),
				),
			),
		);
		return Effect.gen(function* () {
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
			expect(databaseReads).toEqual([`file:${shippedHash}/module.js`, `describe:${privateHash}`]);
		}).pipe(
			Effect.provide(layer),
			Effect.provideService(Database, Database.of(Object.create(null))),
		);
	},
);
