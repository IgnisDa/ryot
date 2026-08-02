import { expect, it } from "@effect/vitest";
import type { PluginClientArtifact } from "@ryot/contract/modules/plugins/client";
import { Effect, Layer } from "effect";

import { databaseLayer } from "#lib/test-utils/effect";

import { PluginClientArtifactService } from "./client-artifact-service";
import { PluginRepository } from "./repository";

const artifact: PluginClientArtifact = {
	format: 1,
	apiVersion: 1,
	bridgeVersion: 1,
	compilerVersion: 1,
	hash: "artifact-hash",
	files: [
		{ name: "plugin.js", contents: "export {};", contentType: "text/javascript; charset=utf-8" },
		{ name: "index.html", contents: "<!doctype html>", contentType: "text/html; charset=utf-8" },
	],
};

const makeLayer = (stored: PluginClientArtifact | null) =>
	PluginClientArtifactService.layer.pipe(
		Layer.provide(
			Layer.mock(PluginRepository)({
				findClientArtifactByHash: (hash) => Effect.succeed(stored?.hash === hash ? stored : null),
			}),
		),
		Layer.provideMerge(databaseLayer),
	);

it.effect("returns the requested file of the stored artifact", () =>
	Effect.gen(function* () {
		const service = yield* PluginClientArtifactService;

		expect(yield* service.findArtifactFile("artifact-hash", "index.html")).toEqual(
			artifact.files[1],
		);
	}).pipe(Effect.provide(makeLayer(artifact))),
);

it.effect("returns nothing for an unknown artifact hash or file name", () =>
	Effect.gen(function* () {
		const service = yield* PluginClientArtifactService;

		expect(yield* service.findArtifactFile("artifact-hash", "missing.js")).toBeNull();
		expect(yield* service.findArtifactFile("other-hash", "index.html")).toBeNull();
	}).pipe(Effect.provide(makeLayer(artifact))),
);

it.effect("returns nothing when no plugin carries the artifact hash", () =>
	Effect.gen(function* () {
		const service = yield* PluginClientArtifactService;

		expect(yield* service.findArtifactFile("artifact-hash", "index.html")).toBeNull();
	}).pipe(Effect.provide(makeLayer(null))),
);
