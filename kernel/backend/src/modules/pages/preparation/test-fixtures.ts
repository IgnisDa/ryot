import type { ClientPageCompositionIdentity } from "@ryot-app/contract/modules/client-pages/schemas";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	pluginExportSpecifier,
} from "@ryot-app/plugin-client-contract";

export const pageReference = {
	scope: "user" as const,
	packageId: PluginPackageId.make("test/page"),
};
export const presentationReference = {
	scope: "user" as const,
	packageId: PluginPackageId.make("test/presentation"),
};

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
	eagerArtifactHashes: ["a".repeat(64), "b".repeat(64)],
	selectedExports: [pluginExportSpecifier(pageReference, "main")],
	entry: { path: "client/main.tsx", contributor: "page-namespace" },
	automaticRegistry: [
		{
			layout: "grid",
			entitySchemaSlug: "entity",
			ownerPluginId: "presentation-id",
			artifactClosure: ["c".repeat(64)],
			exportSpecifier: pluginExportSpecifier(presentationReference, "card"),
		},
	],
	contributors: [
		{
			kind: "plugin",
			...pageReference,
			contentHash: "source",
			pluginDependencies: {},
			revisionId: "page-revision",
			namespace: "page-namespace",
			pluginId: PluginId.make("page-id"),
			clientArtifactHash: "b".repeat(64),
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
			...presentationReference,
			contentHash: "source",
			pluginDependencies: {},
			clientArtifactHash: "c".repeat(64),
			revisionId: "presentation-revision",
			namespace: "presentation-namespace",
			pluginId: PluginId.make("presentation-id"),
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
