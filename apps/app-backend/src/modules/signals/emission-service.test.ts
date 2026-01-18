import { assert, expect, it } from "@effect/vitest";
import { BadRequest, NotFound } from "@ryot/contract/errors";
import {
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	SignalId,
	SignalSchemaSlug,
	UserId,
} from "@ryot/contract/schema/brands";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import type { MockOverrides } from "#lib/test-utils/effect";
import { transactionLayer } from "#lib/test-utils/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { SignalDispatch } from "./dispatch";
import { SignalsRepository, type InsertSignalInput, type StoredSignal } from "./repository";
import { SignalEmissionService, type EmitSignalInput } from "./service";
import { SignalSchemasRepository, type SignalSchemaScope } from "./signal-schemas-repository";

const userId = UserId.make("user-1");
const recipientId = UserId.make("user-2");
const subjectEntityId = EntityId.make("entity-1");
const occurredAt = new Date("2026-07-20T10:00:00.000Z");
const relationshipSchemaSlug = RelationshipSchemaSlug.make("media-monitoring");

const propertiesSchema = {
	unknownKeys: "strict",
	fields: {
		entityName: {
			type: "string",
			label: "Entity name",
			description: "Entity name",
			validation: { required: true },
		},
	},
} as const;

const actorSchema = {
	userId: null,
	isBuiltin: true,
	propertiesSchema,
	slug: "review.created",
	name: "Review created",
	catalogState: "active",
	audiencePolicy: { kind: "actor" },
	id: SignalSchemaSlug.make("review.created"),
} satisfies SignalSchemaScope;

const relatedSchema = {
	...actorSchema,
	slug: "media.status.changed",
	id: SignalSchemaSlug.make("media.status.changed"),
	audiencePolicy: { relationshipSchemaSlug, kind: "related_users", subjectSide: "source" },
} satisfies SignalSchemaScope;

const relationshipScope = {
	isBuiltin: true,
	id: relationshipSchemaSlug,
	slug: "media-monitoring",
	name: "Media monitoring",
	sourceEntitySchemaSlug: null,
	targetEntitySchemaSlug: null,
	propertiesSchema: { fields: {} },
};

const subjectScope = {
	isBuiltin: true,
	entityUserId: null,
	entityName: "The Matrix",
	entityId: subjectEntityId,
	entitySchemaSlug: EntitySchemaSlug.make("movie"),
	propertiesSchema: { fields: {} },
};

const baseInput = {
	occurredAt,
	origin: { kind: "api" },
	discriminator: "review-1",
	executionId: "execution-1",
	schemaSlug: actorSchema.slug,
	principal: { kind: "user", userId },
	properties: { entityName: "Arrival" },
} as const satisfies EmitSignalInput;

const storedSignal = (input: InsertSignalInput): StoredSignal => ({
	id: input.id,
	origin: input.origin,
	properties: input.properties,
	actorUserId: input.actorUserId,
	signalSchemaSlug: input.signalSchemaSlug,
	createdAt: "2026-07-20T10:00:01.000Z",
	subjectEntityId: input.subjectEntityId,
	occurredAt: input.occurredAt.toISOString(),
});

const mockSignalsRepository = Layer.mock(SignalsRepository);
const mockEntitiesRepository = Layer.mock(EntitiesRepository);
const mockSignalSchemasRepository = Layer.mock(SignalSchemasRepository);
const mockRelationshipsRepository = Layer.mock(RelationshipsRepository);
const mockRelationshipSchemasRepository = Layer.mock(RelationshipSchemasRepository);
const signalDispatchLayer = Layer.mock(SignalDispatch, {
	dispatch: () => Effect.void,
});

const makeSignalsRepository = (overrides: MockOverrides<typeof mockSignalsRepository> = {}) =>
	mockSignalsRepository({
		_tag: "SignalsRepository",
		findById: () => Effect.succeed(null),
		...overrides,
	});
const makeSignalSchemasRepository = (
	overrides: MockOverrides<typeof mockSignalSchemasRepository> = {},
) => mockSignalSchemasRepository({ _tag: "SignalSchemasRepository", ...overrides });
const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({ _tag: "EntitiesRepository", ...overrides });
const makeRelationshipsRepository = (
	overrides: MockOverrides<typeof mockRelationshipsRepository> = {},
) => mockRelationshipsRepository({ _tag: "RelationshipsRepository", ...overrides });
const makeRelationshipSchemasRepository = (
	overrides: MockOverrides<typeof mockRelationshipSchemasRepository> = {},
) => mockRelationshipSchemasRepository({ _tag: "RelationshipSchemasRepository", ...overrides });

const makeLayer = (input: {
	dispatch?: typeof signalDispatchLayer;
	signals: ReturnType<typeof makeSignalsRepository>;
	entities?: ReturnType<typeof makeEntitiesRepository>;
	signalSchemas?: ReturnType<typeof makeSignalSchemasRepository>;
	relationships?: ReturnType<typeof makeRelationshipsRepository>;
	relationshipSchemas?: ReturnType<typeof makeRelationshipSchemasRepository>;
}) =>
	SignalEmissionService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				input.signals,
				input.dispatch ?? signalDispatchLayer,
				transactionLayer,
				input.entities ?? makeEntitiesRepository(),
				input.relationships ?? makeRelationshipsRepository(),
				input.signalSchemas ??
					makeSignalSchemasRepository({ findVisibleBySlug: () => Effect.succeed(actorSchema) }),
				input.relationshipSchemas ?? makeRelationshipSchemasRepository(),
			),
		),
	);

it.effect("derives the actor and atomically snapshots an enabled actor recipient", () => {
	let inserted: InsertSignalInput | undefined;
	let recipients: { signalId: SignalId; userIds: ReadonlyArray<UserId> } | undefined;
	const layer = makeLayer({
		signals: makeSignalsRepository({
			insert: (input) => {
				inserted = input;
				return Effect.succeed(storedSignal(input));
			},
			isUserEnabled: () => Effect.succeed(true),
			insertRecipients: (input) => {
				recipients = input;
				return Effect.void;
			},
		}),
	});

	return Effect.gen(function* () {
		const service = yield* SignalEmissionService;
		const result = yield* service.emit(baseInput);
		expect(inserted?.actorUserId).toBe(userId);
		expect(inserted?.subjectEntityId).toBeNull();
		expect(recipients).toEqual({ signalId: inserted?.id, userIds: [userId] });
		expect(result.wasCreated).toBe(true);
		expect(result.recipientUserIds).toEqual([userId]);
	}).pipe(Effect.provide(layer));
});

it.effect("persists actor signals with an empty audience for disabled users", () => {
	let recipients: ReadonlyArray<UserId> | undefined;
	const layer = makeLayer({
		signals: makeSignalsRepository({
			insert: (input) => Effect.succeed(storedSignal(input)),
			isUserEnabled: () => Effect.succeed(false),
			insertRecipients: (input) => {
				recipients = input.userIds;
				return Effect.void;
			},
		}),
	});

	return Effect.gen(function* () {
		const service = yield* SignalEmissionService;
		const result = yield* service.emit(baseInput);
		expect(recipients).toEqual([]);
		expect(result.recipientUserIds).toEqual([]);
	}).pipe(Effect.provide(layer));
});

it.effect("validates signal properties before insertion", () => {
	const layer = makeLayer({
		signals: makeSignalsRepository({ insert: () => Effect.die("unexpected insert") }),
	});

	return Effect.gen(function* () {
		const service = yield* SignalEmissionService;
		const exit = yield* Effect.exit(service.emit({ ...baseInput, properties: {} }));
		assert(Exit.isFailure(exit));
		const failure = Cause.failureOption(exit.cause);
		assert(Option.isSome(failure));
		expect(failure.value).toBeInstanceOf(BadRequest);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects a system principal for an actor audience", () => {
	const layer = makeLayer({ signals: makeSignalsRepository() });

	return Effect.gen(function* () {
		const service = yield* SignalEmissionService;
		const exit = yield* Effect.exit(service.emit({ ...baseInput, principal: { kind: "system" } }));
		assertExitFails(exit, new BadRequest({ message: "Actor audience requires a user principal" }));
	}).pipe(Effect.provide(layer));
});

it.effect("rejects a user-owned cross-user audience policy", () => {
	const layer = makeLayer({
		signalSchemas: makeSignalSchemasRepository({
			findVisibleBySlug: () => Effect.succeed({ ...relatedSchema, userId, isBuiltin: false }),
		}),
		signals: makeSignalsRepository(),
	});

	return Effect.gen(function* () {
		const service = yield* SignalEmissionService;
		const exit = yield* Effect.exit(
			service.emit({ ...baseInput, subjectEntityId, schemaSlug: relatedSchema.slug }),
		);
		assertExitFails(exit, new NotFound({ message: "Signal schema not found" }));
	}).pipe(Effect.provide(layer));
});

it.effect("resolves and snapshots related users after inserting the signal", () => {
	const order: string[] = [];
	let inserted: InsertSignalInput | undefined;
	const layer = makeLayer({
		signalSchemas: makeSignalSchemasRepository({
			findVisibleBySlug: () => Effect.succeed(relatedSchema),
		}),
		entities: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(subjectScope),
		}),
		relationshipSchemas: makeRelationshipSchemasRepository({
			findById: () => Effect.succeed(relationshipScope),
		}),
		relationships: makeRelationshipsRepository({
			listEnabledOwnersForSubject: () => {
				order.push("resolve");
				return Effect.succeed([recipientId]);
			},
		}),
		signals: makeSignalsRepository({
			insert: (input) => {
				order.push("insert");
				inserted = input;
				return Effect.succeed(storedSignal(input));
			},
			insertRecipients: () => {
				order.push("recipients");
				return Effect.void;
			},
		}),
	});

	return Effect.gen(function* () {
		const service = yield* SignalEmissionService;
		const result = yield* service.emit({
			...baseInput,
			subjectEntityId,
			schemaSlug: relatedSchema.slug,
		});
		expect(order).toEqual(["insert", "resolve", "recipients"]);
		expect(inserted?.actorUserId).toBeNull();
		expect(inserted?.subjectEntityId).toBe(subjectEntityId);
		expect(result.recipientUserIds).toEqual([recipientId]);
	}).pipe(Effect.provide(layer));
});

it.effect("persists a valid related-users signal with an empty audience", () => {
	const layer = makeLayer({
		signalSchemas: makeSignalSchemasRepository({
			findVisibleBySlug: () => Effect.succeed(relatedSchema),
		}),
		entities: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.succeed(subjectScope),
		}),
		relationshipSchemas: makeRelationshipSchemasRepository({
			findById: () => Effect.succeed(relationshipScope),
		}),
		relationships: makeRelationshipsRepository({
			listEnabledOwnersForSubject: () => Effect.succeed([]),
		}),
		signals: makeSignalsRepository({
			insert: (input) => Effect.succeed(storedSignal(input)),
			insertRecipients: () => Effect.void,
		}),
	});

	return Effect.gen(function* () {
		const service = yield* SignalEmissionService;
		const result = yield* service.emit({
			...baseInput,
			subjectEntityId,
			schemaSlug: relatedSchema.slug,
		});
		expect(result.wasCreated).toBe(true);
		expect(result.recipientUserIds).toEqual([]);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects a missing or unreadable related-users subject", () => {
	const missingLayer = makeLayer({
		signalSchemas: makeSignalSchemasRepository({
			findVisibleBySlug: () => Effect.succeed(relatedSchema),
		}),
		signals: makeSignalsRepository(),
	});
	const unreadableLayer = makeLayer({
		signalSchemas: makeSignalSchemasRepository({
			findVisibleBySlug: () => Effect.succeed(relatedSchema),
		}),
		entities: makeEntitiesRepository({ getEntityScopeForUser: () => Effect.succeed(null) }),
		signals: makeSignalsRepository({
			insert: () => Effect.die("unreadable subject was inserted"),
		}),
	});

	const missingEffect = Effect.gen(function* () {
		const service = yield* SignalEmissionService;
		return yield* Effect.exit(service.emit({ ...baseInput, schemaSlug: relatedSchema.slug }));
	}).pipe(Effect.provide(missingLayer));
	const unreadableEffect = Effect.gen(function* () {
		const service = yield* SignalEmissionService;
		return yield* Effect.exit(
			service.emit({ ...baseInput, subjectEntityId, schemaSlug: relatedSchema.slug }),
		);
	}).pipe(Effect.provide(unreadableLayer));

	return Effect.gen(function* () {
		const missing = yield* missingEffect;
		assertExitFails(
			missing,
			new BadRequest({ message: "Related-users audience requires a subject entity" }),
		);

		const unreadable = yield* unreadableEffect;
		assertExitFails(unreadable, new NotFound({ message: "Entity not found" }));
	});
});

it.effect("returns a duplicate with its stored recipients without resolving again", () => {
	const existing = storedSignal({
		occurredAt,
		subjectEntityId,
		actorUserId: null,
		origin: baseInput.origin,
		properties: baseInput.properties,
		signalSchemaSlug: relatedSchema.id,
		id: SignalId.make("existing-signal"),
	});
	const layer = makeLayer({
		signalSchemas: makeSignalSchemasRepository({
			findVisibleBySlug: () => Effect.succeed(relatedSchema),
		}),
		entities: makeEntitiesRepository({
			getEntityScopeForUser: () => Effect.die("duplicate subject was reauthorized"),
		}),
		relationships: makeRelationshipsRepository({
			listEnabledOwnersForSubject: () => Effect.die("audience was re-resolved"),
		}),
		relationshipSchemas: makeRelationshipSchemasRepository({
			findById: () => Effect.die("audience schema was re-resolved"),
		}),
		signals: makeSignalsRepository({
			findById: () => Effect.succeed(existing),
			insert: () => Effect.die("duplicate signal was reinserted"),
			listRecipientUserIds: () => Effect.succeed([recipientId]),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* SignalEmissionService;
		const result = yield* service.emit({
			...baseInput,
			subjectEntityId,
			schemaSlug: relatedSchema.slug,
		});
		expect(result.wasCreated).toBe(false);
		expect(result.recipientUserIds).toEqual([recipientId]);
	}).pipe(Effect.provide(layer));
});

it.effect("uses the discriminator to distinguish sibling signal ids", () => {
	const ids: SignalId[] = [];
	const layer = makeLayer({
		signals: makeSignalsRepository({
			insert: (input) => {
				ids.push(input.id);
				return Effect.succeed(storedSignal(input));
			},
			isUserEnabled: () => Effect.succeed(true),
			insertRecipients: () => Effect.void,
		}),
	});

	return Effect.gen(function* () {
		const service = yield* SignalEmissionService;
		yield* service.emit({ ...baseInput, discriminator: "role-1" });
		yield* service.emit({ ...baseInput, discriminator: "role-2" });
		expect(ids).toHaveLength(2);
		expect(ids[0]).not.toBe(ids[1]);
	}).pipe(Effect.provide(layer));
});

it.effect("dispatches the committed signal snapshot", () => {
	const order: string[] = [];
	let dispatched: unknown;
	const layer = makeLayer({
		dispatch: Layer.mock(SignalDispatch, {
			dispatch: (input) => {
				order.push("dispatch");
				dispatched = input;
				return Effect.void;
			},
		}),
		signals: makeSignalsRepository({
			insert: (input) => {
				order.push("insert");
				return Effect.succeed(storedSignal(input));
			},
			isUserEnabled: () => Effect.succeed(true),
			insertRecipients: () => {
				order.push("recipients");
				return Effect.void;
			},
		}),
	});

	return Effect.gen(function* () {
		const service = yield* SignalEmissionService;
		const result = yield* service.emit(baseInput);
		expect(order).toEqual(["insert", "recipients", "dispatch"]);
		expect(dispatched).toMatchObject({
			actorUserId: userId,
			id: result.signal.id,
			recipientUserIds: [userId],
			signalSchemaSlug: actorSchema.slug,
		});
	}).pipe(Effect.provide(layer));
});
