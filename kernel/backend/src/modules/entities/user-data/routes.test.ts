import { expect } from "bun:test";

import {
	AuthMiddleware,
	AuthUnauthorized,
	DemoOperationProtected,
} from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import type { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import type { AccessClass } from "@ryot-app/contract/oauth";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref } from "effect";
import { HttpClientRequest, HttpRouter, HttpServer } from "effect/http";
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api";

import { makeAuthMiddleware } from "#modules/accounts/auth/service";
import { rejectingAdminAndPublicationMiddleware } from "#testing/route-middleware";

import { EntityUserDataRoutesLive } from "./routes";
import { EntityUserDataService } from "./service";

const owner = UserId.make("owner");
const recipient = UserId.make("recipient");
const client = HttpApiTest.groups(AppContract, ["entityUserData"]);
type RecordedCommand = { action: "clear" | "merge"; command: LifecycleCommand };

class RouteCaller extends Context.Service<
	RouteCaller,
	{
		readonly recordedCommands: Effect.Effect<ReadonlyArray<RecordedCommand>>;
		readonly sendAs: (userId: UserId, accessClass: AccessClass) => Effect.Effect<void>;
	}
>()("@ryot-app/kernel-backend/modules/entities/user-data/routes.test/RouteCaller") {}

const credential = (userId: UserId, accessClass: AccessClass) => ({
	authorization: {
		userId,
		accessClass,
		writeAccess: "unattended" as const,
		credential: { clientId: "ryot-web", kind: "oauth" as const },
	},
	user: {
		id: userId,
		image: null,
		name: userId,
		accountUserId: userId,
		email: `${userId}@example.test`,
		preferences: {
			language: null,
			reportingTimeZone: UTC,
			disableIntegrations: false,
			ratingScale: "hundred" as const,
		},
	},
});

const routesLayer = Layer.unwrap(
	Effect.gen(function* () {
		const caller = yield* Ref.make<{ userId: UserId; accessClass: AccessClass }>({
			userId: owner,
			accessClass: "standard",
		});
		const commands = yield* Ref.make<ReadonlyArray<RecordedCommand>>([]);
		const recordCommand = (action: RecordedCommand["action"], command: LifecycleCommand) =>
			Ref.update(commands, (all) => [...all, { action, command }]);
		const serviceLayer = Layer.mock(EntityUserDataService)({
			clearEntityUserData: (_user, entityId, command) =>
				recordCommand("clear", command).pipe(
					Effect.as({
						entityId,
						warnings: [],
						deletedEventsCount: 0,
						deletedRelationshipsCount: 0,
					}),
				),
			mergeEntityUserData: (_user, payload, command) =>
				recordCommand("merge", command).pipe(
					Effect.as({
						warnings: [],
						movedEventsCount: 0,
						movedRelationshipsCount: 0,
						mergeFrom: payload.mergeFrom,
						mergeInto: payload.mergeInto,
					}),
				),
		});
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
			EntityUserDataRoutesLive,
			HttpServer.layerServices,
			rejectingAdminAndPublicationMiddleware,
			HttpApiMiddleware.layerClient(AuthMiddleware, ({ next, request }) =>
				Effect.flatMap(Ref.get(caller), ({ userId, accessClass }) =>
					next(HttpClientRequest.bearerToken(request, `${userId}|${accessClass}`)),
				),
			),
			Layer.succeed(RouteCaller, {
				recordedCommands: Ref.get(commands),
				sendAs: (userId, accessClass) => Ref.set(caller, { userId, accessClass }),
			}),
		).pipe(
			Layer.provideMerge(serviceLayer),
			HttpRouter.provideRequest(serviceLayer),
			Layer.provideMerge(Layer.succeed(AuthMiddleware, auth)),
		);
	}),
);

layer(routesLayer)((test) => {
	test.effect(
		"writes clear and merge commands for the caller and refuses demo access",
		() =>
			Effect.gen(function* () {
				const api = yield* client;
				const caller = yield* RouteCaller;
				const clearRequest = { params: { entityId: EntityId.make("entity") } };
				yield* api.entityUserData.clearEntityUserData(clearRequest);
				yield* api.entityUserData.mergeEntityUserData({
					payload: { mergeFrom: EntityId.make("source"), mergeInto: EntityId.make("target") },
				});
				yield* caller.sendAs(recipient, "standard");
				yield* api.entityUserData.clearEntityUserData(clearRequest);
				const failure = yield* Effect.flip(
					caller
						.sendAs(recipient, "demo")
						.pipe(Effect.andThen(api.entityUserData.clearEntityUserData(clearRequest))),
				);
				expect(failure).toBeInstanceOf(DemoOperationProtected);
				const commands = yield* caller.recordedCommands;
				expect(commands.map(({ command }) => command.itemIdentity)).toEqual([
					"entity-user-data:clear",
					"entity-user-data:merge",
					"entity-user-data:clear",
				]);
				expect(commands.map(({ command }) => command.causation.initiator)).toEqual([
					{ id: owner, kind: "user" },
					{ id: owner, kind: "user" },
					{ kind: "user", id: recipient },
				]);
			}),
		testTimeout,
	);
});
