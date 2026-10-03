import type { PluginClientImport } from "@ryot-app/client-plugin-contract";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { sql } from "drizzle-orm";
import {
	bytea,
	check,
	jsonb,
	primaryKey,
	smallint,
	snakeCase,
	text,
	unique,
} from "drizzle-orm/pg-core";

export const clientArtifact = snakeCase.table(
	"client_artifact",
	{
		format: smallint().notNull(),
		clientDeclarationHash: text(),
		apiVersion: smallint().notNull(),
		hash: text().notNull().primaryKey(),
		bridgeVersion: smallint().notNull(),
		compilerVersion: smallint().notNull(),
		packageId: text().$type<PluginPackageId>(),
		imports: jsonb().$type<readonly PluginClientImport[]>().notNull().default([]),
	},
	(table) => [
		unique("client_artifact_hash_package_unique").on(table.hash, table.packageId),
		check(
			"client_artifact_package_declaration_check",
			sql`(${table.packageId} is null) = (${table.clientDeclarationHash} is null)`,
		),
	],
);

export const clientArtifactFile = snakeCase.table(
	"client_artifact_file",
	{
		name: text().notNull(),
		contents: bytea().notNull(),
		contentType: text().notNull(),
		artifactHash: text()
			.notNull()
			.references(() => clientArtifact.hash),
	},
	(table) => [primaryKey({ columns: [table.artifactHash, table.name] })],
);
