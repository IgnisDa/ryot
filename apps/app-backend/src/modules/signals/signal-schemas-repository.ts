import { DbError } from "@ryot/contract/errors";
import {
	SignalAudiencePolicy,
	SignalCatalogState,
	type SignalAudiencePolicy as SignalAudiencePolicyValue,
	type SignalCatalogState as SignalCatalogStateValue,
} from "@ryot/contract/modules/automations/schemas";
import { SignalSchemaId, UserId } from "@ryot/contract/schema/brands";
import { decodeStoredAppSchema, decodeStoredSchema } from "@ryot/contract/schema/core";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

type SignalSchemaRow = typeof schema.signalSchema.$inferSelect;

export type SignalSchemaScope = {
	slug: string;
	name: string;
	id: SignalSchemaId;
	isBuiltin: boolean;
	userId: UserId | null;
	propertiesSchema: AppSchema;
	catalogState: SignalCatalogStateValue;
	audiencePolicy: SignalAudiencePolicyValue;
};

export type BuiltinSignalSchemaInput = Pick<
	SignalSchemaScope,
	"audiencePolicy" | "catalogState" | "name" | "propertiesSchema" | "slug"
>;

const toScope = Effect.fn(function* (row: SignalSchemaRow) {
	const propertiesSchema = yield* decodeStoredAppSchema(
		row.propertiesSchema,
		`Invalid properties schema for signal schema ${row.id}`,
	);
	const audiencePolicy = yield* decodeStoredSchema(
		row.audiencePolicy,
		SignalAudiencePolicy,
		`Invalid audience policy for signal schema ${row.id}`,
	);
	const catalogState = yield* decodeStoredSchema(
		row.catalogState,
		SignalCatalogState,
		`Invalid catalog state for signal schema ${row.id}`,
	);

	return {
		catalogState,
		audiencePolicy,
		slug: row.slug,
		name: row.name,
		propertiesSchema,
		isBuiltin: row.isBuiltin,
		id: SignalSchemaId.make(row.id),
		userId: row.userId ? UserId.make(row.userId) : null,
	};
});

export class SignalSchemasRepository extends Effect.Service<SignalSchemasRepository>()(
	"SignalSchemasRepository",
	{
		sync: () => {
			const activeBuiltinClause = and(
				eq(schema.signalSchema.isBuiltin, true),
				eq(schema.signalSchema.catalogState, "active"),
				isNull(schema.signalSchema.userId),
			);

			const listActiveBuiltins = Effect.fn("SignalSchemasRepository.listActiveBuiltins")(
				function* () {
					const db = yield* CurrentDb;
					const rows = yield* dbEffect(() =>
						db
							.select()
							.from(schema.signalSchema)
							.where(activeBuiltinClause)
							.orderBy(asc(schema.signalSchema.name), asc(schema.signalSchema.id)),
					);
					return yield* Effect.all(rows.map(toScope));
				},
			);

			const findActiveBuiltinById = Effect.fn("SignalSchemasRepository.findActiveBuiltinById")(
				function* (id: SignalSchemaId) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select()
							.from(schema.signalSchema)
							.where(and(eq(schema.signalSchema.id, id), activeBuiltinClause))
							.limit(1),
					);
					return row ? yield* toScope(row) : null;
				},
			);

			const findBuiltinById = Effect.fn("SignalSchemasRepository.findBuiltinById")(function* (
				id: SignalSchemaId,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select()
						.from(schema.signalSchema)
						.where(
							and(
								eq(schema.signalSchema.id, id),
								eq(schema.signalSchema.isBuiltin, true),
								isNull(schema.signalSchema.userId),
							),
						)
						.limit(1),
				);
				return row ? yield* toScope(row) : null;
			});

			const findGlobalBySlug = Effect.fn("SignalSchemasRepository.findGlobalBySlug")(function* (
				slug: string,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select()
						.from(schema.signalSchema)
						.where(and(eq(schema.signalSchema.slug, slug), isNull(schema.signalSchema.userId)))
						.limit(1),
				);
				return row ? yield* toScope(row) : null;
			});

			const findVisibleBySlug = Effect.fn("SignalSchemasRepository.findVisibleBySlug")(
				function* (input: { slug: string; userId: UserId | null }) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.select()
							.from(schema.signalSchema)
							.where(
								and(
									eq(schema.signalSchema.slug, input.slug),
									input.userId
										? or(
												isNull(schema.signalSchema.userId),
												eq(schema.signalSchema.userId, input.userId),
											)
										: isNull(schema.signalSchema.userId),
								),
							)
							.orderBy(
								sql`case when ${schema.signalSchema.userId} = ${input.userId} then 0 else 1 end`,
							)
							.limit(1),
					);
					return row ? yield* toScope(row) : null;
				},
			);

			const insertBuiltin = Effect.fn("SignalSchemasRepository.insertBuiltin")(function* (
				input: BuiltinSignalSchemaInput,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.signalSchema)
						.values({ ...input, isBuiltin: true })
						.returning(),
				);
				if (!row) {
					return yield* new DbError({ message: "Signal schema insert returned no row" });
				}
				return yield* toScope(row);
			});

			const updateBuiltinDisplay = Effect.fn("SignalSchemasRepository.updateBuiltinDisplay")(
				function* (input: {
					name: string;
					id: SignalSchemaId;
					catalogState: SignalCatalogStateValue;
				}) {
					const db = yield* CurrentDb;
					const [row] = yield* dbEffect(() =>
						db
							.update(schema.signalSchema)
							.set({ name: input.name, isBuiltin: true, catalogState: input.catalogState })
							.where(eq(schema.signalSchema.id, input.id))
							.returning(),
					);
					if (!row) {
						return yield* new DbError({ message: "Signal schema update returned no row" });
					}
					return yield* toScope(row);
				},
			);

			return {
				insertBuiltin,
				listActiveBuiltins,
				findBuiltinById,
				findGlobalBySlug,
				findVisibleBySlug,
				updateBuiltinDisplay,
				findActiveBuiltinById,
			};
		},
	},
) {}
