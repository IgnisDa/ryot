import { expect, layer } from "@effect/vitest";
import {
	AdminMiddleware,
	AuthMiddleware,
	AuthUnauthorized,
	DemoOperationProtected,
} from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import type { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import type { AccessClass } from "@ryot-app/contract/oauth";
import { AutomationExecutionId, EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Ref } from "effect";
import { HttpClientRequest, HttpRouter, HttpServer } from "effect/http";
import { HttpApiMiddleware, HttpApiTest } from "effect/http-api";

import { makeAuthMiddleware } from "#modules/accounts/auth/service";

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
>()("test/EntityUserDataRouteCaller") {}

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

const executionId = (userId: UserId, action: string, idempotencyKey: string) =>
	`entity-user-data-${sha256Hex(stableStringify([userId, action, idempotencyKey]))}`;

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
	test.effect("preserves complete command identity for retries", () =>
		Effect.gen(function* () {
			const api = yield* client;
			const caller = yield* RouteCaller;
			const submittedAt = "2026-10-27T12:00:00.000Z";
			const clearRequest = {
				params: { entityId: EntityId.make("entity") },
				payload: { submittedAt, idempotencyKey: "clear-key" },
			};
			const changedSubmittedAtRequest = {
				...clearRequest,
				payload: { idempotencyKey: "clear-key", submittedAt: "2026-10-27T12:00:01.000Z" },
			};
			const mergeRequest = {
				payload: {
					submittedAt,
					idempotencyKey: "merge-key",
					mergeFrom: EntityId.make("source"),
					mergeInto: EntityId.make("target"),
				},
			};

			yield* api.entityUserData.clearEntityUserData(clearRequest);
			yield* api.entityUserData.clearEntityUserData(clearRequest);
			yield* api.entityUserData.mergeEntityUserData(mergeRequest);
			yield* api.entityUserData.mergeEntityUserData(mergeRequest);
			yield* api.entityUserData.clearEntityUserData(changedSubmittedAtRequest);
			yield* caller.sendAs(recipient, "standard");
			yield* api.entityUserData.clearEntityUserData(clearRequest);

			const failure = yield* Effect.flip(
				caller
					.sendAs(recipient, "demo")
					.pipe(Effect.andThen(api.entityUserData.clearEntityUserData(clearRequest))),
			);
			expect(failure).toBeInstanceOf(DemoOperationProtected);

			const commands = yield* caller.recordedCommands;
			expect(commands).toHaveLength(6);
			expect(commands[0]?.command).toEqual(commands[1]?.command);
			expect(commands[2]?.command).toEqual(commands[3]?.command);
			expect(commands[4]?.command).not.toEqual(commands[0]?.command);
			expect(commands[4]?.command.causation.executionId).toBe(
				AutomationExecutionId.make(executionId(owner, "clear", "clear-key")),
			);
			expect(commands[4]?.command.occurredAt).toBe("2026-10-27T12:00:01.000Z");
			expect(commands[5]?.command).toMatchObject({
				occurredAt: submittedAt,
				itemIdentity: "entity-user-data:clear",
				causation: {
					executionId: AutomationExecutionId.make(executionId(recipient, "clear", "clear-key")),
					rootExecutionId: AutomationExecutionId.make(executionId(recipient, "clear", "clear-key")),
				},
			});
		}),
	);
});
