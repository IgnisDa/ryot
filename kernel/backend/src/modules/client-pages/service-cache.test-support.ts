import { STYLEX_TRACER_BUILD_FINGERPRINT } from "@ryot-app/client-plugin-compiler";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { fixtureManifest } from "#modules/plugins/test-support";

import type { AvailablePlugin } from "../plugins/runtime-resolver";
import { resolveClientPageGraph } from "./graph";

const bytes = (value: string) => new TextEncoder().encode(value);

export const testClientPageArtifact = (hash: string): PluginClientArtifact => ({
	hash,
	files: [],
	apiVersion: CLIENT_API_VERSION,
	format: CLIENT_ARTIFACT_FORMAT,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
});

const tracerPlugin = (): AvailablePlugin => {
	const manifest = fixtureManifest();
	return {
		config: {},
		health: "ready",
		scope: "system",
		isDisabled: false,
		compiledHashes: {},
		slug: "stylex-tracer",
		id: "stylex-tracer-id",
		sourceHash: "shared-tracer-source",
		installationId: "stylex-tracer-installation",
		manifest: {
			...manifest,
			metadata: { ...manifest.metadata, name: "StyleX tracer", slug: "stylex-tracer" },
			client: {
				homeView: null,
				apiVersion: CLIENT_API_VERSION,
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

export const resolveTracerGraphsForCacheTest = Effect.gen(function* () {
	const plugin = tracerPlugin();
	const resolve = (stylex: boolean) =>
		resolveClientPageGraph({
			plugin,
			plugins: [plugin],
			exportName: "page",
			application: "page",
			userId: UserId.make("user-1"),
			...(stylex ? { stylexTracer: { fingerprint: STYLEX_TRACER_BUILD_FINGERPRINT } } : {}),
			loadPluginFiles: () =>
				Effect.succeed({ "client/page.tsx": bytes("export default function Page() {}") }),
		});
	return {
		stylex: yield* resolve(true),
		tailwind: yield* resolve(false),
		fingerprint: STYLEX_TRACER_BUILD_FINGERPRINT,
	};
});
