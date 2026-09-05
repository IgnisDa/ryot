import {
	CLIENT_ARTIFACT_METADATA_ELEMENT_ID,
	CLIENT_ARTIFACT_ROOT_ELEMENT_ID,
	clientArtifactFile,
	clientArtifactMetadata,
	type PluginClientArtifact,
	type PluginClientArtifactFile,
} from "@ryot-app/client-plugin-contract";
import type { ClientPageArtifactIdentity } from "@ryot-app/contract/modules/client-pages/schemas";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";

const ARTIFACT_METADATA_PLACEHOLDER = "__RYOT_CLIENT_ARTIFACT_METADATA__";
const COMPOSITION_ELEMENT_ID = "ryot-client-composition";

type ModuleReference = { readonly specifier: string; readonly binding: string };

const compareNames = (left: string, right: string) => {
	if (left < right) {
		return -1;
	}
	return left > right ? 1 : 0;
};

const escapeHtml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

const htmlJson = (value: unknown) => {
	return JSON.stringify(value).replaceAll("<", "\\u003c");
};

const requireCanonicalPath = (path: string) => {
	const issue = canonicalRelativePosixPathIssue(path);
	if (issue !== null) {
		throw new Error(`Invalid client artifact path "${path}": ${issue}`);
	}
};

const addArtifactFiles = (
	files: Map<string, PluginClientArtifactFile>,
	prefix: string,
	artifact: PluginClientArtifact,
) => {
	for (const file of artifact.files) {
		const name = `${prefix}/${file.name}`;
		requireCanonicalPath(name);
		if (files.has(name)) {
			throw new Error(`Client artifact path collision: ${name}`);
		}
		files.set(
			name,
			clientArtifactFile({ path: name, bytes: file.contents, contentType: file.contentType }),
		);
	}
};

const requireModuleFile = (artifact: PluginClientArtifact, name: string) => {
	if (!artifact.files.some((file) => file.name === "module.js")) {
		throw new Error(`Client module artifact is missing module.js: ${name}`);
	}
};

/* oxlint-disable perfectionist/sort-objects -- preserve the runtime.ts composition descriptor field order. */
const composeDescriptor = (
	identity: ClientPageArtifactIdentity,
	moduleSpecifiers: Map<string, string>,
) => {
	const pluginReference = (specifier: string): ModuleReference => {
		const binding = moduleSpecifiers.get(specifier);
		if (binding === undefined) {
			throw new Error(`Client composition export is missing: ${specifier}`);
		}
		return { specifier, binding };
	};
	const automaticRegistry = identity.automaticRegistry.map((registration) => ({
		ownerPluginId: registration.ownerPluginId,
		entitySchemaSlug: registration.entitySchemaSlug,
		layout: registration.layout,
		...pluginReference(registration.exportSpecifier),
	}));

	if (identity.application === "plugin-route") {
		const registry = identity.routeRegistry;
		if (registry === null) {
			throw new Error("Plugin-route composition is missing its route registry");
		}
		return {
			automaticRegistry,
			application: "plugin-route" as const,
			routes: {
				home: pluginReference(registry.home),
				routes: registry.routes.map(({ path, exportSpecifier }) => ({
					path,
					...pluginReference(exportSpecifier),
				})),
				...(registry.notFound === undefined
					? {}
					: { notFound: pluginReference(registry.notFound) }),
			},
		};
	}

	const selectedPage = identity.selectedExports
		.map((specifier) => {
			const reference = moduleSpecifiers.get(specifier);
			if (reference === undefined) {
				return undefined;
			}
			const contributor = identity.contributors.find(
				(candidate) =>
					candidate.kind === "plugin" &&
					specifier.startsWith(`@ryot-app/plugins/${candidate.pluginSlug}/`),
			);
			const declaration =
				contributor?.kind === "plugin"
					? contributor.exports.find(
							({ name }) => specifier === `@ryot-app/plugins/${contributor.pluginSlug}/${name}`,
						)
					: undefined;
			return declaration !== undefined &&
				contributor !== undefined &&
				declaration.entry === identity.entry.path &&
				contributor.namespace === identity.entry.contributor
				? { specifier, binding: reference }
				: undefined;
		})
		.find((reference) => reference !== undefined);
	if (selectedPage) {
		return { automaticRegistry, application: "page" as const, entry: selectedPage };
	}

	const kernelRenderer = identity.contributors.find(
		(
			contributor,
		): contributor is Extract<
			ClientPageArtifactIdentity["contributors"][number],
			{ readonly kind: "kernel-renderer" }
		> =>
			contributor.kind === "kernel-renderer" &&
			contributor.namespace === identity.entry.contributor &&
			contributor.entry === identity.entry.path,
	);
	if (!kernelRenderer) {
		throw new Error("Client page entry does not match a selected export or kernel renderer");
	}
	return {
		automaticRegistry,
		application: "page" as const,
		entry: { specifier: `@ryot-app/kernel-renderers/${kernelRenderer.name}`, binding: "Export0" },
	};
};
/* oxlint-enable perfectionist/sort-objects */

export const composeClientPage = (input: {
	readonly identity: ClientPageArtifactIdentity;
	readonly runtime: {
		readonly artifact: PluginClientArtifact;
		readonly entries: Record<string, string>;
	};
	readonly plugins: Readonly<Record<string, PluginClientArtifact>>;
	readonly renderers: Readonly<Record<string, PluginClientArtifact>>;
}): PluginClientArtifact => {
	const files = new Map<string, PluginClientArtifactFile>();
	addArtifactFiles(files, "runtime", input.runtime.artifact);
	for (const [slug, artifact] of Object.entries(input.plugins).sort(([left], [right]) =>
		compareNames(left, right),
	)) {
		addArtifactFiles(files, `plugins/${slug}`, artifact);
	}
	for (const [name, artifact] of Object.entries(input.renderers).sort(([left], [right]) =>
		compareNames(left, right),
	)) {
		addArtifactFiles(files, `renderers/${name}`, artifact);
	}

	const runtimeFiles = new Set(input.runtime.artifact.files.map(({ name }) => name));
	const bootstrap = input.runtime.entries["bootstrap"];
	if (bootstrap === undefined || bootstrap.length === 0 || !runtimeFiles.has(bootstrap)) {
		throw new Error("Client runtime is missing its bootstrap entry");
	}
	const imports = new Map<string, string>();
	const addImport = (specifier: string, target: string) => {
		if (imports.has(specifier)) {
			throw new Error(`Client import map specifier collision: ${specifier}`);
		}
		imports.set(specifier, target);
	};
	for (const [specifier, name] of Object.entries(input.runtime.entries).sort(([left], [right]) =>
		compareNames(left, right),
	)) {
		if (specifier === "bootstrap") {
			continue;
		}
		if (!runtimeFiles.has(name)) {
			throw new Error(`Client runtime entry is missing its artifact file: ${name}`);
		}
		requireCanonicalPath(name);
		addImport(specifier, `./runtime/${name}`);
	}

	const moduleSpecifiers = new Map<string, string>();
	for (const contributor of input.identity.contributors) {
		if (contributor.kind === "kernel-renderer") {
			const artifact = input.renderers[contributor.name];
			if (!artifact) {
				throw new Error(`Kernel renderer artifact is missing: ${contributor.name}`);
			}
			requireModuleFile(artifact, contributor.name);
			addImport(
				`@ryot-app/kernel-renderers/${contributor.name}`,
				`./renderers/${contributor.name}/module.js`,
			);
			continue;
		}

		const artifact = input.plugins[contributor.pluginSlug];
		if (!artifact) {
			throw new Error(`Client plugin artifact is missing: ${contributor.pluginSlug}`);
		}
		requireModuleFile(artifact, contributor.pluginSlug);
		const exports = contributor.exports
			.slice()
			.sort((left, right) => compareNames(left.name, right.name));
		for (const [index, declaration] of exports.entries()) {
			const specifier = `@ryot-app/plugins/${contributor.pluginSlug}/${declaration.name}`;
			const binding = `Export${index}`;
			addImport(specifier, `./plugins/${contributor.pluginSlug}/module.js`);
			moduleSpecifiers.set(specifier, binding);
		}
	}

	const descriptor = composeDescriptor(input.identity, moduleSpecifiers);
	const importMap = {
		imports: Object.fromEntries([...imports].sort(([left], [right]) => compareNames(left, right))),
	};
	const stylesheets = input.runtime.artifact.files
		.filter(({ contentType }) => contentType.startsWith("text/css"))
		.map(({ name }) => `./runtime/${name}`)
		.sort(compareNames);
	for (const contributor of input.identity.contributors) {
		const directory =
			contributor.kind === "plugin"
				? `plugins/${contributor.pluginSlug}`
				: `renderers/${contributor.name}`;
		const artifact =
			contributor.kind === "plugin"
				? input.plugins[contributor.pluginSlug]
				: input.renderers[contributor.name];
		if (
			artifact?.files.some(
				({ name, contentType }) => name === "module.css" && contentType.startsWith("text/css"),
			)
		) {
			stylesheets.push(`./${directory}/module.css`);
		}
	}
	const stylesheetLinks = stylesheets
		.map((href) => `\t\t<link rel="stylesheet" href="${escapeHtml(href)}" />`)
		.join("\n");
	const template = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${escapeHtml(input.identity.name)}</title>
${stylesheetLinks ? `${stylesheetLinks}\n` : ""}		<script type="importmap" id="ryot-client-importmap">${htmlJson(importMap)}</script>
		<script type="application/json" id="${CLIENT_ARTIFACT_METADATA_ELEMENT_ID}">${ARTIFACT_METADATA_PLACEHOLDER}</script>
		<script type="application/json" id="${COMPOSITION_ELEMENT_ID}">${htmlJson(descriptor)}</script>
	</head>
	<body>
		<div id="${CLIENT_ARTIFACT_ROOT_ELEMENT_ID}"></div>
		<script type="module" src="./runtime/${bootstrap}"></script>
	</body>
</html>
`;
	const nonHtmlFiles = [...files.values()].sort((left, right) =>
		compareNames(left.name, right.name),
	);
	const metadata = clientArtifactMetadata(
		stableStringify({ template, identity: input.identity }),
		nonHtmlFiles,
	);
	const metadataPlaceholder = `<script type="application/json" id="${CLIENT_ARTIFACT_METADATA_ELEMENT_ID}">${ARTIFACT_METADATA_PLACEHOLDER}</script>`;
	const html = template.replace(
		metadataPlaceholder,
		`<script type="application/json" id="${CLIENT_ARTIFACT_METADATA_ELEMENT_ID}">${htmlJson(metadata)}</script>`,
	);
	const htmlFile = clientArtifactFile({
		path: "index.html",
		bytes: new TextEncoder().encode(html),
		contentType: "text/html; charset=utf-8",
	});
	return {
		...metadata,
		files: [...nonHtmlFiles, htmlFile].sort((left, right) => compareNames(left.name, right.name)),
	};
};
