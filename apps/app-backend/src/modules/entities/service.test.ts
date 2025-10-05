import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect, Exit, Layer, Option, Redacted } from "effect";

import type { CurrentUserValue } from "~/lib/auth";
import { AppConfig } from "~/lib/config";
import { CurrentDb, DbRunner, TransactionRunner } from "~/lib/db";
import { BadRequest, NotFound } from "~/lib/errors";
import { RelationshipSchemasRepository } from "~/modules/relationship-schemas/repository";
import { SandboxRepository } from "~/modules/sandbox/repository";

import { EntitiesRepository } from "./repository";
import { EntitiesService } from "./service";

const now = "2026-06-14T00:00:00.000Z";

const user = {
	id: "user-id",
	name: "Test User",
	email: "user@example.com",
} satisfies CurrentUserValue;

const dbRunnerLayer = Layer.succeed(
	DbRunner,
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, CurrentDb>> =>
		Effect.provideService(effect, CurrentDb, Object.create(null)),
);

const transactionLayer = Layer.succeed(
	TransactionRunner,
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, CurrentDb>> =>
		Effect.provideService(effect, CurrentDb, Object.create(null)),
);

const defaultEntitiesRepository = (): EntitiesRepository =>
	Object.assign(Object.create(null), {
		_tag: "EntitiesRepository" as const,
		createEntity: () => Effect.die("unused"),
		getByIdForUser: () => Effect.die("unused"),
		getEntityScopeById: () => Effect.die("unused"),
		insertRelationship: () => Effect.die("unused"),
		upsertRelationship: () => Effect.die("unused"),
		findEntitySchemaById: () => Effect.die("unused"),
		getEntityScopeForUser: () => Effect.die("unused"),
		upsertEntityRelationship: () => Effect.die("unused"),
		deleteUserEventsForEntity: () => Effect.die("unused"),
		createOrUpdateGlobalEntity: () => Effect.die("unused"),
		getEntitySchemaScopeForUser: () => Effect.die("unused"),
		findEntitySchemaScriptBySlug: () => Effect.die("unused"),
		findGlobalEntityByExternalId: () => Effect.die("unused"),
		findEntityByExternalIdForUser: () => Effect.die("unused"),
		deleteUserRelationshipsForEntity: () => Effect.die("unused"),
	});

const defaultRelationshipSchemasRepository = (): RelationshipSchemasRepository =>
	Object.assign(Object.create(null), {
		findById: () => Effect.die("unused"),
		_tag: "RelationshipSchemasRepository" as const,
		findBuiltinBySlug: () => Effect.die("unused"),
	});

const makeEntitiesRepository = (overrides: Partial<EntitiesRepository> = {}): EntitiesRepository =>
	Object.assign(Object.create(null), defaultEntitiesRepository(), overrides);

const makeRelationshipSchemasRepository = (
	overrides: Partial<RelationshipSchemasRepository> = {},
): RelationshipSchemasRepository =>
	Object.assign(Object.create(null), defaultRelationshipSchemasRepository(), overrides);

const fakeAppConfigLayer = Layer.succeed(AppConfig, {
	port: 3000,
	_tag: "AppConfig" as const,
	frontendUrl: "http://localhost:3000",
	redisUrl: Redacted.make("unused"),
	databaseUrl: Redacted.make("unused"),
	frontend: { oidcButtonLabel: Option.none() },
	scheduler: { progressUpdateThresholdHours: 2 },
	users: { allowRegistration: true, disableLocalAuth: false },
	sandbox: { denoDir: "/tmp", timeoutMs: 5_000, jobIdSecret: Redacted.make("test-secret") },
	server: {
		corsOrigins: Option.none(),
		adminAccessToken: Redacted.make("unused"),
		oidc: { clientId: Option.none(), issuerUrl: Option.none(), clientSecret: Option.none() },
	},
	fileStorage: {
		url: Option.none(),
		region: Option.none(),
		bucketName: Option.none(),
		accessKeyId: Option.none(),
		secretAccessKey: Option.none(),
	},
});

const makeWorkflowEngine = (): WorkflowEngine["Type"] =>
	({
		poll: () => Effect.die("not used in this test"),
		resume: () => Effect.die("not used in this test"),
		execute: () => Effect.die("not used in this test"),
		register: () => Effect.die("not used in this test"),
		interrupt: () => Effect.die("not used in this test"),
		deferredDone: () => Effect.die("not used in this test"),
		scheduleClock: () => Effect.die("not used in this test"),
		deferredResult: () => Effect.die("not used in this test"),
		activityExecute: () => Effect.die("not used in this test"),
	}) as WorkflowEngine["Type"];

const fakeWorkflowEngineLayer = Layer.succeed(WorkflowEngine, makeWorkflowEngine());

const defaultSandboxRepository = (): SandboxRepository =>
	Object.assign(Object.create(null), {
		_tag: "SandboxRepository" as const,
		createScript: () => Effect.die("unused"),
		getScriptForUser: () => Effect.die("unused"),
		findScriptBySlugForUser: () => Effect.die("unused"),
	});

const makeServiceLayer = (
	repository: EntitiesRepository,
	relationshipSchemasRepository: RelationshipSchemasRepository = makeRelationshipSchemasRepository(),
) =>
	EntitiesService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				fakeAppConfigLayer,
				fakeWorkflowEngineLayer,
				Layer.succeed(EntitiesRepository, repository),
				Layer.succeed(SandboxRepository, defaultSandboxRepository()),
				Layer.succeed(RelationshipSchemasRepository, relationshipSchemasRepository),
			),
		),
	);

it.effect("returns existing entity when provenance already exists", () => {
	let createCalled = false;

	const layer = makeServiceLayer(
		makeEntitiesRepository({
			createEntity: () =>
				Effect.sync(() => {
					createCalled = true;
					return {
						image: null,
						createdAt: now,
						updatedAt: now,
						properties: {},
						name: "Created",
						populatedAt: null,
						externalId: "ext-1",
						id: "created-entity",
						entitySchemaId: "schema-id",
						sandboxScriptId: "script-id",
					};
				}),
			getEntitySchemaScopeForUser: () =>
				Effect.succeed({
					slug: "book",
					userId: user.id,
					id: "schema-id",
					isBuiltin: false,
					propertiesSchema: {
						fields: { title: { type: "string", label: "Title", description: "Title" } },
					},
				}),
			findEntityByExternalIdForUser: () =>
				Effect.succeed({
					image: null,
					createdAt: now,
					updatedAt: now,
					name: "Existing",
					populatedAt: null,
					externalId: "ext-1",
					id: "existing-entity",
					entitySchemaId: "schema-id",
					sandboxScriptId: "script-id",
					properties: { title: "Existing" },
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const entity = yield* service.create(user, {
			name: "Existing",
			externalId: "ext-1",
			entitySchemaId: "schema-id",
			sandboxScriptId: "script-id",
			properties: { title: "Existing" },
			image: "https://example.com/cover.jpg",
		});

		expect(entity.id).toBe("existing-entity");
		expect(createCalled).toBe(false);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when entity schema is not visible", () => {
	const layer = makeServiceLayer(
		makeEntitiesRepository({ getEntitySchemaScopeForUser: () => Effect.succeed(null) }),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const exit = yield* Effect.exit(
			service.create(user, {
				properties: {},
				entitySchemaId: "schema-id",
				name: "Hidden Schema Entity",
			}),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity schema not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("rejects clearing library user state", () => {
	const layer = makeServiceLayer(
		makeEntitiesRepository({
			getEntityScopeForUser: () =>
				Effect.succeed({
					isBuiltin: true,
					entityUserId: user.id,
					entityId: "library-entity",
					entitySchemaSlug: "library",
					entitySchemaId: "library-schema",
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const exit = yield* Effect.exit(service.clearUserState(user, "library-entity"));

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Library entity user state cannot be cleared" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("validates relationship properties before upserting user relationships", () => {
	const layer = makeServiceLayer(
		makeEntitiesRepository({
			getEntityScopeForUser: ({ entityId }) =>
				Effect.succeed({
					entityId,
					isBuiltin: false,
					entityUserId: user.id,
					entitySchemaSlug: "book",
					entitySchemaId: "schema-id",
				}),
			upsertRelationship: () => Effect.die("should not be called"),
		}),
		makeRelationshipSchemasRepository({
			findById: () =>
				Effect.succeed({
					isBuiltin: false,
					slug: "linked-to",
					name: "Linked To",
					id: "relationship-schema-id",
					sourceEntitySchemaId: "schema-id",
					targetEntitySchemaId: "schema-id",
					propertiesSchema: {
						fields: {
							rating: {
								type: "number",
								label: "Rating",
								description: "Rating",
								validation: { required: true },
							},
						},
					},
				}),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* EntitiesService;
		const exit = yield* Effect.exit(
			service.upsertUserRelationship({
				properties: {},
				userId: user.id,
				sourceEntityId: "entity-a",
				targetEntityId: "entity-b",
				relationshipSchemaId: "relationship-schema-id",
			}),
		);

		expect(exit).toEqual(Exit.fail(new BadRequest({ message: "rating: is missing" })));
	}).pipe(Effect.provide(layer));
});
