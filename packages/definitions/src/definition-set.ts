import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	mapPluginIdentityReferences,
	type RyotQLDocument,
} from "@ryot-app/contract/modules/ryotql/authored";
import { bindArguments } from "@ryot-app/contract/modules/ryotql/parameters";
import { PluginId } from "@ryot-app/contract/schema/brands";
import type { ControlSchema } from "@ryot-app/ryotql-recipes/controls";
import { storedValidationBranches } from "@ryot-app/ryotql-recipes/stored-validation";
import { Result } from "effect";

import { buildDefinitionSnapshot, type DefinitionSource } from "./snapshot";
import { mergeManifestDefinitions } from "./source";

export type DefinitionSetPlugin = {
	readonly id: string;
	readonly manifest: PluginManifest;
	readonly scope?: "user" | "system";
};

export const validateDefinitionSet = (
	baseline: DefinitionSource,
	plugins: ReadonlyArray<DefinitionSetPlugin>,
) => buildValidatedDefinitionSnapshot(mergeManifestDefinitions(baseline, plugins), plugins);

export const buildValidatedDefinitionSnapshot = (
	source: DefinitionSource,
	plugins: ReadonlyArray<DefinitionSetPlugin>,
) => {
	validateStoredQueries(source, plugins);
	return buildDefinitionSnapshot(source);
};

const validateStoredQueries = (
	source: DefinitionSource,
	plugins: ReadonlyArray<DefinitionSetPlugin>,
) => {
	const bindOwners = (document: RyotQLDocument, ownerId: null | string) => {
		const owner = plugins.find(({ id }) => id === ownerId);
		return Result.getOrThrow(
			mapPluginIdentityReferences(document, (reference) => {
				let target: undefined | DefinitionSetPlugin;
				if (reference.kind === "self") {
					target = owner;
				} else if (reference.kind === "local") {
					target = plugins.find(({ id }) => id === reference.pluginId);
				} else {
					target = plugins.find(
						({ scope, manifest }) =>
							manifest.metadata.packageId === reference.packageId &&
							(scope ?? "system") === reference.scope,
					);
				}
				if (!target || ((owner?.scope ?? "system") === "system" && target.scope === "user")) {
					throw new Error(`Stored query has unavailable owner ${JSON.stringify(reference)}`);
				}
				return { kind: "local", pluginId: PluginId.make(target.id) };
			}),
		);
	};
	const schemas: readonly ControlSchema[] = source.entitySchemas.map((schema) => ({
		slug: schema.slug,
		isEffective: true,
		pluginId: schema.pluginId,
		browse: schema.browse ?? null,
		packageId:
			plugins.find(({ id }) => id === schema.pluginId)?.manifest.metadata.packageId ?? null,
		pluginScope:
			schema.pluginId === null
				? null
				: (plugins.find(({ id }) => id === schema.pluginId)?.scope ?? "system"),
	}));
	for (const view of source.savedViews) {
		if (view.dataSources === null) {
			continue;
		}
		Result.getOrThrow(
			storedValidationBranches(bindOwners(view.dataSources, view.pluginId), schemas),
		);
		const argumentsResult = bindArguments(view.dataSources.parameters, view.arguments);
		if (Result.isFailure(argumentsResult)) {
			throw new Error(
				`Saved view '${view.slug}': ${argumentsResult.failure.map(({ message }) => message).join("; ")}`,
			);
		}
	}
	for (const plugin of plugins) {
		for (const [name, declaration] of Object.entries(plugin.manifest.queries ?? {})) {
			if (plugin.manifest.operations.some(({ slug }) => slug === name)) {
				throw new Error(`Query and operation share a tool name: ${name}`);
			}
			if (name.includes("/")) {
				throw new Error(`Query name '${name}' cannot contain '/'`);
			}
			const document = bindOwners(declaration.document, plugin.id);
			Result.getOrThrow(storedValidationBranches(document, schemas));
		}
	}
};
