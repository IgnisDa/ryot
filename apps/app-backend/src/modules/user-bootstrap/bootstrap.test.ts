import { expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot/contract/errors";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, TransactionRunner } from "#lib/infrastructure/db/service";
import { NotificationSubscriptionsService } from "#modules/automations/notification-subscriptions-service";
import { SavedViewsService } from "#modules/saved-views/service";

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
		select: () => ({
			from: (table: unknown) => {
				if (table !== schema.user) {
					return { where: () => Promise.resolve([]) };
				}
				return {
					where: () =>
						Object.assign(Promise.resolve(userRows), {
							for: () => Promise.resolve(userRows),
						}),
				};
			},
		}),
		update: () => ({
			set: () => ({
				where: () => {
					options?.onMarkComplete?.();
					return Promise.resolve({});
				},
			}),
		}),
		execute: () => Promise.resolve({}),
	});
};

const makeLayer = (options: {
	db?: object;
	onDefaultRules?: (userId: UserId) => void;
	onBuiltinViews?: (userId: UserId) => void;
	dispatch: (userId: UserId) => Effect.Effect<undefined, SandboxRunError>;
}) => {
	const db = options.db ?? makeBootstrapDb();
	return Layer.mergeAll(
		Layer.succeed(TransactionRunner, <A, E, R>(effect: Effect.Effect<A, E, R>) =>
			Effect.provideService(effect, CurrentDb, db),
		),
		Layer.mock(PluginUserBootstrapDispatcher)({
			dispatchAll: options.dispatch,
		}),
		Layer.mock(NotificationSubscriptionsService)({
			ensureDefaultRules: (inputUserId) => Effect.sync(() => options.onDefaultRules?.(inputUserId)),
		}),
		Layer.mock(SavedViewsService)({
			ensureBuiltinViews: (inputUserId) => Effect.sync(() => options.onBuiltinViews?.(inputUserId)),
		}),
	);
};

it.effect(
	"dispatches plugin bootstrap, ensures default rules, and sets the completion marker",
	() => {
		let markerUpdated = false;
		const dispatchedUserIds: UserId[] = [];
		const defaultRuleUserIds: UserId[] = [];
		const builtinViewUserIds: UserId[] = [];

		return Effect.gen(function* () {
			yield* performBootstrap(userId);

			expect(dispatchedUserIds).toEqual([userId]);
			expect(builtinViewUserIds).toEqual([userId]);
			expect(defaultRuleUserIds).toEqual([userId]);
			expect(markerUpdated).toBe(true);
		}).pipe(
			Effect.provide(
				makeLayer({
					dispatch: (inputUserId) =>
						Effect.sync(() => {
							dispatchedUserIds.push(inputUserId);
						}).pipe(Effect.as(undefined)),
					db: makeBootstrapDb({ onMarkComplete: () => (markerUpdated = true) }),
					onDefaultRules: (inputUserId) => defaultRuleUserIds.push(inputUserId),
					onBuiltinViews: (inputUserId) => builtinViewUserIds.push(inputUserId),
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
				db: makeBootstrapDb({ bootstrapCompletedAt: new Date("2026-01-01T00:00:00Z") }),
				dispatch: () =>
					Effect.sync(() => {
						dispatched = true;
					}).pipe(Effect.as(undefined)),
				onDefaultRules: () => {
					defaultRulesEnsured = true;
				},
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
				dispatch: () => {
					attempts += 1;
					return attempts === 1
						? Effect.fail(new SandboxRunError({ message: "bootstrap failed" }))
						: Effect.sync((): undefined => undefined);
				},
				db: makeBootstrapDb({ onMarkComplete: () => (markerUpdated = true) }),
			}),
		),
	);
});
