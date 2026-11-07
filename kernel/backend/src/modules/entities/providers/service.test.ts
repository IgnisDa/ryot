import { expect } from "bun:test";

import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	ProviderEntityBadRequest,
	ProviderEntityImportBacklogFull,
	ProviderEntityNotFound,
} from "@ryot-app/contract/modules/entity-providers/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Cause, Context, Effect, Exit, Fiber, Layer, Option, Queue, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import { createWorkflowJobId, deriveJobIdSecret } from "#platform/workflow/job-id";
import {
	databaseLayer,
	makeAppConfigLayer,
	makeWorkflowEngine,
	type MockOverrides,
} from "#testing/effect";

import { ProviderImportAdmission } from "./admission";
import { EntityImportWorkflow } from "./entity-import-workflow";
import { EntityImportService } from "./service";

const user: CurrentUserValue = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { language: null, reportingTimeZone: UTC, disableIntegrations: false },
};

const externalId = "ext-123";
const providerId = SandboxProviderId.make("provider-1");
const entitySchemaSlug = EntitySchemaSlug.make("schema-1");
const provider: NonNullable<
	Effect.Success<ReturnType<PluginRuntimeResolver["Service"]["findProviderAvailableToUser"]>>
> = {
	id: providerId,
	name: "Provider",
	pluginId: "plugin",
	slug: "provider.slug",
	pluginScope: "system",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	information: { source: "provider" },
	rootEntitySchemaSlug: entitySchemaSlug,
};

const mockEntitiesRepository = Layer.mock(EntitiesRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({ ...overrides });

const fakeEntitySchemaScope = {
	userId: null,
	isBuiltin: false,
	id: entitySchemaSlug,
	slug: entitySchemaSlug,
	pluginId: provider.pluginId,
	propertiesSchema: { fields: {} },
};

type Admission = ProviderImportAdmission["Service"];
type SubmitInput = Parameters<Admission["submit"]>[0];

class FakeAdmission extends Context.Service<
	FakeAdmission,
	{
		readonly statusRead: Effect.Effect<void>;
		readonly submitted: Effect.Effect<ReadonlyArray<SubmitInput>>;
	}
>()("@ryot-app/kernel-backend/modules/entities/providers/service.test/FakeAdmission") {}

const makeServiceLayer = (
	options: {
		readonly status?: Admission["status"];
		readonly engine?: WorkflowEngine["Service"];
		readonly activeProvider?: null | typeof provider;
		readonly entryEventSchemaSlugs?: ReadonlyArray<string>;
		readonly entitiesRepo?: Layer.Layer<EntitiesRepository>;
		readonly submit?: (input: SubmitInput) => Effect.Success<ReturnType<Admission["submit"]>>;
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const submitted = yield* Ref.make<ReadonlyArray<SubmitInput>>([]);
			const statusReads = yield* Queue.unbounded<void>();
			const { submit, status } = options;
			const dependencies = Layer.mergeAll(
				makeAppConfigLayer(),
				Layer.succeed(WorkflowEngine, options.engine ?? makeWorkflowEngine()),
				options.entitiesRepo ?? makeEntitiesRepository(),
				Layer.mock(EventSchemaReader)({
					getScopeForUser: (input) =>
						Effect.succeed(
							options.entryEventSchemaSlugs?.includes(input.eventSchemaSlug) &&
								input.entitySchemaSlug === entitySchemaSlug &&
								input.entitySchemaPluginId === provider.pluginId
								? {
										name: "Planned",
										id: input.eventSchemaSlug,
										slug: input.eventSchemaSlug,
										pluginId: provider.pluginId,
										propertiesSchema: { fields: {} },
										entitySchemaSlug: input.entitySchemaSlug,
									}
								: null,
						),
				}),
				Layer.mock(PluginRuntimeResolver)({
					findProviderAvailableToUser: () =>
						Effect.succeed(
							options.activeProvider === undefined ? provider : options.activeProvider,
						),
				}),
				Layer.succeed(FakeAdmission, {
					submitted: Ref.get(submitted),
					statusRead: Queue.take(statusReads).pipe(Effect.asVoid),
				}),
			);
			const admission = Layer.mock(ProviderImportAdmission)({
				...(submit && {
					submit: (input) =>
						Ref.update(submitted, (all) => [...all, input]).pipe(Effect.as(submit(input))),
				}),
				...(status && {
					status: (input) =>
						status(input).pipe(Effect.tap(() => Queue.offer(statusReads, undefined))),
				}),
				cancel: () => Effect.void,
			});
			return EntityImportService.layer.pipe(
				Layer.provideMerge(admission),
				Layer.provideMerge(WorkflowExecutionNotifications.layer),
				Layer.provideMerge(dependencies),
				Layer.provideMerge(databaseLayer),
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
	test.effect(
		"returns BadRequest when providerId is blank",
		() =>
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
		testTimeout,
	);
});

layer(makeServiceLayer())((test) => {
	test.effect(
		"returns BadRequest when externalId is blank",
		() =>
			Effect.gen(function* () {
				const service = yield* EntityImportService;
				const result = yield* Effect.exit(service.import(user, { providerId, externalId: "  " }));
				expect(getFailure(result)).toEqual(
					new ProviderEntityBadRequest({
						reason: { field: "externalId", code: "invalid-import-input" },
					}),
				);
			}),
		testTimeout,
	);
});

layer(makeServiceLayer({ activeProvider: null }))((test) => {
	test.effect(
		"returns NotFound when the provider is missing",
		() =>
			Effect.gen(function* () {
				const service = yield* EntityImportService;
				const result = yield* Effect.exit(service.import(user, { providerId, externalId }));
				expect(getFailure(result)).toEqual(
					new ProviderEntityNotFound({ reason: { providerId, code: "provider-not-found" } }),
				);
			}),
		testTimeout,
	);
});

layer(makeServiceLayer({ activeProvider: null }))((test) => {
	test.effect(
		"returns NotFound when the provider is inactive",
		() =>
			Effect.gen(function* () {
				const service = yield* EntityImportService;
				const result = yield* Effect.exit(service.import(user, { providerId, externalId }));
				expect(getFailure(result)).toEqual(
					new ProviderEntityNotFound({ reason: { providerId, code: "provider-not-found" } }),
				);
			}),
		testTimeout,
	);
});

layer(
	makeServiceLayer({
		entitiesRepo: makeEntitiesRepository({ findEntitySchemaForUser: () => Effect.succeed(null) }),
	}),
)((test) => {
	test.effect(
		"returns NotFound when the derived entity schema is not found",
		() =>
			Effect.gen(function* () {
				const service = yield* EntityImportService;
				const result = yield* Effect.exit(service.import(user, { providerId, externalId }));
				expect(getFailure(result)).toEqual(
					new ProviderEntityNotFound({
						reason: { entitySchemaSlug, code: "entity-schema-not-found" },
					}),
				);
			}),
		testTimeout,
	);
});

const withSchema = makeEntitiesRepository({
	findEntitySchemaForUser: () => Effect.succeed(fakeEntitySchemaScope),
});

layer(makeServiceLayer({ submit: queued, entitiesRepo: withSchema }))((test) => {
	test.effect(
		"derives the root entity schema before submitting the import for admission",
		() => {
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
		},
		testTimeout,
	);
});

layer(
	makeServiceLayer({
		submit: queued,
		entitiesRepo: withSchema,
		entryEventSchemaSlugs: ["planned"],
	}),
)((test) => {
	test.effect(
		"submits an entry event the root entity schema declares",
		() =>
			Effect.gen(function* () {
				const service = yield* EntityImportService;
				yield* service.import(user, { providerId, externalId, entryEventSchemaSlug: "planned" });
				const submitted = yield* (yield* FakeAdmission).submitted;
				expect(submitted[0]?.payload.entryEventSchemaSlug).toBe(EventSchemaSlug.make("planned"));
			}),
		testTimeout,
	);
});

layer(
	makeServiceLayer({
		submit: queued,
		entitiesRepo: withSchema,
		entryEventSchemaSlugs: ["planned"],
	}),
)((test) => {
	test.effect(
		"rejects an entry event the root entity schema does not declare",
		() =>
			Effect.gen(function* () {
				const service = yield* EntityImportService;
				const result = yield* Effect.exit(
					service.import(user, { providerId, externalId, entryEventSchemaSlug: "unknown" }),
				);
				expect(getFailure(result)).toEqual(
					new ProviderEntityBadRequest({
						reason: { code: "invalid-import-input", field: "entryEventSchemaSlug" },
					}),
				);
				expect(yield* (yield* FakeAdmission).submitted).toEqual([]);
			}),
		testTimeout,
	);
});

layer(
	makeServiceLayer({
		submit: queued,
		entitiesRepo: withSchema,
		activeProvider: { ...provider, pluginScope: "user" },
	}),
)((test) => {
	test.effect(
		"submits private provider imports with user-owned entity scope",
		() => {
			return Effect.gen(function* () {
				const service = yield* EntityImportService;
				yield* service.import(user, { providerId, externalId });
				const submitted = yield* (yield* FakeAdmission).submitted;
				expect(submitted[0]).toMatchObject({
					payload: { entityScope: { type: "user", userId: user.id } },
				});
			});
		},
		testTimeout,
	);
});

layer(
	makeServiceLayer({
		entitiesRepo: withSchema,
		submit: () => ({ id: "exec-pending", status: "duplicate" as const }),
	}),
)((test) => {
	test.effect(
		"returns the pending job for a duplicate import",
		() =>
			Effect.gen(function* () {
				const service = yield* EntityImportService;
				const result = yield* service.import(user, { providerId, externalId });
				expect(result.jobId).toBe(
					createWorkflowJobId(
						deriveJobIdSecret("test-admin-token"),
						{ executionId: "exec-pending" },
						user.id,
					),
				);
			}),
		testTimeout,
	);
});

layer(
	makeServiceLayer({
		entitiesRepo: withSchema,
		submit: () => ({ status: "backlog-full" as const }),
	}),
)((test) => {
	test.effect(
		"rejects an import with a retryable error when the user's backlog is full",
		() =>
			Effect.gen(function* () {
				const service = yield* EntityImportService;
				const result = yield* Effect.exit(service.import(user, { providerId, externalId }));
				expect(getFailure(result)).toEqual(
					new ProviderEntityImportBacklogFull({
						reason: { limit: 50, retryAfterSeconds: 30, code: "import-backlog-full" },
					}),
				);
			}),
		testTimeout,
	);
});

layer(makeServiceLayer())((test) => {
	test.effect(
		"returns NotFound for a blank getImportResult jobId",
		() =>
			Effect.gen(function* () {
				const service = yield* EntityImportService;
				const result = yield* Effect.exit(service.getImportResult(user, "   "));
				expect(getFailure(result)).toEqual(
					new ProviderEntityNotFound({ reason: { jobId: "   ", code: "import-job-not-found" } }),
				);
			}),
		testTimeout,
	);
});

layer(makeServiceLayer())((test) => {
	test.effect(
		"returns NotFound for a jobId with an invalid signature",
		() =>
			Effect.gen(function* () {
				const service = yield* EntityImportService;
				const result = yield* Effect.exit(
					service.getImportResult(user, "fake-execution-id.badsig"),
				);
				expect(getFailure(result)).toEqual(
					new ProviderEntityNotFound({
						reason: { code: "import-job-not-found", jobId: "fake-execution-id.badsig" },
					}),
				);
			}),
		testTimeout,
	);
});

const importResultLayer = (
	admitted: null | "queued" | "running" | Admission["status"],
	poll: ReturnType<typeof makeWorkflowEngine>["poll"],
) =>
	makeServiceLayer({
		engine: makeWorkflowEngine({ poll }),
		status: typeof admitted === "function" ? admitted : () => Effect.succeed(admitted),
	});

const importResultJobId = createWorkflowJobId(
	deriveJobIdSecret("test-admin-token"),
	{ executionId: "exec-abc" },
	user.id,
);
const importIdentity = { executionId: "exec-abc", workflowName: EntityImportWorkflow._tag };
const importResult = Effect.flatMap(EntityImportService, (service) =>
	service.getImportResult(user, importResultJobId),
);

layer(
	importResultLayer(
		(() => {
			let reads = 0;
			return () => Effect.sync(() => (reads++ === 0 ? "queued" : null));
		})(),
		() => Effect.succeedNone,
	),
)((test) => {
	test.effect(
		"returns a queued cancellation when cancelImport wakes its result wait",
		() =>
			Effect.gen(function* () {
				const admission = yield* FakeAdmission;
				const fiber = yield* Effect.forkChild(importResult);
				yield* admission.statusRead;
				const service = yield* EntityImportService;
				yield* service.cancelImport(user, importResultJobId);
				expect(yield* Fiber.join(fiber)).toEqual({ status: "cancelled" });
			}),
		testTimeout,
	);
});

layer(importResultLayer("running", () => Effect.succeedNone))((test) => {
	test.effect(
		"returns running status after its notification wait times out",
		() =>
			Effect.gen(function* () {
				const admission = yield* FakeAdmission;
				const fiber = yield* Effect.forkChild(importResult);
				yield* admission.statusRead;
				yield* TestClock.adjust("20 seconds");
				expect(yield* Fiber.join(fiber)).toEqual({ status: "running" });
			}),
		testTimeout,
	);
});

layer(
	importResultLayer(
		"running",
		(() => {
			let polls = 0;
			return (_workflow, executionId) =>
				executionId === "exec-abc" && polls++ > 0
					? Effect.succeedSome(new Workflow.Complete({ exit: Exit.succeed(importedEntity) }))
					: Effect.succeedNone;
		})(),
	),
)((test) => {
	test.effect(
		"returns workflow completion after a matching notification",
		() =>
			Effect.gen(function* () {
				const admission = yield* FakeAdmission;
				const notifications = yield* WorkflowExecutionNotifications;
				const fiber = yield* Effect.forkChild(importResult);
				yield* admission.statusRead;
				yield* notifications.publish(importIdentity);
				expect(yield* Fiber.join(fiber)).toEqual<unknown>({
					status: "completed",
					data: importedEntity,
				});
			}),
		testTimeout,
	);
});

const importedEntity = {
	externalId,
	providerId,
	properties: {},
	name: "Imported",
	id: EntityId.make("entity-imported"),
	createdAt: "2026-10-10T00:00:00.000Z",
	updatedAt: "2026-10-10T00:00:00.000Z",
	populatedAt: "2026-10-10T00:00:00.000Z",
	entitySchemaSlug: EntitySchemaSlug.make("item"),
};

layer(
	importResultLayer("running", (workflow, executionId) =>
		workflow._tag === EntityImportWorkflow._tag && executionId === "exec-abc"
			? Effect.succeedSome(new Workflow.Complete({ exit: Exit.succeed(importedEntity) }))
			: Effect.succeedNone,
	),
)((test) => {
	test.effect(
		"returns terminal workflow results without waiting for a notification",
		() =>
			Effect.gen(function* () {
				expect(yield* importResult).toEqual<unknown>({ status: "completed", data: importedEntity });
			}),
		testTimeout,
	);
});

layer(
	importResultLayer("running", (workflow, executionId) =>
		workflow._tag === EntityImportWorkflow._tag && executionId === "exec-abc"
			? Effect.succeedSome(
					new Workflow.Complete({
						exit: Exit.fail({ message: "failed", stage: "population" as const }),
					}),
				)
			: Effect.succeedNone,
	),
)((test) => {
	test.effect(
		"returns a terminal workflow failure without waiting for a notification",
		() =>
			Effect.gen(function* () {
				expect(yield* importResult).toMatchObject({ status: "failed" });
			}),
		testTimeout,
	);
});

layer(importResultLayer(null, () => Effect.succeedNone))((test) => {
	test.effect(
		"reports an import cancelled before admission as cancelled",
		() =>
			Effect.gen(function* () {
				expect(yield* importResult).toEqual({ status: "cancelled" });
			}),
		testTimeout,
	);
});
