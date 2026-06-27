import type { CatalogSignalSchema } from "@ryot/contract/modules/automations/schemas";
import { SignalSchemaId } from "@ryot/contract/schema/brands";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

import { NOTIFICATION_SCRIPT_SLUG } from "./notification-install";

const catalogSignalSchemaGuard = and(
	eq(schema.signalSchema.isBuiltin, true),
	isNull(schema.signalSchema.userId),
	eq(schema.signalSchema.catalogState, "active"),
	isNull(schema.signalSchema.archivedAt),
);

const catalogSignalSchemaColumns = {
	id: schema.signalSchema.id,
	slug: schema.signalSchema.slug,
	name: schema.signalSchema.name,
	propertiesSchema: schema.signalSchema.propertiesSchema,
};

type CatalogSignalSchemaRow = Pick<
	typeof schema.signalSchema.$inferSelect,
	"id" | "name" | "propertiesSchema" | "slug"
>;

const toCatalogSignalSchema = (row: CatalogSignalSchemaRow): CatalogSignalSchema => ({
	slug: row.slug,
	name: row.name,
	catalogState: "active",
	id: SignalSchemaId.make(row.id),
	propertiesSchema: row.propertiesSchema,
});

export const makeAutomationNotificationRepository = () => {
	const getSharedNotificationScriptId = Effect.fn(
		"AutomationsRepository.getSharedNotificationScriptId",
	)(function* () {
		const db = yield* CurrentDb;
		const [row] = yield* dbEffect(() =>
			db
				.select({ id: schema.sandboxScript.id })
				.from(schema.sandboxScript)
				.where(
					and(
						eq(schema.sandboxScript.slug, NOTIFICATION_SCRIPT_SLUG),
						eq(schema.sandboxScript.isBuiltin, true),
						isNull(schema.sandboxScript.userId),
					),
				)
				.limit(1),
		);
		return row?.id ?? null;
	});

	const listCatalogSignalSchemas = Effect.fn("AutomationsRepository.listCatalogSignalSchemas")(
		function* () {
			const db = yield* CurrentDb;
			const rows = yield* dbEffect(() =>
				db
					.select(catalogSignalSchemaColumns)
					.from(schema.signalSchema)
					.where(catalogSignalSchemaGuard)
					.orderBy(asc(schema.signalSchema.name), asc(schema.signalSchema.id)),
			);
			return rows.map(toCatalogSignalSchema);
		},
	);

	const getCatalogSignalSchema = Effect.fn("AutomationsRepository.getCatalogSignalSchema")(
		function* (signalSchemaId: SignalSchemaId) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select(catalogSignalSchemaColumns)
					.from(schema.signalSchema)
					.where(and(catalogSignalSchemaGuard, eq(schema.signalSchema.id, signalSchemaId)))
					.limit(1),
			);
			return row ? toCatalogSignalSchema(row) : null;
		},
	);

	return {
		getCatalogSignalSchema,
		listCatalogSignalSchemas,
		getSharedNotificationScriptId,
	};
};
