import { assert, expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import {
	ProviderEntityBadRequest,
	ProviderEntityNotFound,
} from "@ryot/contract/modules/provider-entities/schemas";
import { EntitySchemaSlug, SandboxProviderId, UserId } from "@ryot/contract/schema/brands";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { createWorkflowJobId } from "#lib/shared/job-id";
import {
	databaseLayer,
	type MockOverrides,
	makeAppConfigLayer,
	makeWorkflowEngine,
} from "#lib/test-utils/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { EntityImportService } from "./service";

const user: CurrentUserValue = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { allowNsfw: false, language: null, disableIntegrations: false },
};

const externalId = "ext-123";
const providerId = SandboxProviderId.make("provider-1");
const entitySchemaSlug = EntitySchemaSlug.make("schema-1");
const provider = {
	id: providerId,
	name: "Provider",
	pluginSlug: "plugin",
	slug: "provider.slug",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	information: { source: "provider" },
	rootEntitySchemaSlug: entitySchemaSlug,
};

const mockEntitiesRepository = Layer.mock(EntitiesRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({ ...overrides });

const fakeEntitySchemaScope = {
	slug: "movie",
	userId: user.id,
	isBuiltin: false,
	id: entitySchemaSlug,
	propertiesSchema: { fields: {} },
};

const makeServiceLayer = (
	entitiesRepo = makeEntitiesRepository(),
	engine = makeWorkflowEngine(),
	activeProvider: typeof provider | null = provider,
) =>
	EntityImportService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				makeAppConfigLayer(),
				Layer.succeed(WorkflowEngine, engine),
				entitiesRepo,
				Layer.mock(PluginRuntimeResolver)({
					findActiveProviderById: () => Effect.succeed(activeProvider),
				}),
			),
		),
	);

const getFailure = <A, E>(result: Exit.Exit<A, E>) => {
	expect(Exit.isFailure(result)).toBe(true);
	assert(Exit.isFailure(result), "Expected effect to fail");
	const failure = Cause.findErrorOption(result.cause);
	assert(Option.isSome(failure), "Expected typed failure");

	return failure.value;
};

it.effect("returns BadRequest when providerId is blank", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(
			service.import(user, { externalId, providerId: SandboxProviderId.make("   ") }),
		);
		expect(getFailure(result)).toEqual(
			new ProviderEntityBadRequest({
				reason: { code: "invalid-import-input", field: "providerId" },
			}),
		);
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("returns BadRequest when externalId is blank", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(service.import(user, { providerId, externalId: "  " }));
		expect(getFailure(result)).toEqual(
			new ProviderEntityBadRequest({
				reason: { code: "invalid-import-input", field: "externalId" },
			}),
		);
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("returns NotFound when the provider is missing", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(service.import(user, { providerId, externalId }));
		expect(getFailure(result)).toEqual(
			new ProviderEntityNotFound({ reason: { code: "provider-not-found", providerId } }),
		);
	}).pipe(Effect.provide(makeServiceLayer(makeEntitiesRepository(), makeWorkflowEngine(), null))),
);

it.effect("returns NotFound when the provider is inactive", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(service.import(user, { providerId, externalId }));
		expect(getFailure(result)).toEqual(
			new ProviderEntityNotFound({ reason: { code: "provider-not-found", providerId } }),
		);
	}).pipe(Effect.provide(makeServiceLayer(makeEntitiesRepository(), makeWorkflowEngine(), null))),
);

it.effect("returns NotFound when the derived entity schema is not found", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(service.import(user, { providerId, externalId }));
		expect(getFailure(result)).toEqual(
			new ProviderEntityNotFound({
				reason: { code: "entity-schema-not-found", entitySchemaSlug },
			}),
		);
	}).pipe(
		Effect.provide(
			makeServiceLayer(
				makeEntitiesRepository({ getEntitySchemaScopeForUser: () => Effect.succeed(null) }),
			),
		),
	),
);

it.effect("derives the root entity schema before dispatching the import workflow", () => {
	const executeCalls: unknown[] = [];

	return Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* service.import(user, { providerId, externalId });
		expect(typeof result.jobId).toBe("string");
		expect(executeCalls).toHaveLength(1);
		expect(executeCalls[0]).toMatchObject({
			payload: { providerId, externalId, entitySchemaSlug },
		});
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
		expect(getFailure(result)).toEqual(
			new ProviderEntityNotFound({ reason: { code: "import-job-not-found", jobId: "   " } }),
		);
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("returns NotFound for a jobId with an invalid signature", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(service.getImportResult(user, "fake-execution-id.badsig"));
		expect(getFailure(result)).toEqual(
			new ProviderEntityNotFound({
				reason: { code: "import-job-not-found", jobId: "fake-execution-id.badsig" },
			}),
		);
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
				makeWorkflowEngine({ poll: () => Effect.succeedNone }),
			),
		),
	),
);
