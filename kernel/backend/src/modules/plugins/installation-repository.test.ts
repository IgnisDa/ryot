import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { assert, describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database } from "#lib/infrastructure/db/service";

import { PluginInstallationRepository } from "./installation-repository";
import {
	installRevisionPackage,
	revisionPackage,
	withRevisionDatabase,
} from "./revision.test-support";

const owner = UserId.make("owner");
const timestamp = new Date("2026-08-23T12:00:00.000Z");

describe("installation revision persistence", () => {
	it.effect("scopes home-view writes to the owning user", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const repository = yield* PluginInstallationRepository;
				const installed = yield* installRevisionPackage(revisionPackage("notes"), owner);
				expect(
					yield* repository.setHomeSavedView(
						UserId.make("recipient"),
						installed.installation.id,
						null,
					),
				).toBe(false);
				expect(yield* repository.setHomeSavedView(owner, installed.installation.id, null)).toBe(
					true,
				);
			}),
		),
	);

	it.effect(
		"restores portable private config as encrypted revisions and preserves destination config when requested",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const repository = yield* PluginInstallationRepository;
					const db = yield* Database;
					const installed = yield* installRevisionPackage(revisionPackage("notes"), owner);
					const destination = yield* repository.updateState({
						sortOrder: 0,
						isDisabled: false,
						id: installed.installation.id,
						config: { token: "destination" },
					});
					assert(destination?.activeConfigRevisionId);
					const input = {
						sortOrder: 4,
						userId: owner,
						isDisabled: true,
						createdAt: timestamp,
						updatedAt: timestamp,
						id: "archive-installation",
						pluginId: installed.pluginId,
						health: "installing" as const,
						config: { token: "archived" },
					};
					const preserved = yield* repository.restore({ ...input, preserveExistingConfig: true });
					expect(preserved?.activeConfigRevisionId).toBe(destination.activeConfigRevisionId);
					expect(preserved?.config).toEqual({ token: "destination" });
					yield* repository.remove(installed.installation.id);
					const restored = yield* repository.restore({ ...input, preserveExistingConfig: false });
					assert(restored?.activeConfigRevisionId);
					expect(restored.id).toBe(installed.installation.id);
					expect(restored.uninstalledAt).toBeNull();
					expect(restored.config).toEqual({ token: "archived" });
					expect(restored.activeConfigRevisionId).not.toBe(destination.activeConfigRevisionId);
					const [retained] = yield* db
						.select()
						.from(tables.pluginConfigRevision)
						.where(eq(tables.pluginConfigRevision.id, destination.activeConfigRevisionId));
					assert(retained?.encryptedPayload);
					expect(retained.encryptedPayload.toString()).not.toContain("destination");
					expect((yield* repository.findById(installed.installation.id))?.config).toEqual({
						token: "archived",
					});
				}),
			),
	);

	it.effect(
		"keeps system environment configuration separate from restored installation preferences",
		() =>
			withRevisionDatabase(
				Effect.gen(function* () {
					const db = yield* Database;
					const repository = yield* PluginInstallationRepository;
					const installed = yield* installRevisionPackage(revisionPackage());
					const environmentRevisions = () =>
						db
							.select()
							.from(tables.pluginConfigRevision)
							.where(eq(tables.pluginConfigRevision.scope, "environment"));
					const before = yield* environmentRevisions();
					const restored = yield* repository.restore({
						sortOrder: 3,
						userId: owner,
						isDisabled: true,
						health: "installing",
						createdAt: timestamp,
						updatedAt: timestamp,
						pluginId: installed.pluginId,
						preserveExistingConfig: true,
						id: installed.installation.id,
						config: { token: "archive-secret" },
					});
					expect(restored?.config).toEqual({});
					expect(restored?.activeConfigRevisionId).toBeNull();
					expect(yield* environmentRevisions()).toEqual(before);
				}),
			),
	);
});
