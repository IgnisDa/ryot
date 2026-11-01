import { assert, expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntitySchemaSlug,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Effect, Layer, Result, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { makeWorkflowActivityEngine } from "#testing/effect";

import { EntityImportWorkflow } from "./entity-import-workflow";
import { makeProviderExecutionReads } from "./execution-reads";
import {
	EntityImportWorkflowOperations,
	EntityImportWorkflowOperationsLive,
} from "./operations-workflow";
import type { EntityImportPayload } from "./schemas";

const userId = UserId.make("owner");
const accountGeneration = { userId, token: "test-account-generation" };

const providerPackage = (version: string, packageId?: Parameters<typeof revisionPackage>[3]) => {
	const source = revisionPackage("retained", version, undefined, packageId);
	const details = source.scripts.find(
		({ metadata }) => metadata.kind === "provider" && metadata.providerOperation === "details",
	);
	assert(details?.metadata.kind === "provider");
	const extra = (version === "v1" ? (["related", "resolve"] as const) : (["resolve"] as const)).map(
		(operation) =>
			Object.assign({}, details, {
				slug: `custom.${operation}-${version}`,
				entry: `backend/${operation}.sandbox.ts`,
				contentHash: `custom.${operation}-${version}`,
				metadata: {
					...details.metadata,
					kind: "provider" as const,
					providerOperation: operation,
					providerSlug: "retained-provider",
					slug: `custom.${operation}-${version}`,
				},
			}),
	);
	const scripts = [...source.scripts, ...extra];
	return {
		...source,
		scripts,
		manifest: {
			...source.manifest,
			scripts: scripts.map(({ entry, metadata }) => Object.assign({}, metadata, { entry })),
		},
	};
};

for (const scope of ["system", "user"] as const) {
	const recorded: Array<Parameters<ScriptExecutionService["Service"]["executeScript"]>[0]> = [];
	const operations = EntityImportWorkflowOperationsLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				DomainWriteChecksLive,
				Layer.mock(LifecyclePlanner)({}),
				Layer.mock(LifecycleExecution)({}),
				Layer.mock(ScriptExecutionService)({
					executeScript: (input) =>
						Effect.sync(() => {
							recorded.push(input);
							return { logs: [], value: {}, error: null, status: "completed" as const };
						}),
				}),
			),
		),
		Layer.provideMerge(revisionDatabaseLayer),
	);
	layer(operations)((test) => {
		test.effect(
			`dispatches retained ${scope} provider tuples after an upgrade without crossing owners`,
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const runtime = yield* PluginRuntimeResolver;
					const registry = yield* SandboxRepository;
					const source = providerPackage("v1");
					const installed = yield* installRevisionPackage(
						source,
						scope === "user" ? userId : undefined,
					);
					const foreign = yield* installRevisionPackage(
						source,
						scope === "user" ? undefined : userId,
					);
					const reference = {
						slug: "retained-provider",
						owner: definitionOwner(installed.pluginId),
					};
					const provider = yield* runtime.findProviderAvailableToUserByReference(userId, reference);
					assert(provider);
					const foreignProvider = yield* runtime.findProviderAvailableToUserByReference(userId, {
						...reference,
						owner: definitionOwner(foreign.pluginId),
					});
					assert(foreignProvider);
					const details = yield* runtime.resolveUserDetailsScript(userId, provider.id);
					const subject = { userId, accountGeneration, type: "user" as const };
					const pin = yield* registry.getScriptPin(details.id, undefined, subject);
					assert(pin?.pluginRevision);
					const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({
						...pin,
						subject,
					});
					const payload: EntityImportPayload = {
						providerId: provider.id,
						externalId: "remote-record",
						executionId: "retained-provider",
						pluginId: PluginId.make(installed.pluginId),
						entitySchemaSlug: EntitySchemaSlug.make("retained-entity"),
						entityScope: { userId, type: scope === "user" ? "user" : "global" },
						command: {
							...rootLifecycleCommand({
								accountGeneration,
								lane: "background",
								source: "provider-refresh",
								itemIdentity: "retained-provider",
								initiator: { id: userId, kind: "user" },
								occurredAt: IsoUtcString.make("2026-10-24T00:00:00.000Z"),
								executionId: AutomationExecutionId.make("retained-provider"),
								providerExecutionId: AutomationExecutionId.make("retained-provider"),
							}),
							writeContext: principal,
						},
					};
					const upgraded = yield* installRevisionPackage(
						providerPackage("v2", source.manifest.metadata.packageId),
						scope === "user" ? userId : undefined,
					);
					const activeDetails = yield* runtime.resolveUserDetailsScript(userId, provider.id);
					expect(activeDetails.pluginRevisionId).toBe(upgraded.revisionId);
					const activePin = yield* registry.getScriptPin(activeDetails.id, undefined, subject);
					assert(activePin);
					const activePrincipal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({
						...activePin,
						subject,
					});
					expect((yield* runtime.resolveUserResolveScript(userId, provider.id)).slug).toBe(
						"custom.resolve-v2",
					);
					const reads = makeProviderExecutionReads(session);
					expect(yield* reads.findPinnedProvider(reference, installed.revisionId)).toEqual({
						id: provider.id,
						rootEntitySchemaSlug: "retained-entity",
					});
					expect(yield* reads.findPinnedProvider(reference, foreign.revisionId)).toBeNull();
					expect(
						yield* reads.findRevisionProviderOperation({
							operation: "details",
							providerSlug: provider.slug,
							pluginId: installed.pluginId,
							revisionId: foreign.revisionId,
						}),
					).toBeUndefined();
					expect(
						yield* reads.findRevisionProviderOperation({
							operation: "related",
							providerSlug: provider.slug,
							pluginId: installed.pluginId,
							revisionId: upgraded.revisionId,
						}),
					).toBeUndefined();
					const instance = WorkflowInstance.initial(EntityImportWorkflow, `retained-${scope}`);
					yield* Effect.gen(function* () {
						const service = yield* EntityImportWorkflowOperations;
						yield* service.processSandbox(payload, "details", "base");
						yield* service.processRelatedPage(
							{
								...payload,
								group: { direction: "outgoing", relationshipSchemaSlug: "retained-link" },
							},
							"related",
							"next",
						);
						yield* service.processProviderResolve(
							{
								userId,
								accountGeneration,
								value: "remote-id",
								lane: "background",
								providerId: provider.id,
								writeContext: principal,
								identifierType: "native",
							},
							"resolve",
						);
						expect(recorded).toHaveLength(3);
						expect(recorded[0]?.input).toEqual({ level: "base", externalId: "remote-record" });
						for (const [index, slug] of [
							"retained.details",
							"custom.related-v1",
							"custom.resolve-v1",
						].entries()) {
							const script = yield* reads.findRevisionScript(installed.revisionId, slug);
							assert(script);
							expect(recorded[index]?.scriptId).toBe(script.id);
							expect(recorded[index]?.pluginRevision?.revisionId).toBe(installed.revisionId);
						}
						assertExitFails(
							yield* Effect.exit(
								service.requireRelatedScript({ ...payload, providerId: foreignProvider.id }),
							),
							new SandboxRunError({
								kind: "invalid-input",
								message: "Provider identity does not belong to the entity schema owner",
							}),
						);
						assertExitFails(
							yield* Effect.exit(
								service.requireRelatedScript({
									...payload,
									command: { ...payload.command, writeContext: activePrincipal },
								}),
							),
							new SandboxRunError({
								kind: "missing-artifact",
								message: "Pinned provider related script is unavailable",
							}),
						);
						expect(recorded).toHaveLength(3);
						const withdrawn = providerPackage("v3", source.manifest.metadata.packageId);
						yield* installRevisionPackage(
							{
								...withdrawn,
								scripts: withdrawn.scripts.filter(({ metadata }) => metadata.kind !== "provider"),
								manifest: {
									...withdrawn.manifest,
									providers: [],
									scripts: withdrawn.manifest.scripts.filter(({ kind }) => kind !== "provider"),
								},
							},
							scope === "user" ? userId : undefined,
						);
						const active = yield* Effect.result(
							runtime.resolveUserDetailsScript(userId, provider.id),
						);
						assert(Result.isFailure(active));
						expect(active.failure).toMatchObject({ reason: "inactive_provider" });
						yield* service.processSandbox(payload, "withdrawn-details", "base");
						expect(recorded).toHaveLength(4);
						expect(recorded[3]?.scriptId).toBe(details.id);
					}).pipe(
						Effect.provideService(WorkflowInstance, instance),
						Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
					);
				}),
		);
	});
}
