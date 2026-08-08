import { assert, expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	ProviderEntityBadRequest,
	ProviderEntityImportBacklogFull,
	ProviderEntityNotFound,
} from "@ryot-app/contract/modules/provider-entities/schemas";
import { EntitySchemaSlug, SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { createWorkflowJobId, deriveJobIdSecret } from "#lib/shared/job-id";
import {
	databaseLayer,
	type MockOverrides,
	makeAppConfigLayer,
	makeWorkflowEngine,
} from "#lib/test-utils/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { ProviderImportAdmission } from "./admission";
import { EntityImportService } from "./service";

const user: CurrentUserValue = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { language: null, allowNsfw: false, disableIntegrations: false },
};

const externalId = "ext-123";
const providerId = SandboxProviderId.make("provider-1");
const entitySchemaSlug = EntitySchemaSlug.make("schema-1");
const provider = {
	id: providerId,
	name: "Provider",
	pluginId: "plugin",
	slug: "provider.slug",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	information: { source: "provider" },
	rootEntitySchemaSlug: entitySchemaSlug,
	pluginScope: "system" as "system" | "user",
};

const mockEntitiesRepository = Layer.mock(EntitiesRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({ ...overrides });

const fakeEntitySchemaScope = {
	slug: "item",
	userId: user.id,
	isBuiltin: false,
	id: entitySchemaSlug,
	propertiesSchema: { fields: {} },
};

const mockAdmission = Layer.mock(ProviderImportAdmission);

const makeServiceLayer = (
	entitiesRepo = makeEntitiesRepository(),
	engine = makeWorkflowEngine(),
	activeProvider: typeof provider | null = provider,
	admission = mockAdmission({}),
) =>
	EntityImportService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				makeAppConfigLayer(),
				Layer.succeed(WorkflowEngine, engine),
				entitiesRepo,
				admission,
				Layer.mock(PluginRuntimeResolver)({
					findProviderAvailableToUser: () => Effect.succeed(activeProvider),
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
				reason: { field: "providerId", code: "invalid-import-input" },
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
				reason: { field: "externalId", code: "invalid-import-input" },
			}),
		);
	}).pipe(Effect.provide(makeServiceLayer())),
);

it.effect("returns NotFound when the provider is missing", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(service.import(user, { providerId, externalId }));
		expect(getFailure(result)).toEqual(
			new ProviderEntityNotFound({ reason: { providerId, code: "provider-not-found" } }),
		);
	}).pipe(Effect.provide(makeServiceLayer(makeEntitiesRepository(), makeWorkflowEngine(), null))),
);

it.effect("returns NotFound when the provider is inactive", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(service.import(user, { providerId, externalId }));
		expect(getFailure(result)).toEqual(
			new ProviderEntityNotFound({ reason: { providerId, code: "provider-not-found" } }),
		);
	}).pipe(Effect.provide(makeServiceLayer(makeEntitiesRepository(), makeWorkflowEngine(), null))),
);

it.effect("returns NotFound when the derived entity schema is not found", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(service.import(user, { providerId, externalId }));
		expect(getFailure(result)).toEqual(
			new ProviderEntityNotFound({ reason: { entitySchemaSlug, code: "entity-schema-not-found" } }),
		);
	}).pipe(
		Effect.provide(
			makeServiceLayer(
				makeEntitiesRepository({ findEntitySchemaForUser: () => Effect.succeed(null) }),
			),
		),
	),
);

const withSchema = makeEntitiesRepository({
	findEntitySchemaForUser: () => Effect.succeed(fakeEntitySchemaScope),
});

it.effect("derives the root entity schema before submitting the import for admission", () => {
	const submitted: unknown[] = [];
	return Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* service.import(user, { providerId, externalId });
		expect(typeof result.jobId).toBe("string");
		expect(submitted).toHaveLength(1);
		expect(submitted[0]).toMatchObject({
			userId: user.id,
			payload: {
				providerId,
				externalId,
				entitySchemaSlug,
				entityScope: { type: "global", userId: user.id },
				command: { causation: { source: "api", initiator: { id: user.id, kind: "user" } } },
			},
		});
	}).pipe(
		Effect.provide(
			makeServiceLayer(
				withSchema,
				makeWorkflowEngine(),
				provider,
				mockAdmission({
					submit: (input) =>
						Effect.sync(() => {
							submitted.push(input);
							return { status: "queued" as const, id: input.payload.executionId };
						}),
				}),
			),
		),
	);
});

it.effect("submits private provider imports with user-owned entity scope", () => {
	const submitted: unknown[] = [];
	return Effect.gen(function* () {
		const service = yield* EntityImportService;
		yield* service.import(user, { providerId, externalId });
		expect(submitted[0]).toMatchObject({
			payload: { entityScope: { type: "user", userId: user.id } },
		});
	}).pipe(
		Effect.provide(
			makeServiceLayer(
				withSchema,
				makeWorkflowEngine(),
				{ ...provider, pluginScope: "user" },
				mockAdmission({
					submit: (input) =>
						Effect.sync(() => {
							submitted.push(input);
							return { status: "queued" as const, id: input.payload.executionId };
						}),
				}),
			),
		),
	);
});

it.effect("returns the pending job for a duplicate import", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* service.import(user, { providerId, externalId });
		expect(result.jobId).toBe(
			createWorkflowJobId(deriveJobIdSecret("test-admin-token"), "exec-pending", user.id),
		);
	}).pipe(
		Effect.provide(
			makeServiceLayer(
				withSchema,
				makeWorkflowEngine(),
				provider,
				mockAdmission({
					submit: () => Effect.succeed({ id: "exec-pending", status: "duplicate" as const }),
				}),
			),
		),
	),
);

it.effect("rejects an import with a retryable error when the user's backlog is full", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(service.import(user, { providerId, externalId }));
		expect(getFailure(result)).toEqual(
			new ProviderEntityImportBacklogFull({
				reason: { limit: 50, retryAfterSeconds: 30, code: "import-backlog-full" },
			}),
		);
	}).pipe(
		Effect.provide(
			makeServiceLayer(
				withSchema,
				makeWorkflowEngine(),
				provider,
				mockAdmission({ submit: () => Effect.succeed({ status: "backlog-full" as const }) }),
			),
		),
	),
);

it.effect("returns NotFound for a blank getImportResult jobId", () =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const result = yield* Effect.exit(service.getImportResult(user, "   "));
		expect(getFailure(result)).toEqual(
			new ProviderEntityNotFound({ reason: { jobId: "   ", code: "import-job-not-found" } }),
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

const importResult = (
	admitted: "queued" | "running" | null,
	poll: ReturnType<typeof makeWorkflowEngine>["poll"],
) =>
	Effect.gen(function* () {
		const service = yield* EntityImportService;
		const jobId = createWorkflowJobId(deriveJobIdSecret("test-admin-token"), "exec-abc", user.id);
		return yield* service.getImportResult(user, jobId);
	}).pipe(
		Effect.provide(
			makeServiceLayer(
				makeEntitiesRepository(),
				makeWorkflowEngine({ poll }),
				provider,
				mockAdmission({ status: () => Effect.succeed(admitted) }),
			),
		),
	);

it.effect("reports a queued import from the admission ledger", () =>
	Effect.gen(function* () {
		expect(yield* importResult("queued", () => Effect.die("unreachable"))).toEqual({
			status: "queued",
		});
	}),
);

it.effect("returns running status when an admitted workflow has not completed", () =>
	Effect.gen(function* () {
		expect(yield* importResult("running", () => Effect.succeedNone)).toEqual({ status: "running" });
	}),
);

it.effect("reports an import cancelled before admission as cancelled", () =>
	Effect.gen(function* () {
		expect(yield* importResult(null, () => Effect.succeedNone)).toEqual({ status: "cancelled" });
	}),
);
