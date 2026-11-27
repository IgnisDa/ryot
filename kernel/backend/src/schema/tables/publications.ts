import type { PublicationDefinition } from "@ryot-app/contract/modules/publications/schemas";
import { PublicationId, PublicationLinkId } from "@ryot-app/contract/schema/brands";
import { generateId } from "better-auth";
import { boolean, foreignKey, index, integer, jsonb, snakeCase, text } from "drizzle-orm/pg-core";

import type { PublicationSnapshot } from "#modules/publications/model";

import { user } from "./auth";
import { clientArtifact } from "./client-artifacts";
import { page } from "./pages";
import { timestamptz, updatedAtColumn } from "./timestamps";

export const publication = snakeCase.table(
	"publication",
	{
		pageId: text(),
		description: text(),
		icon: text().notNull(),
		title: text().notNull(),
		revokedAt: timestamptz(),
		updatedAt: updatedAtColumn(),
		showOwnerName: boolean().notNull(),
		revision: integer().notNull().default(1),
		snapshot: jsonb().$type<PublicationSnapshot>(),
		createdAt: timestamptz().defaultNow().notNull(),
		definition: jsonb().$type<PublicationDefinition>().notNull(),
		snapshotArtifactHash: text().references(() => clientArtifact.hash),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.$type<PublicationId>()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ PublicationId.make(generateId())),
	},
	(table) => [
		index("publication_user_id_idx").on(table.userId),
		foreignKey({
			name: "publication_page_owner_fk",
			columns: [table.pageId, table.userId],
			foreignColumns: [page.id, page.userId],
		}).onDelete("restrict"),
	],
);

export const publicationLink = snakeCase.table(
	"publication_link",
	{
		label: text().notNull(),
		expiresAt: timestamptz(),
		revokedAt: timestamptz(),
		lastExchangedAt: timestamptz(),
		tokenHash: text().notNull().unique(),
		createdAt: timestamptz().defaultNow().notNull(),
		publicationId: text()
			.$type<PublicationId>()
			.notNull()
			.references(() => publication.id, { onDelete: "cascade" }),
		id: text()
			.$type<PublicationLinkId>()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ PublicationLinkId.make(generateId())),
	},
	(table) => [index("publication_link_publication_id_idx").on(table.publicationId)],
);
