import { expect, layer } from "@effect/vitest";
import {
	AdminMiddleware,
	AuthMiddleware,
	AuthUnauthorized,
	DemoOperationProtected,
} from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { CalendarSourceNotFound } from "@ryot-app/contract/modules/calendar-sources/schemas";
import type { AccessClass } from "@ryot-app/contract/oauth";
import { CalendarSourceSlug, PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { HttpClientRequest, HttpRouter, HttpServer } from "effect/http";
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api";

import { makeAuthMiddleware } from "#modules/accounts/auth/service";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
} from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { CalendarSourcesServiceLive } from "./layer";
import { CalendarSourcesRoutesLive } from "./routes";
import { CalendarSourcesService } from "./service";
import { calendarSourcePackage } from "./test-support";

const owner = UserId.make("owner");
const recipient = UserId.make("recipient");
const client = HttpApiTest.groups(AppContract, ["calendarSources"]);

class RouteCaller extends Context.Service<
	RouteCaller,
	{ readonly sendAs: (userId: UserId, accessClass: AccessClass) => Effect.Effect<void> }
>()("test/RouteCaller") {}

const credential = (userId: UserId, accessClass: AccessClass) => ({
	authorization: {
		userId,
		accessClass,
		credential: { clientId: "ryot-web", kind: "oauth" as const },
	},
	user: {
		id: userId,
		image: null,
		name: userId,
		email: `${userId}@example.test`,
		preferences: { language: null, disableIntegrations: false },
		accountGeneration: { userId, token: "test-account-generation" },
	},
});

const routesLayer = Layer.unwrap(
	Effect.gen(function* () {
		const caller = yield* Ref.make<{ userId: UserId; accessClass: AccessClass }>({
			userId: owner,
			accessClass: "standard",
		});
		const serviceLayer = Layer.succeed(CalendarSourcesService, yield* CalendarSourcesService);
		const auth = makeAuthMiddleware(
			{
				apiKeyUser: () =>
					Effect.fail(new AuthUnauthorized({ reason: { code: "authentication-required" } })),
				oauthUser: (token) => {
					const [userId = "", accessClass] = token.split("|");
					return Effect.succeed(
						credential(UserId.make(userId), accessClass === "demo" ? "demo" : "standard"),
					);
				},
			},
			{ isActive: () => Effect.succeed(false) },
		);
		return Layer.mergeAll(
			CalendarSourcesRoutesLive,
			HttpServer.layerServices,
			Layer.succeed(AdminMiddleware, {
				adminToken: () =>
					Effect.fail(new AuthUnauthorized({ reason: { code: "admin-access-required" } })),
			}),
			HttpApiMiddleware.layerClient(AuthMiddleware, ({ next, request }) =>
				Effect.flatMap(Ref.get(caller), ({ userId, accessClass }) =>
					next(HttpClientRequest.bearerToken(request, `${userId}|${accessClass}`)),
				),
			),
			Layer.succeed(RouteCaller, {
				sendAs: (userId, accessClass) => Ref.set(caller, { userId, accessClass }),
			}),
		).pipe(
			Layer.provideMerge(serviceLayer),
			HttpRouter.provideRequest(serviceLayer),
			Layer.provideMerge(Layer.succeed(AuthMiddleware, auth)),
		);
	}),
).pipe(
	Layer.provideMerge(CalendarSourcesServiceLive.pipe(Layer.provideMerge(revisionDatabaseLayer))),
);

const overrides = Effect.fn(function* () {
	const session = yield* DatabaseSession;
	return yield* session.run((db) =>
		db
			.select({
				slug: tables.calendarSourceOverride.slug,
				userId: tables.calendarSourceOverride.userId,
				isHidden: tables.calendarSourceOverride.isHidden,
				pluginId: tables.calendarSourceOverride.pluginId,
			})
			.from(tables.calendarSourceOverride),
	);
});

const visibility = (pluginId: string, isHidden: boolean, slug = "dates") => ({
	isHidden,
	pluginId: PluginId.make(pluginId),
	slug: CalendarSourceSlug.make(slug),
});

layer(routesLayer)((test) => {
	test.effect("hides and shows an effective source for the authenticated user", () =>
		Effect.gen(function* () {
			const installed = yield* installRevisionPackage(calendarSourcePackage("alpha"), owner);
			const api = yield* client;
			expect(
				yield* api.calendarSources.setVisibility({ payload: visibility(installed.pluginId, true) }),
			).toEqual(visibility(installed.pluginId, true));
			expect(yield* overrides()).toEqual([
				{ slug: "dates", userId: owner, isHidden: true, pluginId: installed.pluginId },
			]);
			yield* api.calendarSources.setVisibility({ payload: visibility(installed.pluginId, true) });
			expect(yield* overrides()).toHaveLength(1);
			expect(
				yield* api.calendarSources.setVisibility({
					payload: visibility(installed.pluginId, false),
				}),
			).toEqual(visibility(installed.pluginId, false));
			expect(yield* overrides()).toEqual([]);
		}),
	);
});

layer(routesLayer)((test) => {
	test.effect(
		"returns the same not-found error for missing, uninstalled, and foreign sources",
		() =>
			Effect.gen(function* () {
				const caller = yield* RouteCaller;
				const installations = yield* PluginInstallationRepository;
				const own = yield* installRevisionPackage(calendarSourcePackage("own"), owner);
				const removed = yield* installRevisionPackage(calendarSourcePackage("removed"), owner);
				const foreign = yield* installRevisionPackage(calendarSourcePackage("foreign"), recipient);
				yield* installations.remove(removed.installation.id);
				const api = yield* client;
				const failures = [];
				for (const payload of [
					visibility(own.pluginId, true, "missing"),
					visibility(removed.pluginId, true),
					visibility(foreign.pluginId, true),
				]) {
					failures.push(yield* Effect.flip(api.calendarSources.setVisibility({ payload })));
				}
				yield* caller.sendAs(recipient, "standard");
				failures.push(
					yield* Effect.flip(
						api.calendarSources.setVisibility({ payload: visibility(own.pluginId, true) }),
					),
				);
				for (const failure of failures) {
					expect(failure).toBeInstanceOf(CalendarSourceNotFound);
					expect(failure).toMatchObject({ reason: { code: "calendar-source-not-found" } });
				}
				expect(yield* overrides()).toEqual([]);
			}),
	);
});

layer(routesLayer)((test) => {
	test.effect("rejects demo credentials before writing", () =>
		Effect.gen(function* () {
			const caller = yield* RouteCaller;
			const installed = yield* installRevisionPackage(calendarSourcePackage("alpha"), owner);
			yield* caller.sendAs(owner, "demo");
			const api = yield* client;
			const failure = yield* Effect.flip(
				api.calendarSources.setVisibility({ payload: visibility(installed.pluginId, true) }),
			);
			expect(failure).toBeInstanceOf(DemoOperationProtected);
			expect(yield* overrides()).toEqual([]);
		}),
	);
});
