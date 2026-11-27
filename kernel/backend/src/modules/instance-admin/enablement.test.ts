import { expect } from "bun:test";

import { DbError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { partialFake } from "@ryot-app/testing/fakes";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq, sql } from "drizzle-orm";
import { DateTime, Effect, Layer } from "effect";

import { AuthRepository } from "#modules/accounts/auth/repository";
import { AuthService } from "#modules/accounts/auth/service";
import { UserLifecycleService } from "#modules/accounts/lifecycle/service";
import { type CatalogEntitySchema, DefinitionCatalog } from "#modules/definitions/catalog";
import { DefinitionRepository } from "#modules/definitions/repository";
import { FoldMarks } from "#modules/derived-values/marks";
import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import { job } from "#schema/tables/jobs";
import { makeAppConfigLayer } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { InstanceAdminRepository } from "./repository";
import { InstanceAdminService } from "./service";

const catalog = Layer.succeed(
	DefinitionCatalog,
	partialFake<DefinitionCatalog["Service"]>({
		forUser: () =>
			Effect.succeed(
				partialFake<Effect.Success<ReturnType<DefinitionCatalog["Service"]["forUser"]>>>({
					entitySchemas: [
						{
							isEffective: true,
							pluginId: "plugin-a",
							fold: { scriptSlug: "fold", eventSchemaSlugs: ["record"] },
						},
						{
							isEffective: true,
							pluginId: "plugin-a",
							fold: { scriptSlug: "fold", eventSchemaSlugs: ["other"] },
						},
						{
							isEffective: true,
							pluginId: "plugin-b",
							fold: { scriptSlug: "fold", eventSchemaSlugs: ["record"] },
						},
						{
							isEffective: false,
							pluginId: "inactive",
							fold: { scriptSlug: "fold", eventSchemaSlugs: ["record"] },
						},
						{ fold: null, isEffective: true, pluginId: "no-fold" },
					].map((schema) => partialFake<CatalogEntitySchema>(schema)),
				}),
			),
	}),
);

const testLayer = InstanceAdminService.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			InstanceAdminRepository.layer,
			Layer.effect(FoldMarks, FoldMarks.make).pipe(Layer.provide(catalog)),
			Layer.effect(
				AuthService,
				Effect.gen(function* () {
					const repository = yield* AuthRepository;
					return partialFake<AuthService["Service"]>({
						updateAuthUserDisabled: repository.updateUserDisabled,
					});
				}),
			).pipe(Layer.provide(AuthRepository.layer)),
			Layer.succeed(DefinitionRepository, partialFake<DefinitionRepository["Service"]>({})),
			Layer.succeed(UserLifecycleService, partialFake<UserLifecycleService["Service"]>({})),
			makeAppConfigLayer(),
		),
	),
	Layer.provideMerge(isolatedDatabaseLayer("account_enablement")),
);

layer(testLayer)((test) => {
	test.effect(
		"enablement queues one rebuild per effective fold plugin and repeated enablement adds none",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const service = yield* InstanceAdminService;
				const userId = UserId.make("enabled-account");
				yield* session.run((db) =>
					db
						.insert(user)
						.values({
							id: userId,
							name: "Account",
							disabledAt: new Date(),
							email: "enable@example.test",
						}),
				);
				yield* service.setUserDisabled(userId, false);
				const queued = yield* session.run((db) =>
					db.select().from(job).where(eq(job.userId, userId)),
				);
				expect(
					queued.map(({ key }) => key).sort((a, b) => (a ?? "").localeCompare(b ?? "")),
				).toEqual([`${userId}:plugin-a`, `${userId}:plugin-b`]);
				expect(queued.every(({ kind }) => kind === "fold-rebuild")).toBe(true);
				expect(
					(yield* session.run((db) => db.select().from(user).where(eq(user.id, userId))))[0]
						?.disabledAt,
				).toBeNull();
				yield* service.setUserDisabled(userId, false);
				expect(
					(yield* session.run((db) => db.select().from(job).where(eq(job.userId, userId))))
						.map(({ id }) => id)
						.sort(),
				).toEqual(queued.map(({ id }) => id).sort());
			}),
		testTimeout,
	);

	test.effect(
		"a failed rebuild admission rolls back enablement and earlier jobs",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const userId = UserId.make("rollback-account");
				const disabledAt = DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00Z"));
				yield* session.run((db) =>
					db
						.insert(user)
						.values({ id: userId, disabledAt, name: "Account", email: "rollback@example.test" }),
				);
				yield* session.run((db) =>
					db.execute(
						sql`alter table job add constraint reject_rebuild check (user_id <> 'rollback-account' or payload ->> 'pluginId' <> 'plugin-b')`,
					),
				);
				const exit = yield* Effect.exit(
					(yield* InstanceAdminService).setUserDisabled(userId, false),
				);
				assertExitFails(
					exit,
					new DbError({
						table: "job",
						code: "23514",
						constraint: "reject_rebuild",
						message: 'new row for relation "job" violates check constraint "reject_rebuild"',
					}),
				);
				expect(
					(yield* session.run((db) => db.select().from(user).where(eq(user.id, userId))))[0]
						?.disabledAt,
				).toEqual(disabledAt);
				expect(
					yield* session.run((db) => db.select().from(job).where(eq(job.userId, userId))),
				).toEqual([]);
			}),
		testTimeout,
	);
});
