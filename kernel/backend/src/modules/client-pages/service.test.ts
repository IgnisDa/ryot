import { expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import { PluginSlug, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { databaseLayer } from "#lib/test-utils/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginCatalogInvalidator } from "#modules/plugins/catalog-events";
import { ClientPluginCompiler } from "#modules/plugins/client-plugin-compiler";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolver, type AvailablePlugin } from "#modules/plugins/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";

import { ClientPagesRepository } from "./repository";
import { ClientPagesService } from "./service";

const bytes = (value: string) => new TextEncoder().encode(value);
const userId = UserId.make("user-1");
const artifact: PluginClientArtifact = {
	hash: "artifact-hash",
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
	files: [{ name: "index.html", contentType: "text/html", contents: bytes("<html></html>") }],
};

const availablePlugin = (sourceHash: string): AvailablePlugin => {
	const manifest = fixtureManifest();
	return {
		config: {},
		sourceHash,
		id: "plugin-1",
		health: "ready",
		scope: "system",
		isDisabled: false,
		compiledHashes: {},
		installationId: "installation-1",
		slug: PluginSlug.make("fixture"),
		manifest: {
			...manifest,
			client: {
				apiVersion: 1,
				homeView: null,
				pluginDependencies: [],
				routes: { "/": "page", "/details/$itemId": "page" },
				exports: {
					page: {
						kind: "page",
						entry: "client/page.tsx",
						settingsSchema: { fields: {} },
						automaticEntityPresentations: false,
					},
				},
			},
		},
	};
};

it.effect("reuses persisted plugin-route builds and recompiles after a source revision", () => {
	let plugin = availablePlugin("source-1");
	let compilations = 0;
	let persisted = 0;
	const builds = new Map<
		string,
		{
			readonly id: string;
			readonly format: typeof artifact.format;
			readonly artifactHash: string;
			readonly apiVersion: typeof artifact.apiVersion;
			readonly graphIdentity: Parameters<
				ClientPagesRepository["Service"]["createBuild"]
			>[0]["graphIdentity"];
			readonly bridgeVersion: typeof artifact.bridgeVersion;
			readonly compilerVersion: typeof artifact.compilerVersion;
		}
	>();
	const layer = ClientPagesService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				PluginCatalogInvalidator.layer,
				Layer.succeed(
					ClientPluginCompiler,
					ClientPluginCompiler.of({ compile: () => Effect.sync(() => (compilations++, artifact)) }),
				),
				Layer.succeed(
					PluginRuntimeResolver,
					PluginRuntimeResolver.of(
						Object.assign(Object.create(null), {
							listPluginsAvailableToUser: () => Effect.succeed([plugin]),
						}),
					),
				),
				Layer.succeed(
					PluginRepository,
					PluginRepository.of(
						Object.assign(Object.create(null), {
							persistClientArtifact: () => Effect.sync(() => persisted++),
							listAuthorizedSourceFiles: () =>
								Effect.succeed({ "client/page.tsx": bytes("export default function Page() {}") }),
						}),
					),
				),
				Layer.succeed(
					EntitiesRepository,
					EntitiesRepository.of(Object.assign(Object.create(null), {})),
				),
				Layer.succeed(
					ClientPagesRepository,
					ClientPagesRepository.of(
						Object.assign(Object.create(null), {
							findBuild: ({ graphHash }: { readonly graphHash: string }) =>
								Effect.succeed(builds.get(graphHash) ?? null),
							createBuild: (
								input: Parameters<ClientPagesRepository["Service"]["createBuild"]>[0],
							) =>
								Effect.sync(() => {
									const id = `build-${builds.size + 1}`;
									builds.set(input.graphHash, {
										id,
										format: artifact.format,
										artifactHash: artifact.hash,
										apiVersion: artifact.apiVersion,
										graphIdentity: input.graphIdentity,
										bridgeVersion: artifact.bridgeVersion,
										compilerVersion: artifact.compilerVersion,
									});
									return id;
								}),
						}),
					),
				),
			),
		),
	);
	return Effect.gen(function* () {
		const service = yield* ClientPagesService;
		const first = yield* service.prepare(
			{ id: userId },
			{ path: "/", search: "", pluginId: plugin.id, kind: "plugin-route" },
		);
		const second = yield* service.prepare(
			{ id: userId },
			{ search: "", pluginId: plugin.id, path: "/details/two", kind: "plugin-route" },
		);
		expect(compilations).toBe(1);
		expect(persisted).toBe(1);
		expect(second.identity.buildId).toBe(first.identity.buildId);
		expect(builds).toHaveLength(1);
		const cached = builds.get(first.identity.graphHash);
		expect(cached).toBeDefined();
		if (cached === undefined) {
			return;
		}
		builds.set(first.identity.graphHash, {
			...cached,
			graphIdentity: { ...cached.graphIdentity, selectedExports: [] },
		});
		const mismatch = yield* Effect.flip(
			service.prepare(
				{ id: userId },
				{ path: "/", search: "", pluginId: plugin.id, kind: "plugin-route" },
			),
		);
		expect(mismatch._tag).toBe("ClientRendererBadRequest");
		if (mismatch._tag !== "ClientRendererBadRequest") {
			return;
		}
		expect(mismatch.reason).toEqual({
			code: "definition-invalid",
			message: "Stored plugin page graph identity does not match its hash",
		});
		builds.set(first.identity.graphHash, cached);

		plugin = availablePlugin("source-2");
		const changed = yield* service.prepare(
			{ id: userId },
			{ path: "/", search: "", pluginId: plugin.id, kind: "plugin-route" },
		);
		expect(compilations).toBe(2);
		expect(persisted).toBe(2);
		expect(changed.identity.buildId).not.toBe(first.identity.buildId);
		expect(builds).toHaveLength(2);
	}).pipe(Effect.provide(Layer.merge(layer, databaseLayer)));
});
