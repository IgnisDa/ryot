import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { Exit } from "effect";
import { Effect, Layer } from "effect";
import { assert } from "vitest";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { BadRequest, NotFound } from "#lib/errors";
import { createWorkflowJobId } from "#lib/job-id";
import { EntitySchemaId, SandboxScriptId, UserId } from "#lib/schema/brands";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeMock,
	makeWorkflowEngine,
	transactionLayer,
} from "#lib/test-support/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { SandboxRepository } from "#modules/sandbox/repository";

import { LibraryImportService } from "./service";

const user: CurrentUserValue = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
};

const externalId = "ext-123";
const scriptId = SandboxScriptId.make("script-1");
const entitySchemaId = EntitySchemaId.make("schema-1");

const makeEntitiesRepository = (overrides: Partial<EntitiesRepository> = {}) =>
	makeMock<EntitiesRepository>(
		{
			_tag: "EntitiesRepository" as const,
			createEntity: () => Effect.die("unused"),
			getByIdForUser: () => Effect.die("unused"),
			getEntityScopeById: () => Effect.die("unused"),
			findEntitySchemaById: () => Effect.die("unused"),
			getEntityScopeForUser: () => Effect.die("unused"),
			getEntityMergeScopeForUser: () => Effect.die("unused"),
			createOrUpdateGlobalEntity: () => Effect.die("unused"),
			getEntitySchemaScopeForUser: () => Effect.die("unused"),
			findEntitySchemaScriptBySlug: () => Effect.die("unused"),
			findGlobalEntityByExternalId: () => Effect.die("unused"),
			findEntityByExternalIdForUser: () => Effect.die("unused"),
		},
		overrides,
	);

const makeSandboxRepository = (overrides: Partial<SandboxRepository> = {}) =>
	makeMock<SandboxRepository>(
		{
			_tag: "SandboxRepository" as const,
			createScript: () => Effect.die("unused"),
			getScriptForUser: () => Effect.die("unused"),
			findScriptBySlugForUser: () => Effect.die("unused"),
		},
		overrides,
	);

const fakeScript = {
	id: scriptId,
	userId: user.id,
	isBuiltin: false,
	code: "// script",
	metadata: { allowedHostFunctions: [] },
};

const fakeEntitySchemaScope = {
	slug: "movie",
	userId: user.id,
	isBuiltin: false,
	id: entitySchemaId,
	propertiesSchema: { fields: {} },
};

const makeServiceLayer = (
	sandboxRepo: SandboxRepository,
	entitiesRepo: EntitiesRepository,
	engine = makeWorkflowEngine(),
) =>
	LibraryImportService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				makeAppConfigLayer(),
				Layer.succeed(WorkflowEngine, engine),
				Layer.succeed(EntitiesRepository, entitiesRepo),
				Layer.succeed(SandboxRepository, sandboxRepo),
			),
		),
	);

const getFailureCause = <A, E>(result: Exit.Exit<A, E>) => {
	expect(result._tag).toBe("Failure");
	assert(result._tag === "Failure", "Expected effect to fail");

	return result.cause;
};

it.effect("returns BadRequest when scriptId is blank", () =>
	Effect.gen(function* () {
		const service = yield* LibraryImportService;
		const result = yield* Effect.exit(
			service.import(user, {
				externalId,
				entitySchemaId,
				scriptId: SandboxScriptId.make("   "),
			}),
		);
		const cause = getFailureCause(result);
		const failure = cause._tag === "Fail" ? cause.error : null;
		expect(failure).toBeInstanceOf(BadRequest);
	}).pipe(Effect.provide(makeServiceLayer(makeSandboxRepository(), makeEntitiesRepository()))),
);

it.effect("returns BadRequest when externalId is blank", () =>
	Effect.gen(function* () {
		const service = yield* LibraryImportService;
		const result = yield* Effect.exit(
			service.import(user, { scriptId, externalId: "  ", entitySchemaId }),
		);
		const cause = getFailureCause(result);
		const failure = cause._tag === "Fail" ? cause.error : null;
		expect(failure).toBeInstanceOf(BadRequest);
	}).pipe(Effect.provide(makeServiceLayer(makeSandboxRepository(), makeEntitiesRepository()))),
);

it.effect("returns BadRequest when entitySchemaId is blank", () =>
	Effect.gen(function* () {
		const service = yield* LibraryImportService;
		const result = yield* Effect.exit(
			service.import(user, {
				scriptId,
				externalId,
				entitySchemaId: EntitySchemaId.make(""),
			}),
		);
		const cause = getFailureCause(result);
		const failure = cause._tag === "Fail" ? cause.error : null;
		expect(failure).toBeInstanceOf(BadRequest);
	}).pipe(Effect.provide(makeServiceLayer(makeSandboxRepository(), makeEntitiesRepository()))),
);

it.effect("returns NotFound when the sandbox script is not found", () =>
	Effect.gen(function* () {
		const service = yield* LibraryImportService;
		const result = yield* Effect.exit(
			service.import(user, { scriptId, externalId, entitySchemaId }),
		);
		const cause = getFailureCause(result);
		const failure = cause._tag === "Fail" ? cause.error : null;
		expect(failure).toBeInstanceOf(NotFound);
	}).pipe(
		Effect.provide(
			makeServiceLayer(
				makeSandboxRepository({ getScriptForUser: () => Effect.succeed(null) }),
				makeEntitiesRepository(),
			),
		),
	),
);

it.effect("returns NotFound when the entity schema is not found", () =>
	Effect.gen(function* () {
		const service = yield* LibraryImportService;
		const result = yield* Effect.exit(
			service.import(user, { scriptId, externalId, entitySchemaId }),
		);
		const cause = getFailureCause(result);
		const failure = cause._tag === "Fail" ? cause.error : null;
		expect(failure).toBeInstanceOf(NotFound);
	}).pipe(
		Effect.provide(
			makeServiceLayer(
				makeSandboxRepository({ getScriptForUser: () => Effect.succeed(fakeScript) }),
				makeEntitiesRepository({ getEntitySchemaScopeForUser: () => Effect.succeed(null) }),
			),
		),
	),
);

it.effect("returns a jobId string on a successful import dispatch", () =>
	Effect.gen(function* () {
		const service = yield* LibraryImportService;
		const result = yield* service.import(user, { scriptId, externalId, entitySchemaId });
		expect(typeof result.jobId).toBe("string");
		expect(result.jobId.length).toBeGreaterThan(0);
	}).pipe(
		Effect.provide(
			makeServiceLayer(
				makeSandboxRepository({ getScriptForUser: () => Effect.succeed(fakeScript) }),
				makeEntitiesRepository({
					getEntitySchemaScopeForUser: () => Effect.succeed(fakeEntitySchemaScope),
				}),
				makeWorkflowEngine({ execute: () => Effect.void }),
			),
		),
	),
);

it.effect("returns NotFound for a blank getImportResult jobId", () =>
	Effect.gen(function* () {
		const service = yield* LibraryImportService;
		const result = yield* Effect.exit(service.getImportResult(user, "   "));
		const cause = getFailureCause(result);
		const failure = cause._tag === "Fail" ? cause.error : null;
		expect(failure).toBeInstanceOf(NotFound);
	}).pipe(Effect.provide(makeServiceLayer(makeSandboxRepository(), makeEntitiesRepository()))),
);

it.effect("returns NotFound for a jobId with an invalid signature", () =>
	Effect.gen(function* () {
		const service = yield* LibraryImportService;
		const result = yield* Effect.exit(service.getImportResult(user, "fake-execution-id.badsig"));
		const cause = getFailureCause(result);
		const failure = cause._tag === "Fail" ? cause.error : null;
		expect(failure).toBeInstanceOf(NotFound);
	}).pipe(Effect.provide(makeServiceLayer(makeSandboxRepository(), makeEntitiesRepository()))),
);

it.effect("returns pending status when the workflow has not completed", () =>
	Effect.gen(function* () {
		const service = yield* LibraryImportService;
		const secret = "test-secret";
		const executionId = "exec-abc";
		const jobId = createWorkflowJobId(secret, executionId, user.id);

		const result = yield* service.getImportResult(user, jobId);
		expect(result).toMatchObject({ status: "pending" });
	}).pipe(
		Effect.provide(
			makeServiceLayer(
				makeSandboxRepository(),
				makeEntitiesRepository(),
				makeWorkflowEngine({ poll: () => Effect.sync(() => undefined) }),
			),
		),
	),
);
