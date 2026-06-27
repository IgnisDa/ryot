import { DbError, conflict } from "@ryot/contract/errors";
import type { SandboxScriptMetadata } from "@ryot/contract/modules/sandbox/schemas";
import type { UserId } from "@ryot/contract/schema/brands";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { and, eq, isNull, or } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import {
	CurrentDb,
	dbEffect,
	isUniqueConstraintError,
	lockUserAndCountOwnedRows,
} from "#lib/infrastructure/db/service";

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
	slug: row.slug,
	code: row.code,
	name: row.name,
	metadata: row.metadata,
	isBuiltin: row.isBuiltin,
	id: SandboxScriptId.make(row.id),
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

		const lockUserAndCountScripts = Effect.fn("SandboxRepository.lockUserAndCountScripts")(
			function* (userId: UserId) {
				return yield* lockUserAndCountOwnedRows({
					userId,
					table: schema.sandboxScript,
					ownerColumn: schema.sandboxScript.userId,
				});
			},
		);

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
						updatedAt: schema.sandboxScript.updatedAt,
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

		const findProviderInformation = Effect.fn("SandboxRepository.findProviderInformation")(
			function* (scriptId: SandboxScriptId) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ metadata: schema.sandboxScript.metadata })
						.from(schema.sandboxScript)
						.where(eq(schema.sandboxScript.id, scriptId))
						.limit(1),
				);

				return row?.metadata.providerInformation ?? null;
			},
		);

		const storeProviderArtifact = Effect.fn("SandboxRepository.storeProviderArtifact")(
			function* (input: { executionId: string; id: string; value: unknown }) {
				const db = yield* CurrentDb;
				const [inserted] = yield* dbEffect(() =>
					db
						.insert(schema.sandboxArtifact)
						.values(input)
						.onConflictDoNothing({ target: schema.sandboxArtifact.executionId })
						.returning({ id: schema.sandboxArtifact.id }),
				);
				if (inserted) {
					return inserted.id;
				}

				const [existing] = yield* dbEffect(() =>
					db
						.select({ id: schema.sandboxArtifact.id })
						.from(schema.sandboxArtifact)
						.where(eq(schema.sandboxArtifact.executionId, input.executionId))
						.limit(1),
				);
				return existing?.id ?? (yield* new DbError({ message: "Sandbox artifact insert failed" }));
			},
		);

		const getProviderArtifact = Effect.fn("SandboxRepository.getProviderArtifact")(
			function* (input: { executionId: string; id: string }) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ value: schema.sandboxArtifact.value })
						.from(schema.sandboxArtifact)
						.where(
							and(
								eq(schema.sandboxArtifact.executionId, input.executionId),
								eq(schema.sandboxArtifact.id, input.id),
							),
						)
						.limit(1),
				);
				return row ?? null;
			},
		);

		return {
			createScript,
			getScriptForUser,
			getProviderArtifact,
			storeProviderArtifact,
			lockUserAndCountScripts,
			findProviderInformation,
			findScriptBySlugForUser,
		};
	},
}) {}
