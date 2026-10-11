import {
	definitionOwnerPluginId,
	type DeclarationReference,
	type DefinitionOwner,
	type SavedViewReference,
} from "@ryot-app/contract/modules/plugins/references";
import { and, eq, isNull, or } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { userSavedViewEffective } from "#schema/tables/definitions";

export const pluginIdWhere = (column: PgColumn, pluginId: string | null) =>
	pluginId === null ? isNull(column) : eq(column, pluginId);

export const ownerWhere = (column: PgColumn, owner: DefinitionOwner) =>
	pluginIdWhere(column, definitionOwnerPluginId(owner));

export const referenceWhere = (
	view: { pluginId: PgColumn; slug: PgColumn },
	reference: DeclarationReference,
) => and(ownerWhere(view.pluginId, reference.owner), eq(view.slug, reference.slug));

export const referencesWhere = (
	view: { pluginId: PgColumn; slug: PgColumn },
	references: ReadonlyArray<DeclarationReference>,
) => or(...references.map((reference) => referenceWhere(view, reference)));

export const installationSlugWhere = (
	view: { slug: PgColumn; installationId: PgColumn },
	slug: string,
	installationId: string,
) => and(eq(view.slug, slug), eq(view.installationId, installationId));

export const savedViewReferenceWhere = (reference: SavedViewReference) =>
	reference.kind === "custom"
		? and(
				eq(userSavedViewEffective.isBuiltin, false),
				eq(userSavedViewEffective.id, reference.savedViewId),
			)
		: and(
				eq(userSavedViewEffective.isBuiltin, true),
				eq(userSavedViewEffective.slug, reference.slug),
				pluginIdWhere(
					userSavedViewEffective.pluginId,
					reference.kind === "plugin" ? reference.pluginId : null,
				),
			);
