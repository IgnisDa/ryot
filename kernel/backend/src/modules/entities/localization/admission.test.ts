import { assert, expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import { declaredScriptMetadata } from "@ryot-app/plugin-backend-compiler/plugin-manifest";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { eq } from "drizzle-orm";
import { DateTime, Deferred, Effect, Fiber, Layer } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { DomainWriteChecks } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { SandboxWorkflowPinning } from "#modules/scripts/executions/workflow";
import { SandboxPluginScriptResolver } from "#modules/scripts/registry/plugin-script-resolver";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";
import { DatabaseSession } from "#platform/db/session";
import { RedisService } from "#platform/redis";
import * as tables from "#schema/tables/combined";
import { makeRedisService, makeWorkflowEngine } from "#testing/effect";

import { TranslationsRepository } from "./repository";
import { type RequestFillInput, TranslationsService } from "./service";

const dependencies = Layer.mergeAll(
	TranslationsRepository.layer,
	Layer.mock(DomainWriteChecks)({}),
	EnrichmentRequests.layer.pipe(
		Layer.provide(
			Layer.succeed(RedisService, makeRedisService({ publish: () => Effect.succeed(1) })),
		),
	),
	SandboxWorkflowPinning.layer.pipe(Layer.provide(Layer.mock(SandboxPluginScriptResolver)({}))),
).pipe(Layer.provideMerge(revisionDatabaseLayer));

const harness = Effect.fnUntraced(function* (
	options: { interleave?: boolean; failAfterRetain?: boolean } = {},
) {
	const session = yield* DatabaseSession;
	const requests = yield* EnrichmentRequests;
	const pinning = yield* SandboxWorkflowPinning;
	const references = yield* SandboxWorkflowReferenceRepository;
	const runtime = yield* PluginRuntimeResolver;
	const slug = `translation-admission-${crypto.randomUUID()}`;
	const original = revisionPackage(slug, "one", "record");
	const declaration = {
		...emptySandboxExecutionMetadata,
		name: "Translate",
		kind: "provider" as const,
		slug: `${slug}.translate`,
		providerSlug: `${slug}-provider`,
		translationInputs: { record: [] },
		entry: "backend/translate.sandbox.ts",
		providerOperation: "translate" as const,
	};
	const installed = yield* installRevisionPackage({
		...original,
		manifest: { ...original.manifest, scripts: [...original.manifest.scripts, declaration] },
		scripts: [
			...original.scripts,
			{
				compiledFormat: 1,
				name: declaration.name,
				slug: declaration.slug,
				entry: declaration.entry,
				contentHash: "translation",
				compiledCode: "translation",
				metadata: declaredScriptMetadata(declaration),
			},
		],
	});
	const userId = UserId.make("owner");
	const account = yield* requests.account(userId);
	assert(account);
	const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
		slug: `${slug}-provider`,
		owner: definitionOwner(installed.pluginId),
	});
	assert(provider);
	const entityId = EntityId.make(`translation-${crypto.randomUUID()}`);
	const populatedAt = yield* DateTime.nowAsDate;
	yield* session.run((db) =>
		db
			.insert(tables.entity)
			.values({
				populatedAt,
				id: entityId,
				externalId: "record",
				providerId: provider.id,
				name: "Canonical record",
				entitySchemaSlug: "record",
				entitySchemaPluginId: installed.pluginId,
			}),
	);
	const entered = yield* Deferred.make<void>();
	const resume = yield* Deferred.make<void>();
	const registrationCalls: string[] = [];
	const dispatches: string[] = [];
	const sandbox = ScriptExecutionService.of({
		enqueue: () => Effect.die("unused"),
		getResult: () => Effect.die("unused"),
		executeScript: () => Effect.die("unused"),
		executeWorkflow: () => Effect.die("unused"),
		resolveWorkflowScript: () => Effect.die("unused"),
		enqueuePluginWorkflow: () => Effect.die("unused"),
		getPluginWorkflowResult: () => Effect.die("unused"),
		releaseWorkflowRegistration: () =>
			Effect.die("Admission must never release the winning registration"),
		preRegisterPluginWorkflow: (input) =>
			Effect.gen(function* () {
				registrationCalls.push(input.executionId);
				if (options.interleave && registrationCalls.length === 1) {
					yield* Deferred.succeed(entered, undefined);
					yield* Deferred.await(resume);
				}
				const pin = yield* pinning.establish(
					{
						input: {},
						lane: "background",
						resolutionMode: "exact",
						scriptId: input.scriptId,
						executionId: input.executionId,
						subject: {
							type: "user",
							userId: input.executingUserId,
							accountGeneration: input.accountGeneration,
						},
					},
					input.executionId,
					input.pluginId,
					(principal) =>
						Effect.gen(function* () {
							if (input.retain) {
								yield* input.retain(principal);
							}
							if (options.failAfterRetain) {
								return yield* new SandboxRunError({
									kind: "infrastructure",
									message: "After retain failure",
								});
							}
							return yield* Effect.void;
						}),
				);
				if (!pin.principal.pluginRevision) {
					return yield* new SandboxRunError({
						kind: "missing-artifact",
						message: "Missing test pin",
					});
				}
				return { ...pin, pluginRevision: pin.principal.pluginRevision };
			}),
	});
	const engine = makeWorkflowEngine({
		execute: (_workflow, input) =>
			Effect.gen(function* () {
				expect(yield* session.isTransactionActive).toBe(false);
				assert(input.executionId);
				dispatches.push(input.executionId);
				yield* requests.update(input.executionId, { attempt: 1, state: "running" });
			}),
	});
	const translations = yield* TranslationsService.make.pipe(
		Effect.provideService(ScriptExecutionService, sandbox),
		Effect.provideService(WorkflowEngine, engine),
	);
	const input = {
		userId,
		entityId,
		language: "es",
		lane: "interactive",
		externalId: "record",
		providerId: provider.id,
		accountGeneration: account,
		entitySchemaSlug: "record",
		entitySchemaPluginId: installed.pluginId,
	} satisfies RequestFillInput;
	return {
		input,
		resume,
		entered,
		requests,
		dispatches,
		translations,
		registrationCalls,
		references: references.listReferences(installed.pluginId),
		receipts: (id: string) =>
			session.run((db) =>
				db
					.select({ id: tables.mutationReceipt.id })
					.from(tables.mutationReceipt)
					.where(eq(tables.mutationReceipt.executionId, id)),
			),
	};
});

layer(dependencies)((test) => {
	for (const retryOf of [undefined, "previous-request"]) {
		test.effect(
			`does not release or replace the winner when a ${retryOf ? "manual retry" : "same-ID caller"} loses admission`,
			() =>
				Effect.gen(function* () {
					const h = yield* harness({ interleave: true });
					const input = { ...h.input, ...(retryOf === undefined ? {} : { retryOf }) };
					const first = yield* Effect.forkChild(
						h.translations.requestFill({ ...input, ...(retryOf ? { refreshKey: "first" } : {}) }),
					);
					yield* Deferred.await(h.entered);
					expect(
						yield* h.translations.requestFill({
							...input,
							...(retryOf ? { refreshKey: "second" } : {}),
						}),
					).toBe(true);
					const winner = h.dispatches[0];
					assert(winner);
					expect(yield* h.requests.get(winner)).toMatchObject({ state: "running" });
					yield* Deferred.succeed(h.resume, undefined);
					expect(yield* Fiber.join(first)).toBe(false);
					expect(h.dispatches).toEqual([winner]);
					expect(yield* h.references).toMatchObject([{ executionId: winner }]);
					expect(yield* h.references).toHaveLength(1);
					if (retryOf !== undefined) {
						const loser = h.registrationCalls[0];
						assert(loser);
						expect(yield* h.requests.get(loser)).toBeNull();
						expect(yield* h.receipts(loser)).toEqual([]);
					}
				}),
		);
	}

	test.effect(
		"rolls back the immutable request and registration owner when admission fails after retention",
		() =>
			Effect.gen(function* () {
				const h = yield* harness({ failAfterRetain: true });
				assertExitFails(
					yield* Effect.exit(h.translations.requestFill(h.input)),
					new SandboxRunError({ kind: "infrastructure", message: "After retain failure" }),
				);
				const id = h.registrationCalls[0];
				assert(id);
				expect(yield* h.requests.get(id)).toBeNull();
				expect(yield* h.references).toEqual([]);
				expect(yield* h.receipts(id)).toEqual([]);
				expect(h.dispatches).toEqual([]);
			}),
	);
});
