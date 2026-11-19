import { expect } from "bun:test";

import { AuthMiddleware, DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { EntityUserDataBadRequest } from "@ryot-app/contract/modules/entity-user-data/schemas";
import { EventStale } from "@ryot-app/contract/modules/events/schemas";
import type { AccessClass } from "@ryot-app/contract/oauth";
import { EntityId, EventId, UserId } from "@ryot-app/contract/schema/brands";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { AuthUnauthorized } from "@ryot-app/instance-contract/admin-auth";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref } from "effect";
import { HttpClientRequest, HttpRouter, HttpServer } from "effect/http";
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api";

import { makeAuthMiddleware } from "#modules/accounts/auth/service";
import type { Changes } from "#modules/changes/changes";
import { ChangeSets } from "#modules/changes/service";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { rejectingAdminAndPublicationMiddleware } from "#testing/route-middleware";

import { EntityUserDataRoutesLive } from "./routes";

const owner = UserId.make("owner");
const recipient = UserId.make("recipient");
const client = HttpApiTest.groups(AppContract, ["entityUserData"]);
type RecordedCommand = { changes: Changes; command: DomainLifecycleCommand };

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
			weekStart: null,
			interfaceLocale: null,
			contentLanguage: null,
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
		const serviceLayer = Layer.mock(ChangeSets)({
			commit: (changes, command) =>
				changes.entities?.clears?.[0]?.entityId === "edited"
					? Effect.fail(
							new EventStale({ reason: { code: "event-stale", eventId: EventId.make("edited") } }),
						)
					: Ref.update(commands, (all) => [...all, { changes, command }]).pipe(
							Effect.as({
								outcomes: [],
								committed: { events: [] },
								cleared: (changes.entities?.clears ?? []).map(({ entityId }) => ({
									entityId,
									deletedEventsCount: 0,
									deletedRelationshipsCount: 0,
								})),
								merged: (changes.entities?.merges ?? []).map(({ mergeFrom, mergeInto }) => ({
									mergeFrom,
									mergeInto,
									movedEventsCount: 0,
									movedRelationshipsCount: 0,
								})),
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
				expect(yield* api.entityUserData.clearEntityUserData(clearRequest)).toEqual({
					deletedEventsCount: 0,
					deletedRelationshipsCount: 0,
					entityId: EntityId.make("entity"),
				});
				expect(
					yield* api.entityUserData.mergeEntityUserData({
						payload: { mergeFrom: EntityId.make("source"), mergeInto: EntityId.make("target") },
					}),
				).toEqual({
					movedEventsCount: 0,
					movedRelationshipsCount: 0,
					mergeFrom: EntityId.make("source"),
					mergeInto: EntityId.make("target"),
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
				expect(commands.map(({ changes }) => changes)).toEqual([
					{
						userId: owner,
						entities: { clears: [{ entitySchema: null, entityId: EntityId.make("entity") }] },
					},
					{
						userId: owner,
						entities: {
							merges: [
								{
									entitySchema: null,
									mergeFrom: EntityId.make("source"),
									mergeInto: EntityId.make("target"),
								},
							],
						},
					},
					{
						userId: recipient,
						entities: { clears: [{ entitySchema: null, entityId: EntityId.make("entity") }] },
					},
				]);
				expect(commands.map(({ command }) => command.writeContext)).toEqual([null, null, null]);
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

	test.effect(
		"reports a concurrent event change as an actionable user-data conflict",
		() =>
			Effect.gen(function* () {
				const api = yield* client;
				yield* (yield* RouteCaller).sendAs(owner, "standard");
				expect(
					yield* Effect.flip(
						api.entityUserData.clearEntityUserData({
							params: { entityId: EntityId.make("edited") },
						}),
					),
				).toEqual(new EntityUserDataBadRequest({ reason: { code: "state-conflict" } }));
			}),
		testTimeout,
	);
});
