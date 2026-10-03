import { expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";

import { mapDatabaseErrors } from "#lib/infrastructure/db/errors";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { fakeDatabaseSession } from "#lib/test-utils/effect";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { PluginInstallationService } from "#modules/plugins/installation-service";

import { UserBootstrap } from "./bootstrap";
import { PluginUserBootstrapDispatcher } from "./plugin-dispatch";

const userId = UserId.make("user-id");

const append =
	<A>(ref: Ref.Ref<ReadonlyArray<A>>) =>
	(value: A) =>
		Ref.update(ref, (all) => [...all, value]);

type BootstrapStep = "provision" | "dispatch" | "complete";

class FakeBootstrapDependencies extends Context.Service<
	FakeBootstrapDependencies,
	{
		readonly order: Effect.Effect<ReadonlyArray<BootstrapStep>>;
		readonly completed: Effect.Effect<boolean>;
		readonly dispatchedUserIds: Effect.Effect<ReadonlyArray<UserId>>;
		readonly provisionedUserIds: Effect.Effect<ReadonlyArray<UserId>>;
		readonly defaultRuleUserIds: Effect.Effect<ReadonlyArray<UserId>>;
	}
>()("test/FakeBootstrapDependencies") {}

const performBootstrap = (inputUserId: UserId) =>
	Effect.flatMap(UserBootstrap, (bootstrap) =>
		bootstrap.perform(inputUserId, { userId: inputUserId, token: "test-account-generation" }),
	);

const bootstrapLayer = (options?: {
	bootstrapCompletedAt?: Date;
	dispatch?: (attempt: number) => Effect.Effect<void, SandboxRunError>;
}) =>
	UserBootstrap.layer.pipe(
		Layer.provideMerge(
			Layer.unwrap(
				Effect.gen(function* () {
					const order = yield* Ref.make<ReadonlyArray<BootstrapStep>>([]);
					const dispatched = yield* Ref.make<ReadonlyArray<UserId>>([]);
					const provisioned = yield* Ref.make<ReadonlyArray<UserId>>([]);
					const defaultRules = yield* Ref.make<ReadonlyArray<UserId>>([]);
					const userRows = [{ bootstrapCompletedAt: options?.bootstrapCompletedAt ?? null }];
					const db = Object.assign(Object.create(null), {
						execute: () => Effect.succeed({}),
						update: () => ({
							set: () => ({ where: () => append(order)("complete").pipe(Effect.as({})) }),
						}),
						select: (fields?: Readonly<Record<string, unknown>>) => ({
							from: (table: unknown) => {
								if (table !== schema.user) {
									return {
										where: () =>
											Object.assign(Effect.succeed([]), { limit: () => Effect.succeed([]) }),
									};
								}
								return {
									where: () =>
										Object.assign(Effect.succeed(userRows), {
											for: () =>
												fields && "token" in fields
													? Effect.succeed([{ token: "test-account-generation" }])
													: Effect.succeed(userRows),
										}),
								};
							},
						}),
					});
					return Layer.mergeAll(
						fakeDatabaseSession(db, { run: (statement) => mapDatabaseErrors(statement(db)) }),
						Layer.mock(PluginUserBootstrapDispatcher)({
							dispatchAll: (inputUserId) =>
								Effect.gen(function* () {
									yield* append(order)("dispatch");
									yield* append(dispatched)(inputUserId);
									const attempt = (yield* Ref.get(dispatched)).length;
									return yield* options?.dispatch?.(attempt) ?? Effect.void;
								}),
						}),
						Layer.mock(PluginInstallationService)({
							provisionSystemInstallations: (accountGeneration) =>
								append(order)("provision").pipe(
									Effect.andThen(append(provisioned)(accountGeneration.userId)),
								),
						}),
						Layer.mock(NotificationSubscriptionsService)({
							ensureDefaultRules: append(defaultRules),
						}),
						Layer.succeed(FakeBootstrapDependencies, {
							order: Ref.get(order),
							dispatchedUserIds: Ref.get(dispatched),
							provisionedUserIds: Ref.get(provisioned),
							defaultRuleUserIds: Ref.get(defaultRules),
							completed: Effect.map(Ref.get(order), (steps) => steps.includes("complete")),
						}),
					);
				}),
			),
		),
	);

layer(bootstrapLayer())((test) => {
	test.effect(
		"dispatches plugin bootstrap, ensures default rules, and sets the completion marker",
		() =>
			Effect.gen(function* () {
				yield* performBootstrap(userId);

				const fake = yield* FakeBootstrapDependencies;
				expect(yield* fake.order).toEqual(["provision", "dispatch", "complete"]);
				expect(yield* fake.dispatchedUserIds).toEqual([userId]);
				expect(yield* fake.provisionedUserIds).toEqual([userId]);
				expect(yield* fake.defaultRuleUserIds).toEqual([userId]);
				expect(yield* fake.completed).toBe(true);
			}),
	);
});

layer(bootstrapLayer({ bootstrapCompletedAt: new Date("2026-01-01T00:00:00Z") }))((test) => {
	test.effect("short-circuits when the completion marker is already set", () =>
		Effect.gen(function* () {
			yield* performBootstrap(userId);

			const fake = yield* FakeBootstrapDependencies;
			expect(yield* fake.dispatchedUserIds).toEqual([]);
			expect(yield* fake.defaultRuleUserIds).toEqual([]);
		}),
	);
});

layer(
	bootstrapLayer({
		dispatch: (attempt) =>
			attempt === 1
				? Effect.fail(new SandboxRunError({ kind: "script-failure", message: "bootstrap failed" }))
				: Effect.void,
	}),
)((test) => {
	test.effect("does not complete after plugin failure and reruns the plugin safely on retry", () =>
		Effect.gen(function* () {
			const fake = yield* FakeBootstrapDependencies;
			const first = yield* Effect.exit(performBootstrap(userId));
			expect(first._tag).toBe("Failure");
			expect(yield* fake.completed).toBe(false);

			yield* performBootstrap(userId);
			expect(yield* fake.dispatchedUserIds).toHaveLength(2);
			expect(yield* fake.completed).toBe(true);
		}),
	);
});
