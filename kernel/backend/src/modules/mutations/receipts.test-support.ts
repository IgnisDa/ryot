import { PluginId, type UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

import { fixtureManifest, insertPluginRevision } from "#modules/plugins/test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

export const pinReferences = (scopeUserId: UserId | null) => ({
	scopeUserId,
	pluginConfigRevisionId: null,
	sandboxScriptId: "receipt-pin-script",
	pluginRevisionId: "receipt-pin-revision",
	pluginId: PluginId.make("receipt-pin-plugin"),
});

export const seedPinTargets = Effect.fn(function* () {
	const session = yield* DatabaseSession;
	const { pluginId, sandboxScriptId, pluginRevisionId } = pinReferences(null);
	yield* session.run((db) =>
		Effect.gen(function* () {
			const manifest = fixtureManifest();
			yield* db
				.insert(tables.plugin)
				.values({ id: pluginId, status: "disabled", packageId: manifest.metadata.packageId })
				.onConflictDoNothing();
			const existing = yield* db
				.select({ id: tables.pluginRevision.id })
				.from(tables.pluginRevision)
				.where(eq(tables.pluginRevision.id, pluginRevisionId));
			if (existing.length === 0) {
				yield* insertPluginRevision(db, {
					manifest,
					pluginId,
					id: pluginRevisionId,
					contentHash: "receipt-pin-hash",
				});
			}
			yield* db
				.insert(tables.sandboxScript)
				.values({
					name: "Pinned",
					slug: "pinned",
					pluginRevisionId,
					id: sandboxScriptId,
					contentHash: "hash",
					compiledCode: "code",
					metadata: { kind: "automation", runtimeImports: [] },
				})
				.onConflictDoNothing();
		}),
	);
});
