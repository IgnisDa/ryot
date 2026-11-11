import type { PageDefinition, PageOrigin } from "@ryot-app/contract/modules/pages/schemas";
import { generateId } from "better-auth";
import { boolean, integer, jsonb, snakeCase, text, unique } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { clientArtifact } from "./client-artifacts";
import { timestamptz, updatedAtColumn } from "./timestamps";

export const page = snakeCase.table(
	"page",
	{
		slug: text().notNull(),
		name: text().notNull(),
		publishedRevision: integer(),
		updatedAt: updatedAtColumn(),
		publishedDefinitionHash: text(),
		draftCompiledRevision: integer(),
		draftDefinitionHash: text().notNull(),
		origin: text().$type<PageOrigin>().notNull(),
		draftRevision: integer().notNull().default(1),
		writeAccess: boolean().notNull().default(false),
		createdAt: timestamptz().defaultNow().notNull(),
		authorityRevision: integer().notNull().default(1),
		publishedDefinition: jsonb().$type<PageDefinition>(),
		draftDefinition: jsonb().$type<PageDefinition>().notNull(),
		id: text()
			.primaryKey()
			.$defaultFn(() => generateId()),
		draftArtifactHash: text().references(() => clientArtifact.hash),
		publishedArtifactHash: text().references(() => clientArtifact.hash),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		unique("page_id_user_unique").on(table.id, table.userId),
		unique("page_user_slug_unique").on(table.userId, table.slug),
	],
);
