import { SandboxScriptId } from "@ryot/contract/schema/brands";
import type { WorkflowDurableCallRequest } from "@ryot/sandbox-sdk/workflow";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

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
	(request.kind === "activity" && kind === "activity");

export class SandboxRepository extends Context.Service<SandboxRepository>()("SandboxRepository", {
	make: Effect.sync(() => {
		const getScript = Effect.fn("SandboxRepository.getScript")(function* (
			scriptId: SandboxScriptId,
		) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
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
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({ pluginSlug: schema.sandboxScript.pluginSlug })
					.from(schema.sandboxScript)
					.where(eq(schema.sandboxScript.id, scriptId))
					.limit(1),
			);
			return row?.pluginSlug != null;
		});

		const getScriptPin = Effect.fn("SandboxRepository.getScriptPin")(function* (
			scriptId: SandboxScriptId,
		) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select({
						id: schema.sandboxScript.id,
						metadata: schema.sandboxScript.metadata,
						pluginSlug: schema.sandboxScript.pluginSlug,
						contentHash: schema.sandboxScript.contentHash,
					})
					.from(schema.sandboxScript)
					.where(eq(schema.sandboxScript.id, scriptId))
					.limit(1),
			);
			return row
				? {
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
				const db = yield* CurrentDb;
				const [owner] = yield* dbEffect(() =>
					db
						.select({ pluginSlug: schema.sandboxScript.pluginSlug })
						.from(schema.sandboxScript)
						.where(eq(schema.sandboxScript.id, workflowScriptId))
						.limit(1),
				);
				if (!owner?.pluginSlug) {
					return null;
				}
				const ownerPluginSlug = owner.pluginSlug;
				const [plugin] = yield* dbEffect(() =>
					db
						.select({
							manifest: schema.plugin.manifest,
							compiledHashes: schema.plugin.compiledHashes,
						})
						.from(schema.plugin)
						.where(eq(schema.plugin.slug, ownerPluginSlug))
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
				const [target] = yield* dbEffect(() =>
					db
						.select({ id: schema.sandboxScript.id, metadata: schema.sandboxScript.metadata })
						.from(schema.sandboxScript)
						.where(
							and(
								eq(schema.sandboxScript.slug, scriptSlug),
								eq(schema.sandboxScript.pluginSlug, ownerPluginSlug),
								eq(schema.sandboxScript.contentHash, contentHash),
							),
						)
						.limit(1),
				);
				if (!target || !isWorkflowCallTargetKind(request, target.metadata.kind)) {
					return null;
				}
				return SandboxScriptId.make(target.id);
			},
		);

		const getStoredScript = Effect.fn("SandboxRepository.getStoredScript")(function* (
			scriptId: SandboxScriptId,
		) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
				db
					.select(storedScriptSelection)
					.from(schema.sandboxScript)
					.where(eq(schema.sandboxScript.id, scriptId))
					.limit(1),
			);
			return row ? toStoredScript(row) : null;
		});

		const listStoredScripts = Effect.fn("SandboxRepository.listStoredScripts")(function* () {
			const db = yield* CurrentDb;
			const rows = yield* dbEffect(() =>
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
