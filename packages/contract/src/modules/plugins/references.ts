import { Schema } from "effect";

import {
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginId,
	PluginPackageId,
	RelationshipSchemaSlug,
	SavedViewId,
	SignalSchemaSlug,
} from "../../schema/brands";
import type { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";

export const DefinitionOwner = Schema.Union([
	strictStruct({ kind: Schema.Literal("kernel") }),
	strictStruct({ pluginId: PluginId, kind: Schema.Literal("plugin") }),
]);
export type DefinitionOwner = typeof DefinitionOwner.Type;

export const AuthoredDefinitionOwner = Schema.Union([
	strictStruct({ kind: Schema.Literal("kernel") }),
	strictStruct({ kind: Schema.Literal("self") }),
]);
export type AuthoredDefinitionOwner = typeof AuthoredDefinitionOwner.Type;

export const AuthoredEntitySchemaReference = strictStruct({
	slug: EntitySchemaSlug,
	owner: AuthoredDefinitionOwner,
});
export type AuthoredEntitySchemaReference = typeof AuthoredEntitySchemaReference.Type;

export const PluginPackageReference = strictStruct({
	packageId: PluginPackageId,
	scope: Schema.Literals(["system", "user"]),
});
export type PluginPackageReference = typeof PluginPackageReference.Type;

export const PluginIdentityReference = Schema.Union([
	strictStruct({ kind: Schema.Literal("self") }),
	strictStruct({ pluginId: PluginId, kind: Schema.Literal("local") }),
	strictStruct({ kind: Schema.Literal("package"), ...PluginPackageReference.fields }),
]);
export type PluginIdentityReference = typeof PluginIdentityReference.Type;

export const EntitySchemaReference = strictStruct({
	owner: DefinitionOwner,
	slug: EntitySchemaSlug,
});
export type EntitySchemaReference = typeof EntitySchemaReference.Type;

export const EventSchemaReference = strictStruct({
	slug: EventSchemaSlug,
	owner: DefinitionOwner,
	entitySchemaSlug: EntitySchemaSlug,
});
export type EventSchemaReference = typeof EventSchemaReference.Type;

export const RelationshipSchemaReference = strictStruct({
	owner: DefinitionOwner,
	slug: RelationshipSchemaSlug,
});
export type RelationshipSchemaReference = typeof RelationshipSchemaReference.Type;

export const SignalSchemaReference = strictStruct({
	owner: DefinitionOwner,
	slug: SignalSchemaSlug,
});
export type SignalSchemaReference = typeof SignalSchemaReference.Type;

export const DeclarationReference = strictStruct({ slug: Schema.String, owner: DefinitionOwner });
export type DeclarationReference = typeof DeclarationReference.Type;

export const ProviderReference = strictStruct({ slug: Schema.String, owner: DefinitionOwner });
export type ProviderReference = typeof ProviderReference.Type;

export const OperationReference = strictStruct({ slug: Schema.String, owner: DefinitionOwner });
export type OperationReference = typeof OperationReference.Type;

export const SavedViewReference = Schema.Union([
	strictStruct({ savedViewId: SavedViewId, kind: Schema.Literal("custom") }),
	strictStruct({ slug: Schema.String, kind: Schema.Literal("kernel") }),
	strictStruct({ pluginId: PluginId, slug: Schema.String, kind: Schema.Literal("plugin") }),
]);
export type SavedViewReference = typeof SavedViewReference.Type;

export const definitionOwner = (pluginId: string | null): DefinitionOwner =>
	pluginId === null ? { kind: "kernel" } : { kind: "plugin", pluginId: PluginId.make(pluginId) };

export const definitionKey = (
	kind: string,
	owner: DefinitionOwner,
	...localSlugs: readonly string[]
) =>
	identityTupleKey(
		kind,
		owner.kind,
		owner.kind === "plugin" ? owner.pluginId : null,
		...localSlugs,
	);

export const identityTupleKey = (...components: readonly JsonValue[]) => JSON.stringify(components);

export const pluginPackageKey = (reference: PluginPackageReference) =>
	identityTupleKey(reference.scope, reference.packageId);

export const builtinSavedViewId = (userId: string, owner: DefinitionOwner, slug: string) =>
	SavedViewId.make(
		`builtin:${[userId, owner.kind, owner.kind === "plugin" ? owner.pluginId : "", slug]
			.map((component) => `${Array.from(component).length}:${component}`)
			.join("")}`,
	);
