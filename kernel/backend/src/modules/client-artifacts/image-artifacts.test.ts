import { assert, expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot-app/client-plugin-contract";
import { Effect } from "effect";

import { parseClientImageManifest } from "./image-artifacts";

const runtimeHash = "a".repeat(64);
const rendererHash = "b".repeat(64);
const shippedHash = "c".repeat(64);
const file = (name: string, value: number) => ({
	name,
	contentType: "text/javascript",
	contents: new Uint8Array([value]),
});
const artifact = (hash: string, files: ReturnType<typeof file>[]) => ({
	hash,
	files,
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
});
const manifest = {
	publicArtifactHashes: [runtimeHash, rendererHash, shippedHash],
	runtime: {
		entries: { bootstrap: "bootstrap.js" },
		artifact: artifact(runtimeHash, [file("bootstrap.js", 1)]),
	},
	renderers: [
		{
			name: "Cards",
			sourceHash: "cards-source",
			artifact: artifact(rendererHash, [file("module.js", 2), file("module.css", 3)]),
		},
	],
};

it.effect("loads image-owned bytes and shipped plugin hashes independently", () =>
	Effect.gen(function* () {
		const image = yield* parseClientImageManifest(manifest);
		expect(image.imageArtifactsByHash.get(runtimeHash)?.files[0]?.contents).toEqual(
			new Uint8Array([1]),
		);
		expect(image.imageArtifactsByHash.has(shippedHash)).toBe(false);
		expect(image.publicArtifactHashes.has(shippedHash)).toBe(true);
		expect(image.renderers.get("Cards")?.artifact.hash).toBe(rendererHash);
	}),
);

it.effect("rejects different bytes under the same image hash", () =>
	Effect.gen(function* () {
		const [renderer] = manifest.renderers;
		assert(renderer);
		const conflict = {
			...manifest,
			renderers: [
				{
					...renderer,
					artifact: artifact(runtimeHash, [file("module.js", 2), file("module.css", 3)]),
				},
			],
		};
		const failure = yield* Effect.flip(parseClientImageManifest(conflict));
		expect(failure.message).toContain("collision");
	}),
);
