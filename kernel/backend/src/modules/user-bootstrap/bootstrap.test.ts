import { expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database } from "#lib/infrastructure/db/service";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { ClientSurfaceMaterializer } from "#modules/plugins/client-surface-materializer";
import { PluginInstallationService } from "#modules/plugins/installation-service";

import { performBootstrap } from "./bootstrap";
import { PluginUserBootstrapDispatcher } from "./plugin-dispatch";

const userId = UserId.make("user-id");

const makeBootstrapDb = (options?: {
	bootstrapCompletedAt?: Date | null;
	onMarkComplete?: () => void;
}) => {
	const marker = options?.bootstrapCompletedAt ?? null;
	const userRows = [{ bootstrapCompletedAt: marker }];

	return Object.assign(Object.create(null), {
		execute: () => Effect.succeed({}),
		update: () => ({
			set: () => ({
				where: () => {
					options?.onMarkComplete?.();
					return Effect.succeed({});
				},
			}),
		}),
		select: () => ({
			from: (table: unknown) => {
				if (table !== schema.user) {
					return { where: () => Effect.succeed([]) };
				}
				return {
					where: () =>
						Object.assign(Effect.succeed(userRows), { for: () => Effect.succeed(userRows) }),
				};
			},
		}),
	});
};

const makeLayer = (options: {
	db?: object;
	onDefaultRules?: (userId: UserId) => void;
	onMaterializeBuilds?: (userId: UserId) => Effect.Effect<void>;
	onProvisionInstallations?: (userId: UserId) => void;
	dispatch: (userId: UserId) => Effect.Effect<void, SandboxRunError>;
}) => {
	const db = options.db ?? makeBootstrapDb();
	return Layer.mergeAll(
		Layer.succeed(
			Database,
			Database.of(
				Object.assign(Object.create(null), {
					transaction: ((callback) => callback(db)) satisfies Database["Service"]["transaction"],
				}),
			),
		),
		Layer.mock(PluginUserBootstrapDispatcher)({ dispatchAll: options.dispatch }),
		Layer.mock(PluginInstallationService)({
			provisionSystemInstallations: (inputUserId) =>
				Effect.sync(() => options.onProvisionInstallations?.(inputUserId)),
		}),
		Layer.mock(NotificationSubscriptionsService)({
			ensureDefaultRules: (inputUserId) => Effect.sync(() => options.onDefaultRules?.(inputUserId)),
		}),
		Layer.succeed(ClientSurfaceMaterializer, {
			materializeRenderer: () => Effect.void,
			assertUserCompositions: () => Effect.void,
			materializeSystemCompositions: Effect.void,
			materializePendingInstallation: () => Effect.void,
			materializeUserCompositions: (inputUserId) =>
				options.onMaterializeBuilds?.(inputUserId) ?? Effect.void,
		}),
	);
};

it.effect(
	"dispatches plugin bootstrap, ensures default rules, and sets the completion marker",
	() => {
		let markerUpdated = false;
		const order: string[] = [];
		const dispatchedUserIds: UserId[] = [];
		const defaultRuleUserIds: UserId[] = [];
		const provisionedUserIds: UserId[] = [];

		return Effect.gen(function* () {
			yield* performBootstrap(userId);

			expect(order).toEqual(["provision", "dispatch", "materialize-builds", "complete"]);
			expect(dispatchedUserIds).toEqual([userId]);
			expect(provisionedUserIds).toEqual([userId]);
			expect(defaultRuleUserIds).toEqual([userId]);
			expect(markerUpdated).toBe(true);
		}).pipe(
			Effect.provide(
				makeLayer({
					onDefaultRules: (inputUserId) => defaultRuleUserIds.push(inputUserId),
					onMaterializeBuilds: () =>
						Effect.sync(() => {
							order.push("materialize-builds");
						}),
					onProvisionInstallations: (inputUserId) => {
						order.push("provision");
						provisionedUserIds.push(inputUserId);
					},
					db: makeBootstrapDb({
						onMarkComplete: () => {
							order.push("complete");
							markerUpdated = true;
						},
					}),
					dispatch: (inputUserId) =>
						Effect.sync(() => {
							order.push("dispatch");
							dispatchedUserIds.push(inputUserId);
						}),
				}),
			),
		);
	},
);

it.effect("short-circuits when the completion marker is already set", () => {
	let dispatched = false;
	let defaultRulesEnsured = false;

	return Effect.gen(function* () {
		yield* performBootstrap(userId);

		expect(dispatched).toBe(false);
		expect(defaultRulesEnsured).toBe(false);
	}).pipe(
		Effect.provide(
			makeLayer({
				onDefaultRules: () => {
					defaultRulesEnsured = true;
				},
				dispatch: () =>
					Effect.sync(() => {
						dispatched = true;
					}),
				db: makeBootstrapDb({ bootstrapCompletedAt: new Date("2026-01-01T00:00:00Z") }),
			}),
		),
	);
});

it.effect("does not complete after plugin failure and reruns the plugin safely on retry", () => {
	let attempts = 0;
	let markerUpdated = false;

	return Effect.gen(function* () {
		const first = yield* Effect.exit(performBootstrap(userId));
		expect(first._tag).toBe("Failure");
		expect(markerUpdated).toBe(false);

		yield* performBootstrap(userId);
		expect(attempts).toBe(2);
		expect(markerUpdated).toBe(true);
	}).pipe(
		Effect.provide(
			makeLayer({
				db: makeBootstrapDb({ onMarkComplete: () => (markerUpdated = true) }),
				dispatch: () => {
					attempts += 1;
					return attempts === 1
						? Effect.fail(
								new SandboxRunError({ kind: "script-failure", message: "bootstrap failed" }),
							)
						: Effect.void;
				},
			}),
		),
	);
});

it.effect("does not complete account setup when a required boot-time build is absent", () => {
	let completed = false;
	return Effect.gen(function* () {
		const exit = yield* Effect.exit(performBootstrap(userId));
		expect(exit._tag).toBe("Failure");
		expect(completed).toBe(false);
	}).pipe(
		Effect.provide(
			makeLayer({
				dispatch: () => Effect.void,
				db: makeBootstrapDb({ onMarkComplete: () => (completed = true) }),
				onMaterializeBuilds: () => Effect.die(new Error("Missing baseline build")),
			}),
		),
	);
});
