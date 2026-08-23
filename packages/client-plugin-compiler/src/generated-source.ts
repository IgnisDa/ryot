import { relative as relativePath, resolve as resolvePath } from "node:path";

import { comparePluginRoutePaths } from "@ryot-app/contract/modules/plugins/manifest";
import { sortBy } from "@ryot-app/ts-utils/lodash";

import type {
	ClientPluginAutomaticRegistryEntry,
	ClientPluginCompilerPackageExport,
	ClientPluginCompilerPublicExport,
	ClientPluginExportKind,
	ClientPluginRouteRegistry,
} from "./input";

export const ARTIFACT_METADATA_PLACEHOLDER = "__RYOT_CLIENT_ARTIFACT_METADATA__";
export const GENERATED_BOOTSTRAP = "__generated/bootstrap.tsx";
export const GENERATED_VALIDATION = "__generated/validation.tsx";

const automaticRegistrySource = (
	automaticRegistry: readonly ClientPluginAutomaticRegistryEntry[],
) =>
	`{ entityPresentations: [${automaticRegistry
		.map(
			(registration, index) =>
				`{ ownerPluginId: ${JSON.stringify(registration.ownerPluginId)}, entitySchemaSlug: ${JSON.stringify(registration.entitySchemaSlug)}, layout: ${JSON.stringify(registration.layout)}, definition: AutomaticPresentation${index} }`,
		)
		.join(", ")}] }`;

export const pageEntrySource = (
	automaticRegistry: readonly ClientPluginAutomaticRegistryEntry[],
) => `
import { bootstrapClientPage } from "@ryot-app/client-sdk/plugin";
import Page from "@ryot-internal/application-entry";
${automaticRegistry.map(({ exportSpecifier }, index) => `import AutomaticPresentation${index} from ${JSON.stringify(exportSpecifier)};`).join("\n")}
bootstrapClientPage(Page, ${automaticRegistrySource(automaticRegistry)});
`;

export const pluginRouteEntrySource = (
	registry: ClientPluginRouteRegistry,
	automaticRegistry: readonly ClientPluginAutomaticRegistryEntry[],
) => {
	const routes = [...registry.routes].sort((left, right) =>
		comparePluginRoutePaths(left.path, right.path),
	);
	const registrations = [
		["Home", registry.home],
		...routes.map(({ exportSpecifier }, index) => [`Route${index}`, exportSpecifier]),
		...(registry.notFound === undefined ? [] : [["NotFound", registry.notFound]]),
		...automaticRegistry.map(({ exportSpecifier }, index) => [
			`AutomaticPresentation${index}`,
			exportSpecifier,
		]),
	] as const;
	return `
import { bootstrapClientPlugin } from "@ryot-app/client-sdk/plugin";
${registrations.map(([name, specifier]) => `import ${name} from ${JSON.stringify(specifier)};`).join("\n")}
bootstrapClientPlugin({
  home: { component: Home },
	  routes: [${routes
			.map(({ path }, index) => `{ path: ${JSON.stringify(path)}, component: Route${index} }`)
			.join(", ")}],
  ${registry.notFound === undefined ? "" : "notFound: NotFound,"}
}, ${automaticRegistrySource(automaticRegistry)});
`;
};

const publicExportType = (kind: ClientPluginExportKind | undefined) => {
	if (kind === "presentation") {
		return "EntityPresentationDefinition";
	}
	return kind === "component" ? "ComponentType<any>" : "ComponentType";
};

export const graphValidationSource = (
	publicSpecifiers: readonly string[],
	publicExports: Readonly<Record<string, ClientPluginCompilerPublicExport>>,
) => {
	const imports = [
		`import type { ComponentType } from "react";`,
		`import type { EntityPresentationDefinition } from "@ryot-app/client-sdk/plugin";`,
		`import Application from "@ryot-internal/application-entry";`,
		`const application: ComponentType = Application;`,
		`void application;`,
	];
	publicSpecifiers.forEach((specifier, index) => {
		imports.push(`import PublicExport${index} from ${JSON.stringify(specifier)};`);
		imports.push(
			`const publicExport${index}: ${publicExportType(publicExports[specifier]?.kind)} = PublicExport${index};`,
		);
		imports.push(`void publicExport${index};`);
	});
	return imports.join("\n");
};

export const packageValidationSource = (
	publicExports: Readonly<Record<string, ClientPluginCompilerPackageExport>>,
) => {
	const imports = [
		`import type { ComponentType } from "react";`,
		`import type { EntityPresentationDefinition } from "@ryot-app/client-sdk/plugin";`,
	];
	for (const [index, [, declaration]] of sortBy(
		Object.entries(publicExports),
		([name]) => name,
	).entries()) {
		imports.push(
			`import PublicExport${index} from ${JSON.stringify(`@ryot-internal/package-export-${index}`)};`,
		);
		imports.push(
			`const publicExport${index}: ${publicExportType(declaration.kind)} = PublicExport${index};`,
		);
		imports.push(`void publicExport${index};`);
	}
	return imports.join("\n");
};

export const packageDependencyDeclarations = (pluginDependencies: readonly string[]) =>
	pluginDependencies
		.map(
			(slug) =>
				`declare module ${JSON.stringify(`@ryot-app/plugins/${slug}/*`)} { const value: any; export default value; }`,
		)
		.join("\n");

const escapeHtmlText = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const generatedDocument = (name: string) => `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${escapeHtmlText(name)}</title>
		<script type="application/json" id="ryot-client-artifact">${ARTIFACT_METADATA_PLACEHOLDER}</script>
	</head>
	<body>
		<div id="app"></div>
		<script type="module" src="./bootstrap.tsx"></script>
	</body>
</html>
`;

const baseStylesheet = `@layer base {
	html, body { height: 100%; margin: 0; overflow: hidden; overscroll-behavior-y: none; -webkit-tap-highlight-color: transparent; }
	body { background: var(--bg); font-family: var(--font-family-ui); }
	#app { height: 100%; isolation: isolate; overflow: hidden; position: relative; }
}`;

export const compilerStylesheet = (
	reachableSources: readonly string[],
	sourcePath: string,
	generatedPath: string,
	clientSdkRoot: string,
	uiSdkRoot: string,
) => {
	const source = (path: string) =>
		`@source ${JSON.stringify(relativePath(generatedPath, path).replaceAll("\\", "/"))};`;
	return [
		'@import "@fontsource-variable/outfit";',
		'@import "@fontsource-variable/lora";',
		'@import "tailwindcss" source(none);',
		'@import "@ryot-app/client-ui-sdk/theme.css";',
		'@import "@ryot-app/client-ui-sdk/palette.css";',
		...reachableSources
			.filter((path) => /\.tsx?$/.test(path))
			.map((path) => source(resolvePath(sourcePath, path))),
		source(clientSdkRoot),
		source(uiSdkRoot),
		baseStylesheet,
	].join("\n");
};
