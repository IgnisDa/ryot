import { index, jsonb, snakeCase, text, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { timestamptz } from "./timestamps";

export type ProviderImportAdmissionStatus = "queued" | "running";

/**
 * Root provider imports that are waiting for, or holding, an admission slot. A row exists only
 * while its import is non-terminal; the workflow engine keeps the terminal result.
 */
export const providerImportAdmission = snakeCase.table(
	"provider_import_admission",
	{
		admittedAt: timestamptz(),
		payload: jsonb().notNull(),
		externalId: text().notNull(),
		providerId: text().notNull(),
		id: text().notNull().primaryKey(),
		entitySchemaSlug: text().notNull(),
		createdAt: timestamptz().defaultNow().notNull(),
		status: text().notNull().$type<ProviderImportAdmissionStatus>(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("provider_import_admission_status_created_at_idx").on(table.status, table.createdAt),
		uniqueIndex("provider_import_admission_identity_unique").on(
			table.userId,
			table.providerId,
			table.entitySchemaSlug,
			table.externalId,
		),
	],
);
