import { expect, it } from "@effect/vitest";
import { getTableConfig } from "drizzle-orm/pg-core";

import { entity, relationship } from "#lib/infrastructure/db/schema/tables/entities";

it("qualifies natural entity identities by their nullable schema plugin", () => {
	const config = getTableConfig(entity);
	expect(
		config.indexes.filter((entry) => entry.config.unique).map((entry) => entry.config.name),
	).toEqual([
		"entity_user_plugin_external_id_unique",
		"entity_user_kernel_external_id_unique",
		"entity_global_plugin_external_id_unique",
		"entity_global_kernel_external_id_unique",
		"entity_global_plugin_no_provider_external_id_unique",
		"entity_global_kernel_no_provider_external_id_unique",
	]);
});

it("uses null-safe qualified relationship identity", () => {
	const config = getTableConfig(relationship);
	expect(config.uniqueConstraints).toHaveLength(1);
	expect(config.uniqueConstraints[0]?.columns.map((column) => column.name)).toEqual([
		"user_id",
		"source_entity_id",
		"target_entity_id",
		"relationship_schema_slug",
		"relationship_schema_plugin_id",
	]);
	expect(config.uniqueConstraints[0]?.nullsNotDistinct).toBe(true);
});
