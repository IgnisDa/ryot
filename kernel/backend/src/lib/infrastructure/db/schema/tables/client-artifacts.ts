import { bytea, primaryKey, smallint, snakeCase, text } from "drizzle-orm/pg-core";

export const clientArtifact = snakeCase.table("client_artifact", {
	format: smallint().notNull(),
	apiVersion: smallint().notNull(),
	hash: text().notNull().primaryKey(),
	bridgeVersion: smallint().notNull(),
	compilerVersion: smallint().notNull(),
});

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
