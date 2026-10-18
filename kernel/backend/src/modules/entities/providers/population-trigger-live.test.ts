import { assert, expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Context, Effect, Exit, Layer, Ref, Schema } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import {
	entityPopulationExecutionId,
	EntityPopulationTrigger,
	type PopulationExecution,
	type PopulationRequest,
	userPopulationRequest,
} from "#modules/entities/population-trigger";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { ScriptExecutionServiceLive } from "#modules/scripts/layer";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";
import { DatabaseSession } from "#platform/db/session";
import { RedisService } from "#platform/redis";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer, makeRedisService, makeWorkflowEngine } from "#testing/effect";

import { EntityPopulationTriggerLive } from "./population-trigger-live";
import { ProviderEntityPopulationPayload } from "./provider-entity-population-workflow";

const userId = UserId.make("population-trigger-user");
type ExecuteOptions = Parameters<WorkflowEngine["Service"]["execute"]>[1];

class PopulationFixture extends Context.Service<
	PopulationFixture,
	{
		readonly request: PopulationRequest;
		readonly executions: Effect.Effect<ReadonlyArray<ExecuteOptions>>;
		readonly admissionTransactions: Effect.Effect<ReadonlyArray<boolean>>;
		readonly dispatchTransactions: Effect.Effect<ReadonlyArray<boolean>>;
	}
>()("test/PopulationFixture") {}

const triggerLayer = (
	scope: "system" | "user",
	options: {
		readonly unavailable?: boolean;
		readonly globalEntity?: boolean;
		readonly systemSubject?: boolean;
		readonly enqueueFails?: boolean;
		readonly admissionFails?: boolean;
		readonly staleRequestLookup?: boolean;
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values({
						id: userId,
						name: "Trigger",
						email: "population-trigger@example.test",
						accountGeneration: "test-account-generation",
					}),
			);
			const installed = yield* installRevisionPackage(
				revisionPackage("population-trigger", "one", "record"),
				scope === "user" ? userId : null,
			);
			const installations = yield* PluginInstallationRepository;
			const installation =
				scope === "user"
					? installed.installation
					: yield* installations.upsertState({
							userId,
							config: {},
							sortOrder: 0,
							health: "ready",
							isHidden: false,
							pluginId: installed.pluginId,
						});
			assert(installation);
			const runtime = yield* PluginRuntimeResolver;
			const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
				slug: "population-trigger-provider",
				owner: definitionOwner(installed.pluginId),
			});
			assert(provider);
			yield* session.run((db) =>
				db
					.insert(tables.entity)
					.values(
						["entity-0", "entity-1", "entity-2"].map((id, index) => ({
							id,
							name: id,
							providerId: provider.id,
							entitySchemaSlug: "record",
							externalId: `record-${index}`,
							entitySchemaPluginId: installed.pluginId,
							userId: options.systemSubject || options.globalEntity ? null : userId,
						})),
					),
			);
			const accountGeneration = { userId, token: "test-account-generation" };
			const userCommand = {
				...rootLifecycleCommand({
					source: "api",
					accountGeneration,
					lane: "interactive",
					itemIdentity: "populate",
					occurredAt: "2026-09-16T00:00:00.000Z",
					initiator: { id: userId, kind: "user" },
					executionId: AutomationExecutionId.make("populate-entity-1"),
				}),
				writeContext: null,
			};
			let command: PopulationRequest["command"] = userCommand;
			if (options.systemSubject) {
				const script = yield* runtime.resolveDetailsScript(provider.id);
				const subject = { type: "system" as const };
				const pin = yield* (yield* SandboxRepository).getScriptPin(script.id, undefined, subject);
				assert(pin?.pluginRevision);
				const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
				command = {
					...rootLifecycleCommand({
						lane: "background",
						accountGeneration: null,
						itemIdentity: "populate",
						source: "provider-refresh",
						occurredAt: "2026-09-16T00:00:00.000Z",
						initiator: { id: null, kind: "system" },
						executionId: AutomationExecutionId.make("populate-entity-1"),
					}),
					writeContext: principal,
				};
			}
			if (options.unavailable) {
				yield* installations.updateHealth({
					health: "failed",
					id: installation.id,
					healthReason: "Unavailable fixture",
				});
			}
			const request: PopulationRequest = {
				command,
				externalId: "record-1",
				providerId: provider.id,
				execution: { level: "full" },
				entityId: EntityId.make("entity-1"),
				entitySchemaPluginId: installed.pluginId,
				entitySchemaSlug: EntitySchemaSlug.make("record"),
				userId: options.systemSubject || options.globalEntity ? null : userId,
			};
			const executions = yield* Ref.make<ReadonlyArray<ExecuteOptions>>([]);
			const admissionTransactions = yield* Ref.make<ReadonlyArray<boolean>>([]);
			const dispatchTransactions = yield* Ref.make<ReadonlyArray<boolean>>([]);
			const requestLayer = Layer.effect(
				EnrichmentRequests,
				Effect.gen(function* () {
					const requests = yield* EnrichmentRequests;
					return {
						...requests,
						get: options.staleRequestLookup ? () => Effect.succeed(null) : requests.get,
						ensure: Effect.fnUntraced(function* (input: Parameters<typeof requests.ensure>[0]) {
							const active = yield* session.isTransactionActive;
							yield* Ref.update(admissionTransactions, (all) => [...all, active]);
							const row = yield* requests.ensure(input);
							if (options.admissionFails) {
								return yield* new SandboxRunError({
									kind: "infrastructure",
									message: "Admission failed after persistence",
								});
							}
							return row;
						}),
					};
				}),
			).pipe(Layer.provide(EnrichmentRequests.layer));
			const engine = makeWorkflowEngine({
				execute: (_workflow, input) =>
					Effect.gen(function* () {
						const active = yield* session.isTransactionActive;
						yield* Ref.update(dispatchTransactions, (all) => [...all, active]);
						yield* Ref.update(executions, (all) => [...all, input]);
						if (options.enqueueFails) {
							return yield* Effect.die("enqueue failed");
						}
						return undefined;
					}),
			});
			return EntityPopulationTriggerLive.pipe(
				Layer.provide(Layer.merge(ScriptExecutionServiceLive, DomainWriteChecksLive)),
				Layer.provideMerge(requestLayer),
				Layer.provide(
					Layer.succeed(RedisService, makeRedisService({ publish: () => Effect.succeed(1) })),
				),
				Layer.provideMerge(Layer.succeed(WorkflowEngine, engine)),
				Layer.merge(
					Layer.succeed(PopulationFixture, {
						request,
						executions: Ref.get(executions),
						dispatchTransactions: Ref.get(dispatchTransactions),
						admissionTransactions: Ref.get(admissionTransactions),
					}),
				),
			);
		}),
	).pipe(Layer.provideMerge(revisionDatabaseLayer), Layer.provide(makeAppConfigLayer()));

layer(triggerLayer("system", { enqueueFails: true, systemSubject: true }))((test) => {
	test.effect("keeps a deterministic system ID and exposes enqueue failure", () =>
		Effect.gen(function* () {
			const fixture = yield* PopulationFixture;
			const exit = yield* Effect.exit((yield* EntityPopulationTrigger).request(fixture.request));
			expect((yield* fixture.executions).map(({ executionId }) => executionId)).toEqual([
				entityPopulationExecutionId(fixture.request.entityId, null, fixture.request.execution),
			]);
			expect(Exit.isFailure(exit)).toBe(true);
		}),
	);
});

layer(triggerLayer("system", { unavailable: true }))((test) => {
	test.effect("does not enqueue population for an unavailable installation", () =>
		Effect.gen(function* () {
			const fixture = yield* PopulationFixture;
			expect(yield* (yield* EntityPopulationTrigger).request(fixture.request)).toBe(false);
			expect(yield* fixture.executions).toEqual([]);
		}),
	);
});

for (const scope of ["system", "user"] as const) {
	layer(triggerLayer(scope, { admissionFails: true, systemSubject: scope === "system" }))(
		(test) => {
			test.effect(`rolls back ${scope} population admission and registration together`, () =>
				Effect.gen(function* () {
					const fixture = yield* PopulationFixture;
					const exit = yield* Effect.exit(
						(yield* EntityPopulationTrigger).request(fixture.request),
					);
					expect(Exit.isFailure(exit)).toBe(true);
					const executionId = entityPopulationExecutionId(
						fixture.request.entityId,
						fixture.request.command.accountGeneration,
						fixture.request.execution,
					);
					expect(yield* (yield* EnrichmentRequests).get(executionId)).toBeNull();
					expect(yield* (yield* SandboxWorkflowReferenceRepository).listReferences()).toEqual([]);
					expect(yield* fixture.admissionTransactions).toEqual([true]);
					expect(yield* fixture.executions).toEqual([]);
				}),
			);
		},
	);
}

layer(triggerLayer("user", { enqueueFails: true }))((test) => {
	test.effect("retains committed population admission and registration when dispatch fails", () =>
		Effect.gen(function* () {
			const fixture = yield* PopulationFixture;
			const exit = yield* Effect.exit((yield* EntityPopulationTrigger).request(fixture.request));
			expect(Exit.isFailure(exit)).toBe(true);
			const [execution] = yield* fixture.executions;
			assert(execution);
			const request = yield* (yield* EnrichmentRequests).get(execution.executionId);
			expect(request?.state).toBe("queued");
			expect(
				yield* Schema.decodeUnknownEffect(ProviderEntityPopulationPayload)(request?.payload),
			).toEqual(execution.payload);
			const references = yield* (yield* SandboxWorkflowReferenceRepository).listReferences();
			expect(references.map(({ executionId }) => executionId)).toEqual([execution.executionId]);
			expect(yield* fixture.admissionTransactions).toEqual([true]);
			expect(yield* fixture.dispatchTransactions).toEqual([false]);
		}),
	);
});

layer(triggerLayer("user"))((test) => {
	test.effect("rolls back population admission when its registration conflicts", () =>
		Effect.gen(function* () {
			const fixture = yield* PopulationFixture;
			const references = yield* SandboxWorkflowReferenceRepository;
			const session = yield* DatabaseSession;
			const executionId = entityPopulationExecutionId(
				fixture.request.entityId,
				fixture.request.command.accountGeneration,
				fixture.request.execution,
			);
			const search = yield* (yield* PluginRuntimeResolver).resolveUserSearchScript(
				userId,
				fixture.request.providerId,
			);
			assert(fixture.request.entitySchemaPluginId);
			yield* session.transaction(
				references.registerInTransaction({
					userId,
					executionId,
					scriptId: search.id,
					contentHash: search.contentHash,
					pluginId: fixture.request.entitySchemaPluginId,
				}),
			);
			const registrations = yield* references.listReferences();
			const exit = yield* Effect.exit((yield* EntityPopulationTrigger).request(fixture.request));
			expect(Exit.isFailure(exit)).toBe(true);
			expect(yield* (yield* EnrichmentRequests).get(executionId)).toBeNull();
			expect(yield* references.listReferences()).toEqual(registrations);
			expect(yield* fixture.admissionTransactions).toEqual([true]);
			expect(yield* fixture.executions).toEqual([]);
		}),
	);
});

layer(triggerLayer("user", { staleRequestLookup: true }))((test) => {
	test.effect("preserves the running same-ID admission and registration after a stale lookup", () =>
		Effect.gen(function* () {
			const fixture = yield* PopulationFixture;
			const trigger = yield* EntityPopulationTrigger;
			const requests = yield* EnrichmentRequests;
			const references = yield* SandboxWorkflowReferenceRepository;
			expect(yield* trigger.request(fixture.request)).toBe(true);
			const [original] = yield* fixture.executions;
			assert(original);
			yield* requests.update(original.executionId, { state: "running" });
			const registrations = yield* references.listReferences();
			expect(registrations.map(({ executionId }) => executionId)).toEqual([original.executionId]);
			const payload = yield* Schema.decodeUnknownEffect(ProviderEntityPopulationPayload)(
				original.payload,
			);
			const pin = payload.command.writeContext?.pluginRevision;
			assert(pin);
			const updated = yield* installRevisionPackage(
				revisionPackage("population-trigger", "two", "record", pin.packageId),
				userId,
			);
			expect(updated.revisionId).not.toBe(pin.revisionId);
			expect(
				yield* trigger.request({
					...fixture.request,
					command: { ...fixture.request.command, occurredAt: "2026-09-17T00:00:00.000Z" },
				}),
			).toBe(true);
			expect(yield* fixture.executions).toEqual([original, original]);
			expect(yield* references.listReferences()).toEqual(registrations);
			expect(yield* fixture.admissionTransactions).toEqual([true, true]);
			expect(yield* fixture.dispatchTransactions).toEqual([false, false]);
		}),
	);
});

for (const state of ["succeeded", "failed", "cancelled"] as const) {
	layer(triggerLayer("user", { staleRequestLookup: true }))((test) => {
		test.effect(
			`does not retain a new same-ID registration for a ${state} admission after a stale lookup`,
			() =>
				Effect.gen(function* () {
					const fixture = yield* PopulationFixture;
					const trigger = yield* EntityPopulationTrigger;
					const references = yield* SandboxWorkflowReferenceRepository;
					expect(yield* trigger.request(fixture.request)).toBe(true);
					const [original] = yield* fixture.executions;
					assert(original);
					yield* (yield* EnrichmentRequests).update(original.executionId, { state });
					yield* references.release(original.executionId);
					expect(yield* trigger.request(fixture.request)).toBe(false);
					expect(yield* references.listReferences()).toEqual([]);
					expect(yield* fixture.executions).toEqual([original]);
					expect(yield* fixture.admissionTransactions).toEqual([true, true]);
				}),
		);
	});
}

layer(triggerLayer("system"))((test) => {
	test.effect("keeps a user-triggered system provider graph shared", () =>
		Effect.gen(function* () {
			const fixture = yield* PopulationFixture;
			yield* (yield* EntityPopulationTrigger).request(fixture.request);
			const [execution] = yield* fixture.executions;
			expect(execution?.payload).toMatchObject({
				level: "full",
				mode: "ensure",
				entityScope: { userId, type: "global" },
				pluginId: fixture.request.entitySchemaPluginId,
				command: {
					writeContext: {
						pluginRevision: { scope: "system", id: fixture.request.entitySchemaPluginId },
					},
				},
			});
		}),
	);
});

layer(triggerLayer("system", { globalEntity: true }))((test) => {
	test.effect("populates a global entity as the interested user", () =>
		Effect.gen(function* () {
			const fixture = yield* PopulationFixture;
			yield* (yield* EntityPopulationTrigger).request(fixture.request);
			const [execution] = yield* fixture.executions;
			expect(execution?.payload).toMatchObject({
				entityScope: { userId: null, type: "global" },
				command: {
					writeContext: {
						pluginRevision: { scope: "system", id: fixture.request.entitySchemaPluginId },
					},
				},
			});
		}),
	);
});

layer(triggerLayer("user"))((test) => {
	test.effect("retains the execution user and exact owner for a private provider graph", () =>
		Effect.gen(function* () {
			const fixture = yield* PopulationFixture;
			yield* (yield* EntityPopulationTrigger).request(fixture.request);
			const [execution] = yield* fixture.executions;
			expect(execution?.payload).toMatchObject({
				entityScope: { userId, type: "user" },
				pluginId: fixture.request.entitySchemaPluginId,
				command: {
					writeContext: {
						pluginRevision: {
							scope: "user",
							ownerId: userId,
							id: fixture.request.entitySchemaPluginId,
						},
					},
				},
			});
			assert(execution);
			const session = yield* DatabaseSession;
			const [row] = yield* session.run((db) =>
				db
					.select()
					.from(tables.sandboxWorkflowReference)
					.where(eq(tables.sandboxWorkflowReference.executionId, execution.executionId)),
			);
			expect(row?.scriptId).toBeDefined();
		}),
	);
});

layer(triggerLayer("user"))((test) => {
	test.effect(
		"redispatches the persisted command and pin after a compatible revision and config update",
		() =>
			Effect.gen(function* () {
				const fixture = yield* PopulationFixture;
				const trigger = yield* EntityPopulationTrigger;
				const requests = yield* EnrichmentRequests;
				const references = yield* SandboxWorkflowReferenceRepository;
				expect(yield* trigger.request(fixture.request)).toBe(true);
				const [original] = yield* fixture.executions;
				assert(original);
				const originalRequest = yield* requests.get(original.executionId);
				assert(originalRequest);
				const payload = yield* Schema.decodeUnknownEffect(ProviderEntityPopulationPayload)(
					original.payload,
				);
				const pin = payload.command.writeContext?.pluginRevision;
				assert(pin);
				const registrations = yield* references.listReferences();
				const updated = yield* installRevisionPackage(
					revisionPackage("population-trigger", "two", "record", pin.packageId),
					userId,
				);
				expect(updated.pluginId).toBe(fixture.request.entitySchemaPluginId);
				expect(updated.revisionId).not.toBe(pin.revisionId);
				const session = yield* DatabaseSession;
				const installations = yield* PluginInstallationRepository;
				const configured = yield* session.transaction(
					installations.updateState({
						sortOrder: 0,
						isHidden: false,
						id: updated.installation.id,
						config: { token: "later-token" },
					}),
				);
				assert(configured);
				expect(configured.activeConfigRevisionId).not.toBe(pin.configRevisionId);
				expect(
					yield* trigger.request({
						...fixture.request,
						command: { ...fixture.request.command, occurredAt: "2026-09-17T00:00:00.000Z" },
					}),
				).toBe(true);
				expect(yield* fixture.executions).toEqual([original, original]);
				expect(yield* references.listReferences()).toEqual(registrations);
				const persisted = yield* requests.get(original.executionId);
				expect(persisted?.payload).toEqual(originalRequest.payload);
			}),
	);
});

for (const state of ["succeeded", "failed", "cancelled"] as const) {
	layer(triggerLayer("user"))((test) => {
		test.effect(`does not redispatch a ${state} request or allocate another registration`, () =>
			Effect.gen(function* () {
				const fixture = yield* PopulationFixture;
				const trigger = yield* EntityPopulationTrigger;
				const requests = yield* EnrichmentRequests;
				const references = yield* SandboxWorkflowReferenceRepository;
				expect(yield* trigger.request(fixture.request)).toBe(true);
				const [original] = yield* fixture.executions;
				assert(original);
				yield* requests.update(original.executionId, { state });
				yield* references.release(original.executionId);
				expect(yield* trigger.request(fixture.request)).toBe(false);
				expect(yield* fixture.executions).toEqual([original]);
				expect(yield* references.listReferences()).toEqual([]);
			}),
		);
	});
}

layer(triggerLayer("user"))((test) => {
	test.effect("releases duplicate manual retry registrations and preserves the winning retry", () =>
		Effect.gen(function* () {
			const fixture = yield* PopulationFixture;
			const trigger = yield* EntityPopulationTrigger;
			const requests = yield* EnrichmentRequests;
			const references = yield* SandboxWorkflowReferenceRepository;
			expect(yield* trigger.request(fixture.request)).toBe(true);
			const [predecessor] = yield* fixture.executions;
			assert(predecessor);
			yield* requests.update(predecessor.executionId, { state: "failed" });
			const winner = yield* userPopulationRequest({
				...fixture.request,
				initiator: userId,
				accountGeneration: { userId, token: "test-account-generation" },
				execution: { level: "full", attempt: "winner", retryOf: predecessor.executionId },
			});
			expect(yield* trigger.request(winner)).toBe(true);
			const [, winningExecution] = yield* fixture.executions;
			assert(winningExecution);
			const winningReferences = yield* references.listReferences();
			expect(
				winningReferences.some(({ executionId }) => executionId === winningExecution.executionId),
			).toBe(true);
			const loser = yield* userPopulationRequest({
				...winner,
				initiator: userId,
				execution: { ...winner.execution, attempt: "loser" },
				accountGeneration: { userId, token: "test-account-generation" },
			});
			expect(yield* trigger.request(loser)).toBe(false);
			expect(yield* fixture.executions).toEqual([predecessor, winningExecution, winningExecution]);
			expect(yield* references.listReferences()).toEqual(winningReferences);
			const losingId = entityPopulationExecutionId(
				loser.entityId,
				loser.command.accountGeneration,
				loser.execution,
			);
			expect(yield* requests.get(losingId)).toBeNull();
			yield* requests.update(winningExecution.executionId, { state: "succeeded" });
			expect(yield* trigger.request(loser)).toBe(false);
			expect(yield* fixture.executions).toEqual([predecessor, winningExecution, winningExecution]);
			expect(yield* references.listReferences()).toEqual(winningReferences);
			expect(yield* requests.get(losingId)).toBeNull();
		}),
	);
});

layer(triggerLayer("system"))((test) => {
	test.effect(
		"dispatches the requested level under the shared execution ID used by the request command",
		() =>
			Effect.gen(function* () {
				const fixture = yield* PopulationFixture;
				const trigger = yield* EntityPopulationTrigger;
				const accountGeneration = { userId, token: "test-account-generation" };
				const executions: ReadonlyArray<PopulationExecution> = [
					{ level: "base" },
					{ level: "full" },
					{ level: "full", attempt: "manual-retry", retryOf: "failed-request" },
				];
				for (const [index, execution] of executions.entries()) {
					const request = yield* userPopulationRequest({
						execution,
						accountGeneration,
						initiator: userId,
						externalId: `record-${index}`,
						userId: fixture.request.userId,
						providerId: fixture.request.providerId,
						entityId: EntityId.make(`entity-${index}`),
						entitySchemaSlug: fixture.request.entitySchemaSlug,
						entitySchemaPluginId: fixture.request.entitySchemaPluginId,
					});
					expect(yield* trigger.request(request)).toBe(true);
					const dispatched = (yield* fixture.executions)[index];
					const expectedId = entityPopulationExecutionId(
						EntityId.make(`entity-${index}`),
						accountGeneration,
						execution,
					);
					expect(dispatched?.executionId).toBe(expectedId);
					expect(dispatched?.payload).toMatchObject({
						level: execution.level,
						mode: execution.retryOf ? "refresh" : "ensure",
						command: { itemIdentity: expectedId, causation: { executionId: expectedId } },
					});
				}
			}),
	);
});
