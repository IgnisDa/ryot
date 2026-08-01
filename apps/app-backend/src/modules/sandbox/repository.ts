import { SandboxScriptId } from "@ryot/contract/schema/brands";
import type { WorkflowDurableCallRequest } from "@ryot/sandbox-sdk/workflow";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

const storedScriptSelection = {
	id: schema.sandboxScript.id,
	slug: schema.sandboxScript.slug,
	name: schema.sandboxScript.name,
	source: schema.sandboxScript.source,
	metadata: schema.sandboxScript.metadata,
	providerId: schema.sandboxScript.providerId,
	compiledCode: schema.sandboxScript.compiledCode,
	compiledFormat: schema.sandboxScript.compiledFormat,
};

type StoredScriptRow = Pick<
	typeof schema.sandboxScript.$inferSelect,
	"id" | "slug" | "name" | "source" | "metadata" | "providerId" | "compiledCode" | "compiledFormat"
>;

const toStoredScript = (row: StoredScriptRow) => ({
	...row,
	id: SandboxScriptId.make(row.id),
});

export const isWorkflowCallTargetKind = (
	request: WorkflowDurableCallRequest,
	kind: StoredScriptRow["metadata"]["kind"],
) =>
	((request.kind === "child" || request.kind === "workflow-child") && kind === "workflow") ||
	(request.kind === "activity" && kind === "script");

export class SandboxRepository extends Context.Service<SandboxRepository>()("SandboxRepository", {
	make: Effect.sync(() => {
		const getScript = Effect.fn("SandboxRepository.getScript")(function* (
			scriptId: SandboxScriptId,
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select({
						id: schema.sandboxScript.id,
						metadata: schema.sandboxScript.metadata,
						providerId: schema.sandboxScript.providerId,
						contentHash: schema.sandboxScript.contentHash,
						compiledCode: schema.sandboxScript.compiledCode,
						compiledFormat: schema.sandboxScript.compiledFormat,
					})
					.from(schema.sandboxScript)
					.where(eq(schema.sandboxScript.id, scriptId))
					.limit(1),
			);

			if (!row) {
				return null;
			}
			return { ...row, id: SandboxScriptId.make(row.id) };
		});

		const isPluginScript = Effect.fn("SandboxRepository.isPluginScript")(function* (
			scriptId: SandboxScriptId,
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select({ pluginId: schema.sandboxScript.pluginId })
					.from(schema.sandboxScript)
					.where(eq(schema.sandboxScript.id, scriptId))
					.limit(1),
			);
			return row?.pluginId != null;
		});

		const getScriptPin = Effect.fn("SandboxRepository.getScriptPin")(function* (
			scriptId: SandboxScriptId,
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select({
						id: schema.sandboxScript.id,
						pluginSlug: schema.plugin.slug,
						metadata: schema.sandboxScript.metadata,
						pluginId: schema.sandboxScript.pluginId,
						contentHash: schema.sandboxScript.contentHash,
					})
					.from(schema.sandboxScript)
					.leftJoin(schema.plugin, eq(schema.plugin.id, schema.sandboxScript.pluginId))
					.where(eq(schema.sandboxScript.id, scriptId))
					.limit(1),
			);
			return row
				? {
						pluginId: row.pluginId,
						pluginSlug: row.pluginSlug,
						contentHash: row.contentHash,
						scriptId: SandboxScriptId.make(row.id),
					}
				: null;
		});

		const resolveWorkflowCallScript = Effect.fn("SandboxRepository.resolveWorkflowCallScript")(
			function* (workflowScriptId: SandboxScriptId, request: WorkflowDurableCallRequest) {
				if (
					request.kind === "host" ||
					request.kind === "sleep" ||
					((request.kind === "child" || request.kind === "workflow-child") &&
						request.args.workflowSlug.startsWith("kernel:"))
				) {
					return null;
				}
				const db = yield* Database;
				const [owner] = yield* mapDatabaseErrors(
					db
						.select({ pluginId: schema.sandboxScript.pluginId })
						.from(schema.sandboxScript)
						.where(eq(schema.sandboxScript.id, workflowScriptId))
						.limit(1),
				);
				if (!owner?.pluginId) {
					return null;
				}
				const ownerPluginId = owner.pluginId;
				const [plugin] = yield* mapDatabaseErrors(
					db
						.select({
							manifest: schema.plugin.manifest,
							compiledHashes: schema.plugin.compiledHashes,
						})
						.from(schema.plugin)
						.where(eq(schema.plugin.id, ownerPluginId))
						.limit(1),
				);
				if (!plugin) {
					return null;
				}
				const scriptSlug =
					request.kind === "activity"
						? request.args.scriptSlug
						: plugin.manifest.workflows.find(({ slug }) => slug === request.args.workflowSlug)
								?.scriptSlug;
				if (!scriptSlug) {
					return null;
				}
				const contentHash = plugin.compiledHashes[scriptSlug];
				if (!contentHash) {
					return null;
				}
				const [target] = yield* mapDatabaseErrors(
					db
						.select({ id: schema.sandboxScript.id, metadata: schema.sandboxScript.metadata })
						.from(schema.sandboxScript)
						.where(
							and(
								eq(schema.sandboxScript.slug, scriptSlug),
								eq(schema.sandboxScript.pluginId, ownerPluginId),
								eq(schema.sandboxScript.contentHash, contentHash),
							),
						)
						.limit(1),
				);
				if (!target || !isWorkflowCallTargetKind(request, target.metadata.kind)) {
					return null;
				}
				return { kind: target.metadata.kind, scriptId: SandboxScriptId.make(target.id) };
			},
		);

		const getStoredScript = Effect.fn("SandboxRepository.getStoredScript")(function* (
			scriptId: SandboxScriptId,
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select(storedScriptSelection)
					.from(schema.sandboxScript)
					.where(eq(schema.sandboxScript.id, scriptId))
					.limit(1),
			);
			return row ? toStoredScript(row) : null;
		});

		const listStoredScripts = Effect.fn("SandboxRepository.listStoredScripts")(function* () {
			const db = yield* Database;
			const rows = yield* mapDatabaseErrors(
				db.select(storedScriptSelection).from(schema.sandboxScript),
			);
			return rows.map(toStoredScript);
		});

		return {
			getScript,
			getScriptPin,
			isPluginScript,
			getStoredScript,
			listStoredScripts,
			resolveWorkflowCallScript,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
