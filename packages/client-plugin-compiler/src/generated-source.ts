import { relative as relativePath, resolve as resolvePath } from "node:path";

import { sortBy } from "@ryot-app/ts-utils/lodash";

import type { ClientPluginCompilerPackageExport, ClientPluginExportKind } from "./input";

export const GENERATED_VALIDATION = "__generated/validation.tsx";

const publicExportType = (kind: ClientPluginExportKind) => {
	if (kind === "presentation") {
		return "EntityPresentationDefinition";
	}
	return kind === "component" ? "ComponentType<any>" : "ComponentType";
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

const layerOrder = "@layer properties, theme, base, components, utilities;";

export const runtimeStylesheet = `${layerOrder}
@import "@fontsource-variable/outfit";
@import "@fontsource-variable/lora";
@import "tailwindcss/theme.css" layer(theme) theme(static);
@import "tailwindcss/preflight.css" layer(base);
@import "@ryot-app/client-ui-sdk/theme.css";
@import "@ryot-app/client-ui-sdk/palette.css";
@layer base {
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
		layerOrder,
		'@import "tailwindcss/theme.css" layer(theme) theme(reference);',
		'@import "tailwindcss/utilities.css" layer(utilities) source(none);',
		'@import "@ryot-app/client-ui-sdk/theme.css" reference;',
		...reachableSources
			.filter((path) => /\.tsx?$/.test(path))
			.map((path) => source(resolvePath(sourcePath, path))),
		source(clientSdkRoot),
		source(uiSdkRoot),
	].join("\n");
};
