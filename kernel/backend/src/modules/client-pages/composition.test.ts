import { expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	clientArtifactFile,
	clientArtifactMetadata,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import type { ClientPageArtifactIdentity } from "@ryot-app/contract/modules/client-pages/schemas";
import { PluginSlug } from "@ryot-app/contract/schema/brands";

import { composeClientPage } from "./composition";

/* oxlint-disable perfectionist/sort-objects -- fixtures preserve contract and descriptor field order. */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const artifact = (files: readonly { name: string; content: string; contentType: string }[]) => {
	const artifactFiles = files.map(({ name, content, contentType }) =>
		clientArtifactFile({ path: name, bytes: encoder.encode(content), contentType }),
	);
	return {
		...clientArtifactMetadata("composition test", artifactFiles),
		files: artifactFiles,
	} satisfies PluginClientArtifact;
};

const runtime = {
	entries: {
		"@ryot-app/client-sdk/plugin": "entry-sdk.js",
		react: "entry-react.js",
		bootstrap: "bootstrap.js",
	},
	artifact: artifact([
		{
			name: "bootstrap.js",
			content: 'import "./chunk-bootstrap.js";\n',
			contentType: "text/javascript; charset=utf-8",
		},
		{
			name: "chunk-bootstrap.js",
			content: "export {};\n",
			contentType: "text/javascript; charset=utf-8",
		},
		{
			name: "entry-sdk.js",
			content: "export {};\n",
			contentType: "text/javascript; charset=utf-8",
		},
		{
			name: "entry-react.js",
			content: "export {};\n",
			contentType: "text/javascript; charset=utf-8",
		},
		{
			name: "runtime.css",
			content: "body { margin: 0; }\n",
			contentType: "text/css; charset=utf-8",
		},
	]),
};

const pluginArtifact = artifact([
	{
		name: "module.js",
		content: 'import "./chunk.js";\nexport { Export0, Export1, Export2, Export3 };\n',
		contentType: "text/javascript; charset=utf-8",
	},
	{ name: "chunk.js", content: "export {};\n", contentType: "text/javascript; charset=utf-8" },
	{
		name: "module.css",
		content: '@font-face { src: url("./font.woff2"); }\n',
		contentType: "text/css; charset=utf-8",
	},
	{ name: "font.woff2", content: "font-bytes", contentType: "font/woff2" },
]);

const routeIdentity = (
	overrides: Partial<ClientPageArtifactIdentity> = {},
): ClientPageArtifactIdentity => ({
	format: CLIENT_ARTIFACT_FORMAT,
	name: "Fixture page",
	apiVersion: CLIENT_API_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	selectedExports: [
		"@ryot-app/plugins/fixture/home",
		"@ryot-app/plugins/fixture/details",
		"@ryot-app/plugins/fixture/notFound",
		"@ryot-app/plugins/fixture/poster",
	],
	application: "plugin-route",
	automaticRegistry: [
		{
			ownerPluginId: "fixture-<script>",
			exportSpecifier: "@ryot-app/plugins/fixture/poster",
			entitySchemaSlug: "fixture-entity",
			layout: "grid",
		},
	],
	entry: { path: "client/home.tsx", contributor: "fixture-namespace" },
	kernelAutomaticFallback: null,
	routeRegistry: {
		home: "@ryot-app/plugins/fixture/home",
		routes: [{ path: "/details", exportSpecifier: "@ryot-app/plugins/fixture/details" }],
		notFound: "@ryot-app/plugins/fixture/notFound",
	},
	contributors: [
		{
			pluginSlug: PluginSlug.make("fixture"),
			pluginId: "fixture-<script>",
			namespace: "fixture-namespace",
			sourceHash: "fixture-source",
			kind: "plugin",
			pluginDependencies: [],
			exports: [
				{
					name: "poster",
					entry: "client/poster.tsx",
					kind: "presentation",
					automaticEntityPresentations: true,
				},
				{
					name: "notFound",
					entry: "client/not-found.tsx",
					kind: "page",
					automaticEntityPresentations: false,
				},
				{
					name: "home",
					entry: "client/home.tsx",
					kind: "page",
					automaticEntityPresentations: false,
				},
				{
					name: "details",
					entry: "client/details.tsx",
					kind: "page",
					automaticEntityPresentations: false,
				},
			],
		},
	],
	...overrides,
});

const scriptJson = (html: string, selector: string) => {
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`<script[^>]*id="${escapedSelector}"[^>]*>([\\s\\S]*?)</script>`).exec(
		html,
	);
	if (!match?.[1]) {
		throw new Error(`Missing embedded script: ${selector}`);
	}
	return JSON.parse(match[1].replaceAll("\\u003c", "<"));
};

const artifactText = (value: PluginClientArtifact, name: string) => {
	const file = value.files.find((candidate) => candidate.name === name);
	if (!file) {
		throw new Error(`Missing test artifact file: ${name}`);
	}
	return decoder.decode(file.contents);
};

it("composes namespaced plugin files, import maps, descriptor, and styles deterministically", () => {
	const identity = routeIdentity();
	const first = composeClientPage({
		identity,
		runtime,
		plugins: { fixture: pluginArtifact },
		renderers: {},
	});
	const second = composeClientPage({
		identity,
		runtime: {
			entries: Object.fromEntries(Object.entries(runtime.entries).toReversed()),
			artifact: { ...runtime.artifact, files: runtime.artifact.files.toReversed() },
		},
		plugins: { fixture: { ...pluginArtifact, files: pluginArtifact.files.toReversed() } },
		renderers: {},
	});

	expect(second.hash).toBe(first.hash);
	expect(second.files).toEqual(first.files);
	expect(first.files.map(({ name }) => name)).toEqual(first.files.map(({ name }) => name).sort());
	const html = artifactText(first, "index.html");
	const importMap = scriptJson(html, "ryot-client-importmap");
	const descriptor = scriptJson(html, "ryot-client-composition");
	const metadata = scriptJson(html, "ryot-client-artifact");

	expect(importMap.imports).toEqual({
		"@ryot-app/client-sdk/plugin": "./runtime/entry-sdk.js",
		"@ryot-app/plugins/fixture/details": "./plugins/fixture/module.js",
		"@ryot-app/plugins/fixture/home": "./plugins/fixture/module.js",
		"@ryot-app/plugins/fixture/notFound": "./plugins/fixture/module.js",
		"@ryot-app/plugins/fixture/poster": "./plugins/fixture/module.js",
		react: "./runtime/entry-react.js",
	});
	expect(importMap.imports).not.toHaveProperty("bootstrap");
	expect(descriptor).toEqual({
		automaticRegistry: [
			{
				ownerPluginId: "fixture-<script>",
				entitySchemaSlug: "fixture-entity",
				layout: "grid",
				specifier: "@ryot-app/plugins/fixture/poster",
				binding: "Export3",
			},
		],
		application: "plugin-route",
		routes: {
			home: { specifier: "@ryot-app/plugins/fixture/home", binding: "Export1" },
			routes: [
				{ path: "/details", specifier: "@ryot-app/plugins/fixture/details", binding: "Export0" },
			],
			notFound: { specifier: "@ryot-app/plugins/fixture/notFound", binding: "Export2" },
		},
	});
	expect(html).toContain('src="./runtime/bootstrap.js"');
	expect(html).toContain('href="./runtime/runtime.css"');
	expect(html).toContain('href="./plugins/fixture/module.css"');
	expect(html).toContain('ownerPluginId":"fixture-\\u003cscript>"');
	expect(metadata).toEqual({
		hash: first.hash,
		format: first.format,
		apiVersion: first.apiVersion,
		bridgeVersion: first.bridgeVersion,
		compilerVersion: first.compilerVersion,
	});
	expect(artifactText(first, "plugins/fixture/module.js")).toContain('import "./chunk.js";');
	expect(artifactText(first, "plugins/fixture/module.css")).toContain('url("./font.woff2")');
	expect(artifactText(first, "runtime/bootstrap.js")).toContain('import "./chunk-bootstrap.js";');
	expect(first.files.map(({ name }) => name)).toContain("plugins/fixture/font.woff2");
});

it("binds kernel renderer pages through their named renderer artifact", () => {
	const rendererArtifact = artifact([
		{
			name: "module.js",
			content: "export default Export0;\n",
			contentType: "text/javascript; charset=utf-8",
		},
		{ name: "module.css", content: ".renderer {}\n", contentType: "text/css; charset=utf-8" },
	]);
	const identity = routeIdentity({
		name: "Kernel page",
		selectedExports: [],
		application: "page",
		automaticRegistry: [],
		entry: { path: "client/page.tsx", contributor: "kernel-namespace" },
		routeRegistry: null,
		contributors: [
			{
				name: "results-table",
				entry: "client/page.tsx",
				namespace: "kernel-namespace",
				sourceHash: "kernel-source",
				kind: "kernel-renderer",
				automaticEntityPresentations: false,
				pluginDependencies: [],
			},
		],
	});
	const composed = composeClientPage({
		identity,
		runtime,
		plugins: {},
		renderers: { "results-table": rendererArtifact },
	});
	const html = artifactText(composed, "index.html");
	expect(
		scriptJson(html, "ryot-client-importmap").imports["@ryot-app/kernel-renderers/results-table"],
	).toBe("./renderers/results-table/module.js");
	expect(scriptJson(html, "ryot-client-composition").entry).toEqual({
		specifier: "@ryot-app/kernel-renderers/results-table",
		binding: "Export0",
	});
	expect(html).toContain('href="./renderers/results-table/module.css"');
	expect(composed.files.map(({ name }) => name)).toContain("renderers/results-table/module.js");
});

it("selects the page export matching both entry path and contributor namespace", () => {
	const identity = routeIdentity({
		selectedExports: ["@ryot-app/plugins/fixture/details"],
		application: "page",
		entry: { path: "client/details.tsx", contributor: "fixture-namespace" },
		automaticRegistry: [],
		routeRegistry: null,
	});
	const composed = composeClientPage({
		identity,
		runtime,
		plugins: { fixture: pluginArtifact },
		renderers: {},
	});
	const descriptor = scriptJson(artifactText(composed, "index.html"), "ryot-client-composition");
	expect(descriptor).toMatchObject({
		application: "page",
		entry: { specifier: "@ryot-app/plugins/fixture/details", binding: "Export0" },
	});
});

it("changes the composed hash when graph identity changes with unchanged non-HTML files", () => {
	const identity = routeIdentity();
	const routeRegistry = identity.routeRegistry;
	if (routeRegistry === null) {
		throw new Error("Test fixture is missing its route registry");
	}
	const compose = (candidate: ClientPageArtifactIdentity) =>
		composeClientPage({
			identity: candidate,
			runtime,
			plugins: { fixture: pluginArtifact },
			renderers: {},
		});
	const initial = compose(identity);
	const changedEntry = compose({
		...identity,
		entry: { path: "client/other-home.tsx", contributor: "fixture-namespace" },
	});
	const changedRoutes = compose({
		...identity,
		routeRegistry: {
			...routeRegistry,
			routes: [{ path: "/other", exportSpecifier: "@ryot-app/plugins/fixture/details" }],
		},
	});
	const changedRegistry = compose({
		...identity,
		automaticRegistry: identity.automaticRegistry.map((registration) =>
			Object.assign({}, registration, { layout: "list" as const }),
		),
	});

	expect(changedEntry.hash).not.toBe(initial.hash);
	expect(changedRoutes.hash).not.toBe(initial.hash);
	expect(changedRegistry.hash).not.toBe(initial.hash);
	for (const candidate of [changedEntry, changedRoutes, changedRegistry]) {
		expect(candidate.files.filter(({ name }) => name !== "index.html")).toEqual(
			initial.files.filter(({ name }) => name !== "index.html"),
		);
	}
});

it("rejects colliding composed paths", () => {
	const collidingRuntime: PluginClientArtifact = {
		...runtime.artifact,
		files: [
			...runtime.artifact.files,
			clientArtifactFile({
				path: "bootstrap.js",
				bytes: encoder.encode("duplicate"),
				contentType: "text/javascript; charset=utf-8",
			}),
		],
	};
	expect(() =>
		composeClientPage({
			identity: routeIdentity(),
			runtime: { ...runtime, artifact: collidingRuntime },
			plugins: { fixture: pluginArtifact },
			renderers: {},
		}),
	).toThrow("Client artifact path collision: runtime/bootstrap.js");
});
