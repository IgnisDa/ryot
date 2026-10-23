import { expect, layer } from "@effect/vitest";
import { CalendarSourceSlug, PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { ascending, column, field, rows, table } from "@ryot-app/ryotql";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { assert } from "vitest";

import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
} from "#modules/plugins/packages/revision.test-support";
import { RyotQLService } from "#modules/ryotql/service";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { CalendarSourcesServiceLive } from "./layer";
import { CalendarSourcesService } from "./service";
import { calendarSourcePackage } from "./test-support";

const owner = UserId.make("owner");
const recipient = UserId.make("recipient");
const source = table("calendarSource", "source");

const databaseLayer = Layer.mergeAll(RyotQLService.layer, CalendarSourcesServiceLive).pipe(
	Layer.provideMerge(revisionDatabaseLayer),
);

const listSources = Effect.fn(function* (userId: UserId) {
	const service = yield* RyotQLService;
	const response = yield* service.executeForUser(userId, null, "plugin", {
		queries: {
			sources: rows(source, {
				orderBy: [ascending(column(source, "pluginId"))],
				fields: [
					field("name", column(source, "name")),
					field("slug", column(source, "slug")),
					field("query", column(source, "query")),
					field("startAt", column(source, "startAt")),
					field("subject", column(source, "subject")),
					field("pluginId", column(source, "pluginId")),
					field("isHidden", column(source, "isHidden")),
					field("precision", column(source, "precision")),
				],
			}),
		},
	});
	const result = response.data["sources"];
	assert(result?.type === "rows");
	return result.items;
});

const setInstallation = Effect.fn(function* (
	installationId: string,
	patch: Partial<typeof tables.pluginInstallation.$inferInsert>,
) {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		db
			.update(tables.pluginInstallation)
			.set(patch)
			.where(eq(tables.pluginInstallation.id, installationId)),
	);
});

layer(databaseLayer)((test) => {
	test.effect("stores sources per revision and reads only the active revision", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const plugins = yield* PluginRepository;
			const first = calendarSourcePackage("alpha", "v1");
			const installed = yield* installRevisionPackage(first, owner);
			const stored = () =>
				session.run((db) =>
					db
						.select({
							name: tables.definitionCalendarSource.name,
							pluginRevisionId: tables.definitionCalendarSource.pluginRevisionId,
						})
						.from(tables.definitionCalendarSource),
				);
			expect(yield* stored()).toEqual([{ name: "Dates", pluginRevisionId: installed.revisionId }]);
			expect(yield* listSources(owner)).toEqual([
				{
					name: "Dates",
					slug: "dates",
					isHidden: false,
					startAt: "startAt",
					precision: "instant",
					pluginId: installed.pluginId,
					subject: {
						entityAlias: "entity",
						schemas: [
							{ slug: "alpha-entity", owner: { kind: "plugin", pluginId: installed.pluginId } },
						],
					},
					query: {
						...first.manifest.calendarSources[0]?.query,
						where: {
							operator: "eq",
							type: "comparison",
							left: { type: "column", tableAlias: "entity", field: "entitySchemaPluginId" },
							right: {
								type: "pluginId",
								reference: { kind: "local", pluginId: installed.pluginId },
							},
						},
					},
				},
			]);

			yield* session.transaction(
				Effect.gen(function* () {
					yield* plugins.lockIngestion();
					yield* plugins.persist(
						calendarSourcePackage("alpha", "v2", first.manifest.metadata.packageId, "Renamed"),
						{ scope: "user", ownerId: owner, pluginId: PluginId.make(installed.pluginId) },
					);
				}),
			);
			const revisions = yield* stored();
			expect(revisions.map(({ name }) => name).sort()).toEqual(["Dates", "Renamed"]);
			expect(revisions.find(({ name }) => name === "Renamed")?.pluginRevisionId).not.toBe(
				installed.revisionId,
			);
			expect((yield* listSources(owner)).map(({ name }) => name)).toEqual(["Renamed"]);
		}),
	);
});

layer(databaseLayer)((test) => {
	test.effect("exposes only the caller's effective sources with their hidden state", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const installations = yield* PluginInstallationRepository;
			const calendar = yield* CalendarSourcesService;
			const system = yield* installRevisionPackage(calendarSourcePackage("system", "v1"));
			const own = yield* installRevisionPackage(calendarSourcePackage("own", "v1"), owner);
			const hidden = yield* installRevisionPackage(calendarSourcePackage("hidden", "v1"), owner);
			const pending = yield* installRevisionPackage(calendarSourcePackage("pending", "v1"), owner);
			const quarantined = yield* installRevisionPackage(
				calendarSourcePackage("quarantined", "v1"),
				owner,
			);
			const removed = yield* installRevisionPackage(calendarSourcePackage("removed", "v1"), owner);
			expect(yield* listSources(owner)).toHaveLength(6);
			yield* setInstallation(hidden.installation.id, { isHidden: true });
			yield* setInstallation(pending.installation.id, { health: "needs-configuration" });
			yield* setInstallation(quarantined.installation.id, {
				health: "incompatible",
				incompatibilityReason: "package-identity-conflict",
			});
			yield* installations.remove(removed.installation.id);
			yield* session.run((db) =>
				db.insert(tables.pluginInstallation).values([
					{ health: "ready", userId: recipient, id: "recipient-own", pluginId: own.pluginId },
					{ health: "ready", userId: recipient, id: "recipient-system", pluginId: system.pluginId },
				]),
			);

			yield* calendar.setVisibility(
				{ id: owner },
				{
					isHidden: true,
					pluginId: PluginId.make(own.pluginId),
					slug: CalendarSourceSlug.make("dates"),
				},
			);

			expect(
				(yield* listSources(owner)).map(({ pluginId, isHidden }) => [pluginId, isHidden]),
			).toEqual(
				[
					[own.pluginId, true],
					[system.pluginId, false],
				].sort(([left], [right]) => (String(left) < String(right) ? -1 : 1)),
			);
			expect(
				(yield* listSources(recipient)).map(({ pluginId, isHidden }) => [pluginId, isHidden]),
			).toEqual([[system.pluginId, false]]);
		}),
	);
});
