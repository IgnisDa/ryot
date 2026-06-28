import { DbError, conflict } from "@ryot/contract/errors";
import type { SandboxScriptManifest } from "@ryot/contract/modules/sandbox/schemas";
import type { UserId } from "@ryot/contract/schema/brands";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { and, eq, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect, isUniqueConstraintError } from "#lib/infrastructure/db/service";

type CreateScriptInput = {
	readonly slug: string;
	readonly name: string;
	readonly source: string;
	readonly userId: UserId;
	readonly compiledCode: string;
	readonly compiledFormat: number;
	readonly manifest: SandboxScriptManifest;
};

const sandboxScriptUserSlugConstraint = "sandbox_script_user_slug_unique";

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
						source: input.source,
						userId: input.userId,
						metadata: input.manifest,
						compiledCode: input.compiledCode,
						compiledFormat: input.compiledFormat,
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

			return {
				slug: row.slug,
				name: row.name,
				source: row.source,
				manifest: input.manifest,
				id: SandboxScriptId.make(row.id),
			};
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
						source: schema.sandboxScript.source,
						userId: schema.sandboxScript.userId,
						metadata: schema.sandboxScript.metadata,
						isBuiltin: schema.sandboxScript.isBuiltin,
						compiledCode: schema.sandboxScript.compiledCode,
						compiledFormat: schema.sandboxScript.compiledFormat,
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

		return {
			createScript,
			getScriptForUser,
			findScriptBySlugForUser,
		};
	},
}) {}
