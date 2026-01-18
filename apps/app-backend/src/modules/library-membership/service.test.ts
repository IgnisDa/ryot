import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot/contract/errors";
import { EntitySchemaId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import type { Exit } from "effect";
import { Effect, Layer } from "effect";
import { assert } from "vitest";

import { createWorkflowJobId } from "#lib/shared/job-id";
import {
	type MockOverrides,
	dbRunnerLayer,
	makeAppConfigLayer,
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
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
};

const externalId = "ext-123";
const scriptId = SandboxScriptId.make("script-1");
const entitySchemaId = EntitySchemaId.make("schema-1");

const mockEntitiesRepository = Layer.mock(EntitiesRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({ _tag: "EntitiesRepository", ...overrides });

const mockSandboxRepository = Layer.mock(SandboxRepository);

const makeSandboxRepository = (overrides: MockOverrides<typeof mockSandboxRepository> = {}) =>
	mockSandboxRepository({ _tag: "SandboxRepository", ...overrides });

const fakeScript = {
	id: scriptId,
	userId: user.id,
	isBuiltin: false,
	compiledFormat: 1,
	source: "// script",
	compiledCode: "// compiled script",
	metadata: { capabilities: [] },
};

const fakeEntitySchemaScope = {
	slug: "movie",
	userId: user.id,
	isBuiltin: false,
	id: entitySchemaId,
	propertiesSchema: { fields: {} },
};

const makeServiceLayer = (
	sandboxRepo = makeSandboxRepository(),
	entitiesRepo = makeEntitiesRepository(),
	engine = makeWorkflowEngine(),
) =>
	LibraryImportService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				makeAppConfigLayer(),
				Layer.succeed(WorkflowEngine, engine),
				entitiesRepo,
				sandboxRepo,
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
