import { describe, expect } from "bun:test";

import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntitySchemaSlug,
	PluginId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { asc, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { DefinitionRepository } from "#modules/definitions/repository";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { ClientArtifactsRepository } from "#modules/pages/bundles/repository";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { PluginConfigEncryptionKey } from "#modules/plugins/configuration/encryption-key";
import { PluginConfigRevisions } from "#modules/plugins/configuration/revisions";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { ScriptExecutionServiceLive } from "#modules/scripts/layer";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue } from "#platform/jobs/queue";
import { TransientValues } from "#platform/transient-values";
import { job } from "#schema/tables/jobs";
import { makeAppConfigLayer, makeWorkflowEngine } from "#testing/effect";

import { PROVIDER_IMPORT_USER_BACKLOG_LIMIT, ProviderImportAdmission } from "./admission";
import { admissionDatabaseLayer, alice, bob } from "./admission.test-support";
import { EntityImportJob } from "./entity-import-job";

const catalogueDependencies = Layer.mergeAll(
	ClientArtifactsRepository.layer,
	DefinitionRepository.layer,
	PluginConfigEncryptionKey.layer,
	PluginConfigRevisions.layer,
	PluginInstallationRepository.layer,
);
const pluginsLayer = PluginRepository.layer.pipe(Layer.provide(catalogueDependencies));
const catalogueLayer = Layer.mergeAll(
	catalogueDependencies,
	pluginsLayer,
	PluginRuntimeResolver.layer.pipe(Layer.provide(Layer.merge(catalogueDependencies, pluginsLayer))),
).pipe(Layer.provideMerge(admissionDatabaseLayer));

class AdmissionProviders extends Context.Service<
	AdmissionProviders,
	ReadonlyMap<
		UserId,
		NonNullable<
			Effect.Success<ReturnType<PluginRuntimeResolver["Service"]["findProviderAvailableToUser"]>>
		>
	>
>()("@ryot-app/kernel-backend/modules/entities/providers/admission.test/AdmissionProviders") {}
const fixturesLayer = Layer.effect(
	AdmissionProviders,
	Effect.gen(function* () {
		const runtime = yield* PluginRuntimeResolver;
		const source = revisionPackage("admission", "v1", "item");
		const entries = yield* Effect.forEach([alice, bob], (userId) =>
			Effect.gen(function* () {
				const installed = yield* installRevisionPackage(source, userId);
				const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
					slug: "admission-provider",
					owner: definitionOwner(installed.pluginId),
				});
				assert(provider);
				return [userId, provider] as const;
			}),
		);
		return new Map(entries);
	}),
).pipe(Layer.provideMerge(catalogueLayer));

const admissionLayer = ProviderImportAdmission.layer.pipe(
	Layer.provide(
		Layer.mergeAll(
			ScriptExecutionServiceLive,
			DomainWriteChecksLive,
			JobQueue.layer,
			TransientValues.layer,
		),
	),
	Layer.provide(makeAppConfigLayer()),
	Layer.provideMerge(Layer.succeed(WorkflowEngine, makeWorkflowEngine())),
	Layer.provideMerge(fixturesLayer),
);

const submit = (executionId: string, userId: UserId, externalId: string = executionId) =>
	Effect.gen(function* () {
		const admission = yield* ProviderImportAdmission;
		const provider = (yield* AdmissionProviders).get(userId);
		assert(provider);
		return yield* admission.submit({
			userId,
			payload: {
				executionId,
				externalId,
				providerId: provider.id,
				entityScope: { userId, type: "user" },
				pluginId: PluginId.make(provider.pluginId),
				entitySchemaSlug: EntitySchemaSlug.make("item"),
				command: {
					...rootLifecycleCommand({
						source: "api",
						lane: "interactive",
						accountUserId: userId,
						itemIdentity: executionId,
						initiator: { id: userId, kind: "user" },
						executionId: AutomationExecutionId.make(executionId),
						occurredAt: IsoUtcString.make("2026-01-01T00:00:00.000Z"),
					}),
					writeContext: null,
				},
			},
		});
	});

const importJobs = Effect.flatMap(DatabaseSession, (session) =>
	session.run((db) =>
		db
			.select({ id: job.id, priority: job.priority, status: job.status })
			.from(job)
			.where(eq(job.kind, EntityImportJob.name))
			.orderBy(asc(job.priority), asc(job.id)),
	),
);

describe("provider import admission", () => {
	layer(admissionLayer)((test) => {
		test.effect(
			"queues each user's imports behind their own and level with another user's first",
			() =>
				Effect.gen(function* () {
					expect(yield* submit("a1", alice)).toEqual({ id: "a1", status: "queued" });
					expect(yield* submit("a2", alice)).toEqual({ id: "a2", status: "queued" });
					expect(yield* submit("b1", bob)).toEqual({ id: "b1", status: "queued" });

					expect(yield* importJobs).toEqual([
						{ id: "a1", priority: 0, status: "queued" },
						{ id: "b1", priority: 0, status: "queued" },
						{ id: "a2", priority: 1, status: "queued" },
					]);
				}),
			testTimeout,
		);
	});

	layer(admissionLayer)((test) => {
		test.effect(
			"answers a repeated request with the import already queued or running",
			() =>
				Effect.gen(function* () {
					yield* submit("first", alice, "same-external");
					expect(yield* submit("repeat", alice, "same-external")).toEqual({
						id: "first",
						status: "duplicate",
					});

					const session = yield* DatabaseSession;
					yield* session.run((db) =>
						db.update(job).set({ status: "running" }).where(eq(job.id, "first")),
					);
					expect(yield* submit("again", alice, "same-external")).toEqual({
						id: "first",
						status: "duplicate",
					});
					expect((yield* importJobs).map(({ id }) => id)).toEqual(["first"]);
				}),
			testTimeout,
		);
	});

	layer(admissionLayer)((test) => {
		test.effect(
			"refuses a user's import past the backlog limit without touching another user",
			() =>
				Effect.gen(function* () {
					yield* Effect.forEach(
						Array.from({ length: PROVIDER_IMPORT_USER_BACKLOG_LIMIT }, (_, index) => `a${index}`),
						(id) => submit(id, alice),
						{ discard: true },
					);

					expect(yield* submit("over", alice)).toEqual({ status: "backlog-full" });
					expect(yield* submit("b1", bob)).toEqual({ id: "b1", status: "queued" });
				}),
			testTimeout,
		);
	});

	layer(admissionLayer)((test) => {
		test.effect(
			"removes only the owner's import on cancel",
			() =>
				Effect.gen(function* () {
					const admission = yield* ProviderImportAdmission;
					yield* submit("a1", alice);
					yield* submit("a2", alice);

					yield* admission.cancel({ id: "a1", userId: bob });
					expect((yield* importJobs).map(({ id }) => id)).toEqual(["a1", "a2"]);

					yield* admission.cancel({ id: "a1", userId: alice });
					expect((yield* importJobs).map(({ id }) => id)).toEqual(["a2"]);
				}),
			testTimeout,
		);
	});
});
