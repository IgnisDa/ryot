import { expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import {
	PluginConflictError,
	PluginInvocationError,
	PluginOperationRejected,
} from "@ryot-app/contract/modules/plugins/schemas";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { entitlementRequired } from "@ryot-app/contract/schema/entitlement";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { fixtureManifest } from "@ryot-app/contract/testing";
import { KERNEL_NAMESPACE } from "@ryot-app/i18n/message";
import { assert } from "@ryot-app/testing/assert";
import { layer } from "@voila.dev/effect-bun-test";
import { count } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { Headers } from "effect/http";

import { AuthService } from "#modules/accounts/auth/service";
import { IntegrationOperationScopeResolverLive } from "#modules/integrations/operation-scope-resolver-live";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { ScriptCalls } from "#modules/scripts/executions/calls";
import {
	realSandboxLayer,
	RealSandboxScripts,
	realSandboxUserId,
} from "#modules/scripts/executions/real-sandbox.test-support";
import { UserCommands } from "#modules/user-commands/service";
import { DatabaseSession } from "#platform/db/session";
import { entitlementsLayer } from "#platform/entitlements.test-support";
import { sandboxWorkflowReference } from "#schema/tables/core";
import { sandboxJournalEntry } from "#schema/tables/sandbox-journal";
import { workflowExecution } from "#schema/tables/workflow-executions";

import { PluginRuntimeResolver } from "../catalog/runtime-resolver";
import { PluginRepository } from "../packages/repository";
import { OperationsService } from "./service";

const epoch = new Date(0);
const OPERATION_SLUG = "operation.rejecting";
const packageId = PluginPackageId.make("test/fixture");

const operationSource = `
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { EntitlementRequiredError } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
  defineOperation,
  OperationConflictError,
  OperationRejectedError,
} from "@ryot-app/plugin-backend-sdk/operation";

export const manifest = defineManifest({
  kind: "operation",
  name: "Rejecting operation",
  slug: "${OPERATION_SLUG}",
});

export default defineOperation({
  manifest,
  input: Schema.Struct({ mode: Schema.Literals(["read", "reject", "conflict", "entitlement", "crash"]) }),
  output: Schema.String,
  run: (input) =>
    input.mode === "read"
      ? Effect.succeed({ output: "read" })
      : input.mode === "reject"
      ? Effect.fail(
          new OperationRejectedError({
            reason: { key: "episode.parent-required", params: { parent: { key: "episode.parent" } } },
          }),
        )
      : input.mode === "conflict"
      ? Effect.fail(new OperationConflictError({ conflict: "entity-stale" }))
      : input.mode === "entitlement"
        ? Effect.fail(new EntitlementRequiredError({ entitlement: "pro" }))
        : Effect.fail(new Error("Unexpected failure")),
});
`;

const fakeLayer = Layer.unwrap(
	Effect.gen(function* () {
		const scripts = yield* RealSandboxScripts;
		const installed = yield* scripts.install(operationSource);
		const resolved = {
			operation: {
				slug: OPERATION_SLUG,
				auth: "user" as const,
				input: { type: "object" },
				output: { type: "string" },
				title: "Fixture operation",
				demoAccess: "allowed" as const,
				description: "Rejecting operation",
				scriptSlug: installed.compiled.manifest.slug,
				hints: { readOnly: true, idempotent: true, destructive: false },
			},
			script: {
				providerId: null,
				createdAt: epoch,
				compiledFormat: 1,
				id: installed.scriptId,
				contentHash: installed.contentHash,
				metadata: installed.compiled.manifest,
				pluginId: installed.pluginRevision.id,
				name: installed.compiled.manifest.name,
				slug: installed.compiled.manifest.slug,
				compiledCode: installed.compiled.javascript,
				pluginRevisionId: installed.pluginRevision.revisionId,
			},
			plugin: {
				packageId,
				isHidden: false,
				clientImports: [],
				healthReason: null,
				scope: "user" as const,
				health: "ready" as const,
				contentHash: "source-hash",
				incompatibilityReason: null,
				ownerUserId: realSandboxUserId,
				id: installed.pluginRevision.id,
				manifest: fixtureManifest(packageId),
				installationId: "install-sandbox-user",
				pluginRevisionId: installed.pluginRevision.revisionId,
				pluginConfigRevisionId: installed.pluginRevision.configRevisionId,
				compiledHashes: { [installed.compiled.manifest.slug]: installed.contentHash },
			},
		};
		return Layer.mergeAll(
			Layer.mock(IntegrationsRepository)({}),
			Layer.mock(PluginRepository)({
				lockIngestionShared: () => Effect.void,
				isActiveRevision: () => Effect.succeed(true),
			}),
			Layer.mock(AuthService)({
				handler: () => Promise.reject(new Error("unused")),
				resolveRequestCredential: () =>
					Effect.succeed({
						authorization: {
							userId: realSandboxUserId,
							accessClass: "standard" as const,
							writeAccess: "unattended" as const,
							credential: { keyId: "test-key", kind: "api-key" as const },
						},
						user: {
							image: null,
							name: "User",
							id: realSandboxUserId,
							email: "user@example.com",
							accountUserId: realSandboxUserId,
							preferences: {
								weekStart: null,
								interfaceLocale: null,
								contentLanguage: null,
								reportingTimeZone: UTC,
								ratingScale: "hundred",
								disableIntegrations: false,
							},
						},
					}),
			}),
			Layer.mock(PluginRuntimeResolver)({
				findOperationAvailableToUser: () => Effect.succeed(resolved),
				resolveUserPackage: () =>
					Effect.succeed({ kind: "effective" as const, pluginId: installed.pluginRevision.id }),
			}),
		);
	}),
);

const invoke = (mode: "read" | "crash" | "reject" | "conflict" | "entitlement") =>
	Effect.flatMap(OperationsService, (service) =>
		service.invoke({
			packageId,
			payload: { mode },
			headers: Headers.empty,
			operationSlug: OPERATION_SLUG,
		}),
	);

layer(
	Layer.provideMerge(
		OperationsService.layer.pipe(
			Layer.provide(IntegrationOperationScopeResolverLive),
			Layer.provide(Layer.mock(UserCommands)({})),
			Layer.provideMerge(ScriptCalls.layer),
			Layer.provide(entitlementsLayer(["pro"])),
			Layer.provideMerge(fakeLayer.pipe(Layer.provideMerge(realSandboxLayer()))),
		),
		BunCrypto.layerSecureRandom,
	),
	{ excludeTestServices: true },
)((test) => {
	test.effect(
		"runs an operation on the plain host and commits nothing",
		() =>
			Effect.gen(function* () {
				expect(yield* invoke("read")).toEqual({ output: "read", committed: { events: [] } });
				const session = yield* DatabaseSession;
				const rows = yield* Effect.forEach(
					[workflowExecution, sandboxJournalEntry, sandboxWorkflowReference],
					(table) => session.run((db) => db.select({ rows: count() }).from(table)),
				).pipe(Effect.orDie);
				expect(rows).toEqual([[{ rows: 0 }], [{ rows: 0 }], [{ rows: 0 }]]);
			}),
		30_000,
	);

	test.effect(
		"maps an operation rejection thrown inside the sandbox to a 422 error with the plugin-stamped reason",
		() =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(invoke("reject"));
				expect(error).toBeInstanceOf(PluginOperationRejected);
				assert(error instanceof PluginOperationRejected);
				const { namespace } = error.reason;
				expect(namespace).not.toBe(KERNEL_NAMESPACE);
				expect(error.reason).toEqual({
					namespace,
					key: "episode.parent-required",
					params: { parent: { namespace, key: "episode.parent" } },
				});
			}),
		30_000,
	);

	test.effect(
		"maps an operation conflict thrown inside the sandbox to a 409 changes conflict",
		() =>
			Effect.gen(function* () {
				expect(yield* Effect.flip(invoke("conflict"))).toEqual(
					new PluginConflictError({
						reason: { code: "changes-conflict", conflict: "entity-stale" },
					}),
				);
			}),
		30_000,
	);

	test.effect(
		"maps an entitlement failure raised inside the sandbox to EntitlementRequired",
		() =>
			Effect.gen(function* () {
				expect(yield* Effect.flip(invoke("entitlement"))).toEqual(entitlementRequired("pro"));
			}),
		30_000,
	);

	test.effect(
		"keeps a plain runtime failure inside the sandbox as a 502 runtime-failed error",
		() =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(invoke("crash"));
				expect(error).toBeInstanceOf(PluginInvocationError);
				expect(error).toMatchObject({ reason: { code: "runtime-failed" } });
			}),
		30_000,
	);
});
