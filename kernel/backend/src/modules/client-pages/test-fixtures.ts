import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot-app/client-plugin-contract";
import type { ClientPageCompositionIdentity } from "@ryot-app/contract/modules/client-pages/schemas";
import { PluginSlug } from "@ryot-app/contract/schema/brands";

export const identity = (): ClientPageCompositionIdentity => ({
	name: "Page",
	application: "page",
	routeRegistry: null,
	kernelAutomaticFallback: null,
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	runtimeArtifactHash: "a".repeat(64),
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
	selectedExports: ["@ryot-app/plugins/page/main"],
	eagerArtifactHashes: ["a".repeat(64), "b".repeat(64)],
	entry: { path: "client/main.tsx", contributor: "page-namespace" },
	automaticRegistry: [
		{
			layout: "grid",
			entitySchemaSlug: "entity",
			ownerPluginId: "presentation-id",
			artifactClosure: ["c".repeat(64)],
			exportSpecifier: "@ryot-app/plugins/presentation/card",
		},
	],
	contributors: [
		{
			kind: "plugin",
			pluginId: "page-id",
			sourceHash: "source",
			pluginDependencies: [],
			namespace: "page-namespace",
			clientArtifactHash: "b".repeat(64),
			pluginSlug: PluginSlug.make("page"),
			exports: [
				{
					name: "main",
					kind: "page",
					entry: "client/main.tsx",
					settingsSchema: { fields: {} },
					automaticEntityPresentations: true,
				},
			],
		},
		{
			kind: "plugin",
			sourceHash: "source",
			pluginDependencies: [],
			pluginId: "presentation-id",
			clientArtifactHash: "c".repeat(64),
			namespace: "presentation-namespace",
			pluginSlug: PluginSlug.make("presentation"),
			exports: [
				{
					name: "card",
					kind: "presentation",
					entry: "client/card.tsx",
					automaticEntityPresentations: false,
				},
			],
		},
	],
});

export const descriptions = () =>
	new Map([
		[
			"a".repeat(64),
			{
				files: [
					{ name: "bootstrap.js", contentType: "text/javascript" },
					{ name: "runtime.js", contentType: "text/javascript" },
				],
			},
		],
		[
			"b".repeat(64),
			{
				files: [
					{ name: "module.js", contentType: "text/javascript" },
					{ name: "module.css", contentType: "text/css" },
				],
			},
		],
		[
			"c".repeat(64),
			{
				files: [
					{ name: "module.js", contentType: "text/javascript" },
					{ name: "module.css", contentType: "text/css" },
					{ name: "font.woff2", contentType: "font/woff2" },
					{ name: "icon.svg", contentType: "image/svg+xml" },
					{ name: "helper.wasm", contentType: "application/wasm" },
				],
			},
		],
	]);
