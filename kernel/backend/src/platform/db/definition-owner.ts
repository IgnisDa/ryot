import {
	type DeclarationReference,
	type DefinitionOwner,
	definitionOwnerPluginId,
} from "@ryot-app/contract/modules/plugins/references";
import { and, eq, isNull } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export const pluginIdWhere = (column: PgColumn, pluginId: null | string) =>
	pluginId === null ? isNull(column) : eq(column, pluginId);

export const ownerWhere = (column: PgColumn, owner: DefinitionOwner) =>
	pluginIdWhere(column, definitionOwnerPluginId(owner));

export const referenceWhere = (
	view: { slug: PgColumn; pluginId: PgColumn },
	reference: DeclarationReference,
) => and(ownerWhere(view.pluginId, reference.owner), eq(view.slug, reference.slug));
