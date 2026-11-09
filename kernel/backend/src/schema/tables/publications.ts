import type { PublicationSource } from "@ryot-app/contract/modules/publications/schemas";
import { PublicationId, PublicationLinkId } from "@ryot-app/contract/schema/brands";
import { generateId } from "better-auth";
import { boolean, index, integer, jsonb, snakeCase, text } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { timestamptz, updatedAtColumn } from "./timestamps";

export const publication = snakeCase.table(
	"publication",
	{
		description: text(),
		icon: text().notNull(),
		title: text().notNull(),
		revokedAt: timestamptz(),
		updatedAt: updatedAtColumn(),
		showOwnerName: boolean().notNull(),
		revision: integer().notNull().default(1),
		createdAt: timestamptz().defaultNow().notNull(),
		source: jsonb().$type<PublicationSource>().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.$type<PublicationId>()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ PublicationId.make(generateId())),
	},
	(table) => [index("publication_user_id_idx").on(table.userId)],
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
