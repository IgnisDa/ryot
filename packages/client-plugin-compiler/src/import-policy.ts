import {
	isNeutralPluginModule,
	isStylexTracerClientModule,
	isTrustedClientModule,
} from "./dependencies";

export type ClientImportPolicySources = {
	readonly assetNames: Readonly<Record<string, string>>;
	readonly files: Readonly<Record<string, string>>;
	readonly publicExports: Readonly<Record<string, string>>;
	readonly stylexTracer?: { readonly fingerprint: string };
	readonly unresolvedPluginDependencies?: readonly string[];
};

const PLUGIN_IMPORT =
	/^@ryot-app\/plugins\/([a-z0-9]+(?:[._-][a-z0-9]+)*)\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

const normalizeRelativePath = (importer: string, specifier: string) => {
	const parts = [...importer.split("/").slice(0, -1), ...specifier.split("/")];
	const normalized: string[] = [];
	for (const part of parts) {
		if (!part || part === ".") {
			continue;
		}
		if (part === "..") {
			if (normalized.length === 0) {
				return null;
			}
			normalized.pop();
			continue;
		}
		normalized.push(part);
	}
	return normalized.join("/");
};

const contributorRoot = (path: string) => {
	const client = path.lastIndexOf("/client/");
	const shared = path.lastIndexOf("/shared/");
	const boundary = Math.max(client, shared);
	return boundary === -1 ? "" : path.slice(0, boundary + 1);
};

export const isSharedClientSource = (path: string) =>
	path.startsWith("shared/") || path.includes("/shared/");

const reachableRoots = (importer: string) => {
	const root = contributorRoot(importer);
	return isSharedClientSource(importer) ? [`${root}shared/`] : [`${root}client/`, `${root}shared/`];
};

export const resolveClientLocalImport = (
	sources: Pick<ClientImportPolicySources, "assetNames" | "files">,
	importer: string,
	specifier: string,
) => {
	const path = normalizeRelativePath(importer, specifier);
	if (!path || !reachableRoots(importer).some((root) => path.startsWith(root))) {
		return null;
	}
	const candidates = [path, `${path}.tsx`, `${path}.ts`, `${path}/index.tsx`, `${path}/index.ts`];
	return (
		candidates.find(
			(candidate) =>
				Object.hasOwn(sources.files, candidate) || Object.hasOwn(sources.assetNames, candidate),
		) ?? null
	);
};

export const clientImportPolicyIssue = (
	sources: ClientImportPolicySources,
	importer: string,
	specifier: string,
) => {
	const shared = isSharedClientSource(importer);
	if (/^\.{1,2}\//.test(specifier)) {
		const resolved = resolveClientLocalImport(sources, importer, specifier);
		if (resolved === null) {
			return `Import "${specifier}" could not be resolved inside the plugin client sources`;
		}
		return sources.stylexTracer !== undefined && resolved.endsWith(".css")
			? "StyleX tracer sources may not import plugin stylesheets"
			: null;
	}
	if (specifier.startsWith("@ryot-app/plugins/")) {
		if (shared) {
			return `Import "${specifier}" is not allowed; plugin shared sources may only import Ryot plugin kit entry points`;
		}
		if (sources.publicExports[specifier] !== undefined) {
			return null;
		}
		const pluginSlug = PLUGIN_IMPORT.exec(specifier)?.[1];
		return pluginSlug !== undefined &&
			sources.unresolvedPluginDependencies?.includes(pluginSlug) === true
			? null
			: `Public plugin import "${specifier}" is not present in the authorized export map`;
	}
	if (shared) {
		return isNeutralPluginModule(specifier)
			? null
			: `Import "${specifier}" is not allowed; plugin shared sources may only import Ryot plugin kit entry points`;
	}
	return isTrustedClientModule(specifier) ||
		(sources.stylexTracer !== undefined && isStylexTracerClientModule(specifier))
		? null
		: `Import "${specifier}" is not allowed; client plugins may only import React and Ryot client SDK entry points`;
};
