import { and, eq, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect, isUniqueConstraintError, schema } from "~/lib/db";
import { DbError, conflict } from "~/lib/errors";

import type { SandboxScriptMetadata } from "./schemas";

type SandboxScriptRow = typeof schema.sandboxScript.$inferSelect;

type CreateScriptInput = {
	readonly slug: string;
	readonly name: string;
	readonly code: string;
	readonly userId: string;
	readonly metadata: SandboxScriptMetadata;
};

type FoundScript = {
	readonly id: string;
	readonly code: string;
	readonly userId: string | null;
	readonly metadata: SandboxScriptMetadata;
};

const sandboxScriptUserSlugConstraint = "sandbox_script_user_slug_unique";

const toScript = (row: SandboxScriptRow) => ({
	id: row.id,
	slug: row.slug,
	code: row.code,
	name: row.name,
	metadata: row.metadata,
});

export class SandboxRepository extends Effect.Service<SandboxRepository>()("SandboxRepository", {
	sync: () => ({
		createScript: (input: CreateScriptInput) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.sandboxScript)
						.values({
							isBuiltin: false,
							slug: input.slug,
							name: input.name,
							code: input.code,
							userId: input.userId,
							metadata: input.metadata,
						})
						.returning(),
				).pipe(
					Effect.mapError((error) =>
						isUniqueConstraintError(sandboxScriptUserSlugConstraint)(error)
							? conflict("A sandbox script with this slug already exists")
							: error,
					),
				);
				if (!row) {
					return yield* new DbError({ message: "Sandbox script insert returned no row" });
				}

				return toScript(row);
			}),
		findScriptBySlugForUser: (input: { readonly slug: string; readonly userId: string }) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ id: schema.sandboxScript.id })
						.from(schema.sandboxScript)
						.where(
							and(
								eq(schema.sandboxScript.slug, input.slug),
								eq(schema.sandboxScript.userId, input.userId),
							),
						)
						.limit(1),
				);

				return row ?? null;
			}),
		getScriptForUser: (input: { readonly scriptId: string; readonly userId: string }) =>
			Effect.gen(function* () {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({
							id: schema.sandboxScript.id,
							code: schema.sandboxScript.code,
							userId: schema.sandboxScript.userId,
							metadata: schema.sandboxScript.metadata,
						})
						.from(schema.sandboxScript)
						.where(
							and(
								eq(schema.sandboxScript.id, input.scriptId),
								or(
									isNull(schema.sandboxScript.userId),
									eq(schema.sandboxScript.userId, input.userId),
								),
							),
						)
						.limit(1),
				);

				return (row as FoundScript | undefined) ?? null;
			}),
	}),
}) {}
