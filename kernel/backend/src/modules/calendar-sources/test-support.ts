import type { PluginCalendarSource } from "@ryot-app/contract/modules/plugins/manifest";
import type { ManifestText } from "@ryot-app/contract/modules/plugins/manifest-text";
import { EntitySchemaSlug, type PluginPackageId } from "@ryot-app/contract/schema/brands";
import { manifestCatalogs, testPluginPackageId } from "@ryot-app/contract/testing";
import { column, eq, field, pluginId, table } from "@ryot-app/ryotql";

import { revisionPackage } from "#modules/plugins/packages/revision.test-support";

const entity = table("entity", "entity");

export const calendarSourcePackage = (
	slug: string,
	version = "v1",
	packageId: PluginPackageId = testPluginPackageId(),
	name: ManifestText = { key: "test.dates" },
) => {
	const value = revisionPackage(slug, version, `${slug}-entity`, packageId);
	const calendarSource: PluginCalendarSource = {
		name,
		slug: "dates",
		icon: "calendar",
		startAt: "startAt",
		precision: "instant",
		caption: { params: { caption: "caption" }, text: { key: "test.dates.caption" } },
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
	const manifest = { ...value.manifest, calendarSources: [calendarSource] };
	return {
		...value,
		manifest,
		catalogs: manifestCatalogs(manifest),
		contentHash: `${slug}-${version}-calendar`,
	};
};
