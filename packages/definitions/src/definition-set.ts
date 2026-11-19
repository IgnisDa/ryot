import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import {
	mapPluginIdentityReferences,
	pluginIdentityReferences,
	type RyotQLDocument,
	stampRyotQLDocument,
} from "@ryot-app/contract/modules/ryotql/authored";
import { bindArguments } from "@ryot-app/contract/modules/ryotql/parameters";
import { PluginId } from "@ryot-app/contract/schema/brands";
import type { ControlSchema } from "@ryot-app/ryotql-recipes/controls";
import { presentationDocument } from "@ryot-app/ryotql-recipes/presentations";
import { storedValidationBranches } from "@ryot-app/ryotql-recipes/stored-validation";
import { Result } from "effect";

import { buildDefinitionSnapshot, type DefinitionSource } from "./snapshot";
import { mergeManifestDefinitions } from "./source";

export type DefinitionSetChange = {
	readonly scope: "user" | "system";
	readonly pluginIds: ReadonlySet<string>;
};

export type DefinitionSetPlugin = {
	readonly id: string;
	readonly manifest: PluginManifest;
	readonly scope?: "user" | "system";
};

export const validateDefinitionSet = (
	baseline: DefinitionSource,
	plugins: ReadonlyArray<DefinitionSetPlugin>,
	change?: DefinitionSetChange,
) => buildValidatedDefinitionSnapshot(mergeManifestDefinitions(baseline, plugins), plugins, change);

export const buildValidatedDefinitionSnapshot = (
	source: DefinitionSource,
	plugins: ReadonlyArray<DefinitionSetPlugin>,
	change?: DefinitionSetChange,
) => {
	const snapshot = buildDefinitionSnapshot(
		source,
		change && ((pluginId) => pluginId !== null && change.pluginIds.has(pluginId)),
	);
	validateStoredQueries(source, plugins, change);
	return snapshot;
};

const validateStoredQueries = (
	source: DefinitionSource,
	plugins: ReadonlyArray<DefinitionSetPlugin>,
	change: undefined | DefinitionSetChange,
) => {
	const ownerOf = (ownerId: null | string) => plugins.find(({ id }) => id === ownerId);
	const resolveOwner = (
		owner: undefined | DefinitionSetPlugin,
		reference: PluginIdentityReference,
	) => {
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
		return target;
	};
	const bindOwners = (document: RyotQLDocument, ownerId: null | string) => {
		const owner = ownerOf(ownerId);
		return Result.getOrThrow(
			mapPluginIdentityReferences(document, (reference) => ({
				kind: "local",
				pluginId: PluginId.make(resolveOwner(owner, reference).id),
			})),
		);
	};
	const isAffected = (ownerId: null | string, document: RyotQLDocument) => {
		if (change === undefined || (ownerId !== null && change.pluginIds.has(ownerId))) {
			return true;
		}
		const owner = ownerOf(ownerId);
		if (change.scope === "user" && (owner?.scope ?? "system") === "system") {
			return false;
		}
		return pluginIdentityReferences(document).some((reference) =>
			change.pluginIds.has(resolveOwner(owner, reference).id),
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
		const { dataSources } = view;
		if (dataSources === null || !isAffected(view.pluginId, dataSources)) {
			continue;
		}
		Result.getOrThrow(storedValidationBranches(bindOwners(dataSources, view.pluginId), schemas));
		const argumentsResult = bindArguments(dataSources.parameters, view.arguments);
		if (Result.isFailure(argumentsResult)) {
			throw new Error(
				`Saved view '${view.slug}': ${argumentsResult.failure.map(({ message }) => message).join("; ")}`,
			);
		}
	}
	for (const plugin of plugins) {
		for (const [schemaSlug, registration] of Object.entries(
			plugin.manifest.client?.entities ?? {},
		)) {
			if (!registration.presentation) {
				continue;
			}
			for (const scope of ["entity", "owner"] as const) {
				const document = presentationDocument({
					schemaSlug,
					pluginId: plugin.id,
					ids: ["presentation-subject"],
					fields: registration.presentation[scope],
					include: scope === "owner" ? registration.presentation.ownerIncludes : undefined,
				});
				if (isAffected(plugin.id, document)) {
					Result.getOrThrow(storedValidationBranches(bindOwners(document, plugin.id), schemas));
				}
			}
		}
		for (const [name, declaration] of Object.entries(plugin.manifest.queries ?? {})) {
			if (plugin.manifest.operations.some(({ slug }) => slug === name)) {
				throw new Error(`Query and operation share a tool name: ${name}`);
			}
			if (name.includes("/")) {
				throw new Error(`Query name '${name}' cannot contain '/'`);
			}
			const document = stampRyotQLDocument(plugin.id, declaration.document);
			if (isAffected(plugin.id, document)) {
				Result.getOrThrow(storedValidationBranches(bindOwners(document, plugin.id), schemas));
			}
		}
	}
};
