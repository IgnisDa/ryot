import type { PluginCalendarSource } from "@ryot-app/contract/modules/plugins/manifest";
import { EntitySchemaSlug, type PluginPackageId } from "@ryot-app/contract/schema/brands";
import { column, eq, field, pluginId, table } from "@ryot-app/ryotql";

import { revisionPackage } from "#modules/plugins/packages/revision.test-support";
import { testPluginPackageId } from "#modules/plugins/test-support";

const entity = table("entity", "entity");

export const calendarSourcePackage = (
	slug: string,
	version = "v1",
	packageId: PluginPackageId = testPluginPackageId(),
	name = "Dates",
) => {
	const value = revisionPackage(slug, version, `${slug}-entity`, packageId);
	const calendarSource: PluginCalendarSource = {
		name,
		slug: "dates",
		icon: "calendar",
		startAt: "startAt",
		caption: "caption",
		precision: "instant",
		subject: {
			entityAlias: "entity",
			schemas: [{ owner: { kind: "self" }, slug: EntitySchemaSlug.make(`${slug}-entity`) }],
		},
		query: {
			from: entity,
			where: eq(column(entity, "entitySchemaPluginId"), pluginId({ kind: "self" })),
			output: {
				type: "rows",
				fields: [
					field("startAt", column(entity, "createdAt")),
					field("caption", column(entity, "name")),
				],
			},
		},
	};
	return {
		...value,
		contentHash: `${slug}-${version}-calendar`,
		manifest: { ...value.manifest, calendarSources: [calendarSource] },
	};
};
