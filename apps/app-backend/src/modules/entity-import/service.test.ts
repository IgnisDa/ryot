import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot/contract/errors";
import { EntitySchemaSlug, SandboxProviderId, UserId } from "@ryot/contract/schema/brands";
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
} from "#lib/test-utils/effect";
import { EntitiesRepository } from "#modules/entities/repository";

import { EntityImportService } from "./service";

const user: CurrentUserValue = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
};

const externalId = "ext-123";
const providerId = SandboxProviderId.make("provider-1");
const entitySchemaSlug = EntitySchemaSlug.make("schema-1");

const mockEntitiesRepository = Layer.mock(EntitiesRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({ _tag: "EntitiesRepository", ...overrides });

const fakeEntitySchemaScope = {
	slug: "movie",
	userId: user.id,
	isBuiltin: false,
	id: entitySchemaSlug,
	propertiesSchema: { fields: {} },
};

const makeServiceLayer = (entitiesRepo = makeEntitiesRepository(), engine = makeWorkflowEngine()) =>
	EntityImportService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				makeAppConfigLayer(),
				Layer.succeed(WorkflowEngine, engine),
				entitiesRepo,
			),
		),
	);

const getFailureCause = <A, E>(result: Exit.Exit<A, E>) => {
	expect(result._tag).toBe("Failure");
	assert(result._tag === "Failure", "Expected effect to fail");

	return result.cause;
};

it.effect("returns BadRequest when providerId is blank", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(
			service.import(user, {
				externalId,
				entitySchemaSlug,
				providerId: SandboxProviderId.make("   "),
			}),
		);
		const cause = getFailureCause(result);
		const failure = cause._tag === "Fail" ? cause.error : null;
		expect(failure).toBeInstanceOf(BadRequest);
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("returns BadRequest when externalId is blank", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(
			service.import(user, { providerId, externalId: "  ", entitySchemaSlug }),
		);
		const cause = getFailureCause(result);
		const failure = cause._tag === "Fail" ? cause.error : null;
		expect(failure).toBeInstanceOf(BadRequest);
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("returns BadRequest when entitySchemaSlug is blank", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(
			service.import(user, {
				providerId,
				externalId,
				entitySchemaSlug: EntitySchemaSlug.make(""),
			}),
		);
		const cause = getFailureCause(result);
		const failure = cause._tag === "Fail" ? cause.error : null;
		expect(failure).toBeInstanceOf(BadRequest);
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("returns NotFound when the entity schema is not found", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(
			service.import(user, { providerId, externalId, entitySchemaSlug }),
		);
		const cause = getFailureCause(result);
		const failure = cause._tag === "Fail" ? cause.error : null;
		expect(failure).toBeInstanceOf(NotFound);
	}).pipe(
		Effect.provide(
			makeServiceLayer(
				makeEntitiesRepository({ getEntitySchemaScopeForUser: () => Effect.succeed(null) }),
			),
		),
	),
);

it.effect("returns a jobId string on a successful import dispatch", () => {
	const executeCalls: unknown[] = [];

	return Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* service.import(user, { providerId, externalId, entitySchemaSlug });
		expect(typeof result.jobId).toBe("string");
		expect(result.jobId.length).toBeGreaterThan(0);
		expect(executeCalls).toMatchObject([{ payload: { providerId: "provider-1" } }]);
	}).pipe(
		Effect.provide(
			makeServiceLayer(
				makeEntitiesRepository({
					getEntitySchemaScopeForUser: () => Effect.succeed(fakeEntitySchemaScope),
				}),
				makeWorkflowEngine({
					execute: (_workflow, options) => {
						executeCalls.push(options);
						return Effect.void;
					},
				}),
			),
		),
	);
});

it.effect("returns NotFound for a blank getImportResult jobId", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(service.getImportResult(user, "   "));
		const cause = getFailureCause(result);
		const failure = cause._tag === "Fail" ? cause.error : null;
		expect(failure).toBeInstanceOf(NotFound);
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("returns NotFound for a jobId with an invalid signature", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(service.getImportResult(user, "fake-execution-id.badsig"));
		const cause = getFailureCause(result);
		const failure = cause._tag === "Fail" ? cause.error : null;
		expect(failure).toBeInstanceOf(NotFound);
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("returns pending status when the workflow has not completed", () =>
	Effect.gen(function* () {
		const secret = "test-secret";
		const executionId = "exec-abc";
		const service = yield* EntityImportService;
		const jobId = createWorkflowJobId(secret, executionId, user.id);

		const result = yield* service.getImportResult(user, jobId);
		expect(result).toMatchObject({ status: "pending" });
	}).pipe(
		Effect.provide(
			makeServiceLayer(
				makeEntitiesRepository(),
				makeWorkflowEngine({ poll: () => Effect.sync(() => undefined) }),
			),
		),
	),
);
