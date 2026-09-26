import { assert, expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	ProviderEntityBadRequest,
	ProviderEntityImportBacklogFull,
	ProviderEntityNotFound,
} from "@ryot-app/contract/modules/provider-entities/schemas";
import { EntitySchemaSlug, SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, Effect, Exit, Layer, Option, Ref } from "effect";
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
	preferences: { language: null, disableIntegrations: false },
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

type Admission = ProviderImportAdmission["Service"];
type SubmitInput = Parameters<Admission["submit"]>[0];

class FakeAdmission extends Context.Service<
	FakeAdmission,
	{ readonly submitted: Effect.Effect<ReadonlyArray<SubmitInput>> }
>()("test/FakeAdmission") {}

const makeServiceLayer = (
	options: {
		readonly entitiesRepo?: Layer.Layer<EntitiesRepository>;
		readonly engine?: WorkflowEngine["Service"];
		readonly activeProvider?: typeof provider | null;
		readonly submit?: (input: SubmitInput) => Effect.Success<ReturnType<Admission["submit"]>>;
		readonly status?: Admission["status"];
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const submitted = yield* Ref.make<ReadonlyArray<SubmitInput>>([]);
			const { submit, status } = options;
			const admission = Layer.mock(ProviderImportAdmission)({
				...(submit && {
					submit: (input) =>
						Ref.update(submitted, (all) => [...all, input]).pipe(Effect.as(submit(input))),
				}),
				...(status && { status }),
			});
			return EntityImportService.layer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						databaseLayer,
						makeAppConfigLayer(),
						Layer.succeed(WorkflowEngine, options.engine ?? makeWorkflowEngine()),
						options.entitiesRepo ?? makeEntitiesRepository(),
						admission,
						Layer.mock(PluginRuntimeResolver)({
							findProviderAvailableToUser: () =>
								Effect.succeed(
									options.activeProvider === undefined ? provider : options.activeProvider,
								),
						}),
						Layer.succeed(FakeAdmission, { submitted: Ref.get(submitted) }),
					),
				),
			);
		}),
	);

const queued = (input: SubmitInput) => ({
	status: "queued" as const,
	id: input.payload.executionId,
});

const getFailure = <A, E>(result: Exit.Exit<A, E>) => {
	expect(Exit.isFailure(result)).toBe(true);
	assert(Exit.isFailure(result), "Expected effect to fail");
	const failure = Cause.findErrorOption(result.cause);
	assert(Option.isSome(failure), "Expected typed failure");

	return failure.value;
};

layer(makeServiceLayer())((test) => {
	test.effect("returns BadRequest when providerId is blank", () =>
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
		}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect("returns BadRequest when externalId is blank", () =>
		Effect.gen(function* () {
			const service = yield* EntityImportService;
			const result = yield* Effect.exit(service.import(user, { providerId, externalId: "  " }));
			expect(getFailure(result)).toEqual(
				new ProviderEntityBadRequest({
					reason: { field: "externalId", code: "invalid-import-input" },
				}),
			);
		}),
	);
});

layer(makeServiceLayer({ activeProvider: null }))((test) => {
	test.effect("returns NotFound when the provider is missing", () =>
		Effect.gen(function* () {
			const service = yield* EntityImportService;
			const result = yield* Effect.exit(service.import(user, { providerId, externalId }));
			expect(getFailure(result)).toEqual(
				new ProviderEntityNotFound({ reason: { providerId, code: "provider-not-found" } }),
			);
		}),
	);
});

layer(makeServiceLayer({ activeProvider: null }))((test) => {
	test.effect("returns NotFound when the provider is inactive", () =>
		Effect.gen(function* () {
			const service = yield* EntityImportService;
			const result = yield* Effect.exit(service.import(user, { providerId, externalId }));
			expect(getFailure(result)).toEqual(
				new ProviderEntityNotFound({ reason: { providerId, code: "provider-not-found" } }),
			);
		}),
	);
});

layer(
	makeServiceLayer({
		entitiesRepo: makeEntitiesRepository({ findEntitySchemaForUser: () => Effect.succeed(null) }),
	}),
)((test) => {
	test.effect("returns NotFound when the derived entity schema is not found", () =>
		Effect.gen(function* () {
			const service = yield* EntityImportService;
			const result = yield* Effect.exit(service.import(user, { providerId, externalId }));
			expect(getFailure(result)).toEqual(
				new ProviderEntityNotFound({
					reason: { entitySchemaSlug, code: "entity-schema-not-found" },
				}),
			);
		}),
	);
});

const withSchema = makeEntitiesRepository({
	findEntitySchemaForUser: () => Effect.succeed(fakeEntitySchemaScope),
});

layer(makeServiceLayer({ submit: queued, entitiesRepo: withSchema }))((test) => {
	test.effect("derives the root entity schema before submitting the import for admission", () => {
		return Effect.gen(function* () {
			const service = yield* EntityImportService;
			const result = yield* service.import(user, { providerId, externalId });
			expect(typeof result.jobId).toBe("string");
			const submitted = yield* (yield* FakeAdmission).submitted;
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
		});
	});
});

layer(
	makeServiceLayer({
		submit: queued,
		entitiesRepo: withSchema,
		activeProvider: { ...provider, pluginScope: "user" },
	}),
)((test) => {
	test.effect("submits private provider imports with user-owned entity scope", () => {
		return Effect.gen(function* () {
			const service = yield* EntityImportService;
			yield* service.import(user, { providerId, externalId });
			const submitted = yield* (yield* FakeAdmission).submitted;
			expect(submitted[0]).toMatchObject({
				payload: { entityScope: { type: "user", userId: user.id } },
			});
		});
	});
});

layer(
	makeServiceLayer({
		entitiesRepo: withSchema,
		submit: () => ({ id: "exec-pending", status: "duplicate" as const }),
	}),
)((test) => {
	test.effect("returns the pending job for a duplicate import", () =>
		Effect.gen(function* () {
			const service = yield* EntityImportService;
			const result = yield* service.import(user, { providerId, externalId });
			expect(result.jobId).toBe(
				createWorkflowJobId(deriveJobIdSecret("test-admin-token"), "exec-pending", user.id),
			);
		}),
	);
});

layer(
	makeServiceLayer({
		entitiesRepo: withSchema,
		submit: () => ({ status: "backlog-full" as const }),
	}),
)((test) => {
	test.effect("rejects an import with a retryable error when the user's backlog is full", () =>
		Effect.gen(function* () {
			const service = yield* EntityImportService;
			const result = yield* Effect.exit(service.import(user, { providerId, externalId }));
			expect(getFailure(result)).toEqual(
				new ProviderEntityImportBacklogFull({
					reason: { limit: 50, retryAfterSeconds: 30, code: "import-backlog-full" },
				}),
			);
		}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect("returns NotFound for a blank getImportResult jobId", () =>
		Effect.gen(function* () {
			const service = yield* EntityImportService;
			const result = yield* Effect.exit(service.getImportResult(user, "   "));
			expect(getFailure(result)).toEqual(
				new ProviderEntityNotFound({ reason: { jobId: "   ", code: "import-job-not-found" } }),
			);
		}),
	);
});

layer(makeServiceLayer())((test) => {
	test.effect("returns NotFound for a jobId with an invalid signature", () =>
		Effect.gen(function* () {
			const service = yield* EntityImportService;
			const result = yield* Effect.exit(service.getImportResult(user, "fake-execution-id.badsig"));
			expect(getFailure(result)).toEqual(
				new ProviderEntityNotFound({
					reason: { code: "import-job-not-found", jobId: "fake-execution-id.badsig" },
				}),
			);
		}),
	);
});

const importResultLayer = (
	admitted: "queued" | "running" | null,
	poll: ReturnType<typeof makeWorkflowEngine>["poll"],
) =>
	makeServiceLayer({
		engine: makeWorkflowEngine({ poll }),
		status: () => Effect.succeed(admitted),
	});

const importResult = Effect.gen(function* () {
	const service = yield* EntityImportService;
	const jobId = createWorkflowJobId(deriveJobIdSecret("test-admin-token"), "exec-abc", user.id);
	return yield* service.getImportResult(user, jobId);
});

layer(importResultLayer("queued", () => Effect.die("unreachable")))((test) => {
	test.effect("reports a queued import from the admission ledger", () =>
		Effect.gen(function* () {
			expect(yield* importResult).toEqual({ status: "queued" });
		}),
	);
});

layer(importResultLayer("running", () => Effect.succeedNone))((test) => {
	test.effect("returns running status when an admitted workflow has not completed", () =>
		Effect.gen(function* () {
			expect(yield* importResult).toEqual({ status: "running" });
		}),
	);
});

layer(importResultLayer(null, () => Effect.succeedNone))((test) => {
	test.effect("reports an import cancelled before admission as cancelled", () =>
		Effect.gen(function* () {
			expect(yield* importResult).toEqual({ status: "cancelled" });
		}),
	);
});
