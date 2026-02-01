import { expect, it } from "vitest";

import { buildLegacyUserLibraryMigrationSql } from "./user-auth-mapping";

it("builds restart-safe legacy library creation before membership mappings", () => {
	const sql = buildLegacyUserLibraryMigrationSql("library");

	expect(sql).toContain("md5('legacy-library:' || migrated_user.id)");
	expect(sql).toContain("'Library'");
	expect(sql).toContain("'library'");
	expect(sql).toContain("existing.external_id IS NULL");
	expect(sql).toContain("existing.provider_id IS NULL");
	expect(sql).toContain('ON CONFLICT ("id") DO NOTHING');
});
