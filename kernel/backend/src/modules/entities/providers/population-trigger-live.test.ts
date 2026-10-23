import { assert, expect, layer } from "@effect/vitest";
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
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer, makeWorkflowEngine } from "#testing/effect";

import { EntityPopulationTriggerLive } from "./population-trigger-live";

const userId = UserId.make("population-trigger-user");
type ExecuteOptions = Parameters<WorkflowEngine["Service"]["execute"]>[1];

class PopulationFixture extends Context.Service<
	PopulationFixture,
	{
		readonly request: PopulationRequest;
		readonly executions: Effect.Effect<ReadonlyArray<ExecuteOptions>>;
	}
>()("test/PopulationFixture") {}

const triggerLayer = (
	scope: "system" | "user",
	options: {
		readonly unavailable?: boolean;
		readonly globalEntity?: boolean;
		readonly systemSubject?: boolean;
		readonly enqueueFails?: boolean;
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
			const engine = makeWorkflowEngine({
				execute: (_workflow, input) =>
					Ref.update(executions, (all) => [...all, input]).pipe(
						Effect.andThen(options.enqueueFails ? Effect.die("enqueue failed") : Effect.void),
					),
			});
			return EntityPopulationTriggerLive.pipe(
				Layer.provide(Layer.merge(ScriptExecutionServiceLive, DomainWriteChecksLive)),
				Layer.provideMerge(Layer.succeed(WorkflowEngine, engine)),
				Layer.merge(Layer.succeed(PopulationFixture, { request, executions: Ref.get(executions) })),
			);
		}),
	).pipe(Layer.provideMerge(revisionDatabaseLayer), Layer.provide(makeAppConfigLayer()));

layer(triggerLayer("system", { enqueueFails: true, systemSubject: true }))((test) => {
	test.effect("keeps a deterministic system ID and exposes enqueue failure", () =>
		Effect.gen(function* () {
			const fixture = yield* PopulationFixture;
			const exit = yield* Effect.exit((yield* EntityPopulationTrigger).request(fixture.request));
			expect((yield* fixture.executions).map(({ executionId }) => executionId)).toEqual([
				"populate-entity-1-full",
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
					{ level: "full", attempt: 1_700_000_000_000 },
					{ level: "full", upgrade: { hourBucket: 472_222, populatedAtMs: 1_600_000_000_000 } },
				];
				for (const [index, execution] of executions.entries()) {
					const request = yield* userPopulationRequest({
						execution,
						accountGeneration,
						initiator: userId,
						userId: fixture.request.userId,
						externalId: fixture.request.externalId,
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
						command: { itemIdentity: expectedId, causation: { executionId: expectedId } },
					});
				}
				expect((yield* fixture.executions).map(({ executionId }) => executionId)).toEqual([
					"populate-entity-0-base-test-account-generation",
					"populate-entity-1-full-test-account-generation",
					"populate-entity-2-full-test-account-generation-1700000000000",
					"populate-entity-3-full-test-account-generation-1600000000000-472222",
				]);
			}),
	);
});
