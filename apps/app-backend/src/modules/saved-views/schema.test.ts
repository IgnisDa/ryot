import { expect, it } from "@effect/vitest";
import { getTableConfig } from "drizzle-orm/pg-core";

import { savedView } from "#lib/infrastructure/db/schema/tables/views";

it("constrains plugin installation ownership to the saved-view user", () => {
	const config = getTableConfig(savedView);
	const foreignKey = config.foreignKeys.find(
		(entry) => entry.getName() === "saved_view_plugin_installation_owner_fk",
	);
	const reference = foreignKey?.reference();
	expect(reference?.columns.map((column) => column.name)).toEqual([
		"plugin_installation_id",
		"user_id",
	]);
	expect(reference?.foreignColumns.map((column) => column.name)).toEqual(["id", "user_id"]);
	expect(foreignKey?.onDelete).toBe("restrict");
});
