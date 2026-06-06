import { and, eq, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import { CurrentDb, dbEffect, isUniqueConstraintError } from "#lib/db";
import * as schema from "#lib/db/schema/tables";
import { DbError, conflict } from "#lib/errors";
import type { UserId } from "#lib/schema/brands";
import { SandboxScriptId } from "#lib/schema/brands";

import type { SandboxScriptMetadata } from "./schemas";

type SandboxScriptRow = typeof schema.sandboxScript.$inferSelect;

type CreateScriptInput = {
	readonly slug: string;
	readonly name: string;
	readonly code: string;
	readonly userId: UserId;
	readonly metadata: SandboxScriptMetadata;
};

const sandboxScriptUserSlugConstraint = "sandbox_script_user_slug_unique";

const toScript = (row: SandboxScriptRow) => ({
	id: SandboxScriptId.make(row.id),
	slug: row.slug,
	code: row.code,
	name: row.name,
	isBuiltin: row.isBuiltin,
	metadata: row.metadata,
});

export class SandboxRepository extends Effect.Service<SandboxRepository>()("SandboxRepository", {
	sync: () => {
		const createScript = Effect.fn("SandboxRepository.createScript")(function* (
			input: CreateScriptInput,
		) {
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
		});

		const findScriptBySlugForUser = Effect.fn("SandboxRepository.findScriptBySlugForUser")(
			function* (input: { readonly slug: string; readonly userId: UserId }) {
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

				return row ? { id: SandboxScriptId.make(row.id) } : null;
			},
		);

		const getScriptForUser = Effect.fn("SandboxRepository.getScriptForUser")(function* (input: {
			readonly scriptId: SandboxScriptId;
			readonly userId: UserId | null;
		}) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({
						id: schema.sandboxScript.id,
						code: schema.sandboxScript.code,
						userId: schema.sandboxScript.userId,
						metadata: schema.sandboxScript.metadata,
						isBuiltin: schema.sandboxScript.isBuiltin,
					})
					.from(schema.sandboxScript)
					.where(
						and(
							eq(schema.sandboxScript.id, input.scriptId),
							input.userId === null
								? isNull(schema.sandboxScript.userId)
								: or(
										isNull(schema.sandboxScript.userId),
										eq(schema.sandboxScript.userId, input.userId),
									),
						),
					)
					.limit(1),
			);

			return row ? { ...row, id: SandboxScriptId.make(row.id) } : null;
		});

		return { createScript, findScriptBySlugForUser, getScriptForUser };
	},
}) {}
