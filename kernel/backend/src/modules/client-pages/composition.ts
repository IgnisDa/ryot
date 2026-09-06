import type {
	ClientArtifactFileReference,
	ClientCompositionModuleReference,
	ClientPageCompositionIdentity,
	ClientPageCompositionManifest,
} from "@ryot-app/contract/modules/client-pages/schemas";

export type ArtifactDescription = {
	readonly files: ReadonlyArray<{ readonly name: string; readonly contentType: string }>;
};

export const composeClientPage = (input: {
	readonly identity: ClientPageCompositionIdentity;
	readonly runtimeEntries: Readonly<Record<string, string>>;
	readonly artifacts: ReadonlyMap<string, ArtifactDescription>;
}): ClientPageCompositionManifest => {
	const { identity, artifacts, runtimeEntries } = input;
	const file = (artifactHash: string, name: string): ClientArtifactFileReference => {
		if (!artifacts.get(artifactHash)?.files.some((candidate) => candidate.name === name)) {
			throw new Error(`Client artifact ${artifactHash} is missing ${name}`);
		}
		return { file: name, artifactHash };
	};
	const bootstrap = runtimeEntries["bootstrap"];
	if (!bootstrap) {
		throw new Error("Client runtime is missing its bootstrap entry");
	}
	const imports: Record<string, ClientArtifactFileReference> = {};
	for (const [specifier, path] of Object.entries(runtimeEntries).sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		if (specifier !== "bootstrap") {
			imports[specifier] = file(identity.runtimeArtifactHash, path);
		}
	}
	const bindings = new Map<string, string>();
	const addImport = (
		specifier: string,
		reference: ClientArtifactFileReference,
		binding?: string,
	) => {
		if (specifier in imports) {
			throw new Error(`Client import map specifier collision: ${specifier}`);
		}
		imports[specifier] = reference;
		if (binding) {
			bindings.set(specifier, binding);
		}
	};
	for (const contributor of identity.contributors) {
		if (contributor.kind === "kernel-renderer") {
			addImport(
				`@ryot-app/kernel-renderers/${contributor.name}`,
				file(contributor.artifactHash, "module.js"),
				"Export0",
			);
		} else {
			for (const [index, declaration] of contributor.exports.entries()) {
				addImport(
					`@ryot-app/plugins/${contributor.pluginSlug}/${declaration.name}`,
					file(contributor.clientArtifactHash, "module.js"),
					`Export${index}`,
				);
			}
		}
	}
	const module = (specifier: string): ClientCompositionModuleReference => {
		const binding = bindings.get(specifier);
		if (!binding) {
			throw new Error(`Client composition export is missing: ${specifier}`);
		}
		return { binding, specifier };
	};
	const automaticRegistry = identity.automaticRegistry.map((registration) => ({
		layout: registration.layout,
		ownerPluginId: registration.ownerPluginId,
		module: module(registration.exportSpecifier),
		artifactClosure: registration.artifactClosure,
		entitySchemaSlug: registration.entitySchemaSlug,
		stylesheets: registration.artifactClosure.flatMap((hash) =>
			(artifacts.get(hash)?.files ?? [])
				.filter(({ contentType }) => contentType.startsWith("text/css"))
				.map(({ name }) => file(hash, name)),
		),
	}));
	const routes = identity.routeRegistry;
	let descriptor: ClientPageCompositionManifest["descriptor"];
	if (identity.application === "plugin-route") {
		if (!routes) {
			throw new Error("Plugin-route composition is missing its route registry");
		}
		descriptor = {
			automaticRegistry,
			application: "plugin-route",
			routes: {
				home: module(routes.home),
				routes: routes.routes.map(({ path, exportSpecifier }) => ({
					path,
					module: module(exportSpecifier),
				})),
				...(routes.notFound ? { notFound: module(routes.notFound) } : {}),
			},
		};
	} else {
		const contributor = identity.contributors.find(
			(item) =>
				item.namespace === identity.entry.contributor &&
				(item.kind !== "kernel-renderer" || item.entry === identity.entry.path),
		);
		if (!contributor) {
			throw new Error("Client page entry is missing its contributor");
		}
		const specifier =
			contributor.kind === "kernel-renderer"
				? `@ryot-app/kernel-renderers/${contributor.name}`
				: identity.selectedExports.find((candidate) => {
						const declaration = contributor.exports.find(
							({ name }) => candidate === `@ryot-app/plugins/${contributor.pluginSlug}/${name}`,
						);
						return declaration?.entry === identity.entry.path && declaration.kind === "page";
					});
		if (!specifier) {
			throw new Error("Client page entry does not match a selected export");
		}
		descriptor = { automaticRegistry, application: "page", entry: module(specifier) };
	}
	return {
		imports,
		identity,
		descriptor,
		bootstrap: file(identity.runtimeArtifactHash, bootstrap),
	};
};
