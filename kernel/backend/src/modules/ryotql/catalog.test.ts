import { expect, it } from "@effect/vitest";
import { sql } from "drizzle-orm";

import {
	canAccessCatalogTable,
	expandCatalogSelections,
	resolveCatalogField,
	type CatalogField,
	type CatalogTable,
	type RyotQLAccess,
} from "./catalog";

const textField = (access?: CatalogField["access"]): CatalogField => ({
	kind: "text",
	nullable: false,
	resolve: () => sql`NULL`,
	...(access ? { access } : {}),
});

const kernelOnlyTable: CatalogTable = {
	primaryKey: ["id"],
	name: "kernel_only",
	fields: { id: textField(), audit: textField("admin"), secret: textField("kernel") },
	visibility: {
		user: { type: "owned", column: "user_id", includeGlobal: false, pluginReadable: false },
	},
};

const kernel = {
	type: "user",
	audience: "kernel",
	accessClass: "standard",
} as const satisfies RyotQLAccess;
const plugin = {
	type: "user",
	audience: "plugin",
	accessClass: "standard",
} as const satisfies RyotQLAccess;
const admin = { type: "admin" } as const satisfies RyotQLAccess;
const system = { type: "plugin" } as const satisfies RyotQLAccess;

it("grants tables only to scopes whose policy the table declares", () => {
	expect(canAccessCatalogTable(kernelOnlyTable, kernel)).toBe(true);
	expect(canAccessCatalogTable(kernelOnlyTable, plugin)).toBe(false);
	expect(canAccessCatalogTable(kernelOnlyTable, admin)).toBe(false);
	expect(canAccessCatalogTable(kernelOnlyTable, system)).toBe(false);

	const adminOnlyTable = { ...kernelOnlyTable, visibility: { admin: { type: "all" } } } as const;
	expect(canAccessCatalogTable(adminOnlyTable, admin)).toBe(true);
	expect(canAccessCatalogTable(adminOnlyTable, kernel)).toBe(false);
	expect(canAccessCatalogTable(adminOnlyTable, plugin)).toBe(false);
	expect(canAccessCatalogTable(adminOnlyTable, system)).toBe(false);
});

it("resolves restricted fields only for scopes allowed to read them", () => {
	const resolvable = (access: RyotQLAccess) =>
		["id", "audit", "secret", "constructor", "toString"].filter(
			(name) => resolveCatalogField(kernelOnlyTable, name, access) !== undefined,
		);

	expect(resolvable(kernel)).toEqual(["id", "secret"]);
	expect(resolvable(plugin)).toEqual(["id"]);
	expect(resolvable(system)).toEqual(["id"]);
	expect(resolvable(admin)).toEqual(["id", "audit", "secret"]);
});

it("expands wildcards to the fields the scope may read", () => {
	const expandedKeys = (access: RyotQLAccess) =>
		expandCatalogSelections(
			[{ type: "wildcard", tableAlias: "row" }],
			(alias) => (alias === "row" ? kernelOnlyTable : undefined),
			access,
		).fields.map((selection) => selection.key);

	expect(expandedKeys(kernel)).toEqual(["id", "secret"]);
	expect(expandedKeys(plugin)).toEqual(["id"]);
	expect(expandedKeys(system)).toEqual(["id"]);
	expect(expandedKeys(admin)).toEqual(["id", "audit", "secret"]);
});
