import type {
	ClientArtifactFileReference,
	ClientCompositionModuleReference,
	ClientPageCompositionIdentity,
	ClientPageCompositionManifest,
} from "@ryot-app/contract/modules/pages/schemas";
import { pluginExportSpecifier } from "@ryot-app/plugin-client-contract";

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
				"page",
			);
		} else {
			for (const declaration of contributor.exports) {
				addImport(
					pluginExportSpecifier(contributor, declaration.name),
					file(contributor.clientArtifactHash, "module.js"),
					declaration.name,
				);
			}
		}
	}
	const module = (
		specifier: string,
		binding = bindings.get(specifier),
	): ClientCompositionModuleReference => {
		if (!binding || bindings.get(specifier) !== binding) {
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
	let descriptor: ClientPageCompositionManifest["descriptor"];
	if (identity.application === "plugin-route") {
		const routes = identity.routes;
		descriptor = {
			automaticRegistry,
			application: "plugin-route",
			routes: {
				...(routes.home === undefined
					? {}
					: { home: module(routes.home.specifier, routes.home.binding) }),
				routes: routes.routes.map(({ path, module: reference }) => ({
					path,
					module: module(reference.specifier, reference.binding),
				})),
				...(routes.notFound
					? { notFound: module(routes.notFound.specifier, routes.notFound.binding) }
					: {}),
			},
		};
	} else {
		descriptor = {
			automaticRegistry,
			application: "page",
			entry: module(identity.entry.specifier, identity.entry.binding),
		};
	}
	return {
		imports,
		identity,
		descriptor,
		bootstrap: file(identity.runtimeArtifactHash, bootstrap),
	};
};
