import {
	type DeclarationReference,
	type DefinitionOwner,
	definitionOwnerPluginId,
} from "@ryot-app/contract/modules/plugins/references";
import { and, eq, isNull, or } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export const pluginIdWhere = (column: PgColumn, pluginId: null | string) =>
	pluginId === null ? isNull(column) : eq(column, pluginId);

export const ownerWhere = (column: PgColumn, owner: DefinitionOwner) =>
	pluginIdWhere(column, definitionOwnerPluginId(owner));

export const referenceWhere = (
	view: { slug: PgColumn; pluginId: PgColumn },
	reference: DeclarationReference,
) => and(ownerWhere(view.pluginId, reference.owner), eq(view.slug, reference.slug));

export const referencesWhere = (
	view: { slug: PgColumn; pluginId: PgColumn },
	references: ReadonlyArray<DeclarationReference>,
) => or(...references.map((reference) => referenceWhere(view, reference)));

export const installationSlugWhere = (
	view: { slug: PgColumn; installationId: PgColumn },
	slug: string,
	installationId: string,
) => and(eq(view.slug, slug), eq(view.installationId, installationId));
