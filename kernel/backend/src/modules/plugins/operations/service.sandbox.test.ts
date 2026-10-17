import { expect, layer } from "@effect/vitest";
import {
	PluginInvocationError,
	PluginOperationRejected,
} from "@ryot-app/contract/modules/plugins/schemas";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { Headers } from "effect/http";

import { AuthService } from "#modules/accounts/auth/service";
import { IntegrationOperationScopeResolverLive } from "#modules/integrations/operation-scope-resolver-live";
import { IntegrationsRepository } from "#modules/integrations/repository";
import {
	realSandboxLayer,
	RealSandboxScripts,
	realSandboxUserId,
} from "#modules/scripts/executions/real-sandbox.test-support";

import { PluginRuntimeResolver } from "../catalog/runtime-resolver";
import { PluginRepository } from "../packages/repository";
import { fixtureManifest } from "../test-support";
import { OperationsService } from "./service";

const epoch = new Date(0);
const OPERATION_SLUG = "operation.rejecting";
const packageId = PluginPackageId.make("test/fixture");

const operationSource = `
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation, OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";

export const manifest = defineManifest({
  kind: "operation",
  name: "Rejecting operation",
  slug: "${OPERATION_SLUG}",
});

export default defineOperation({
  manifest,
  input: Schema.Struct({ mode: Schema.Literals(["reject", "crash"]) }),
  output: Schema.String,
  run: (input) =>
    input.mode === "reject"
      ? Effect.fail(new OperationRejectedError("Every episode must belong to the selected parent"))
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
				demoAccess: "allowed" as const,
				description: "Rejecting operation",
				scriptSlug: installed.compiled.manifest.slug,
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
				compiledHashes: installed.pluginRevision.compiledHashes,
				pluginConfigRevisionId: installed.pluginRevision.configRevisionId,
			},
		};
		return Layer.mergeAll(
			Layer.mock(IntegrationsRepository)({}),
			Layer.mock(PluginRepository)({
				lockIngestionShared: () => Effect.void,
				isActiveRevision: () => Effect.succeed(true),
			}),
			Layer.mock(AuthService)({
				handler: () => Effect.die("unused").pipe(Effect.runPromise),
				resolveRequestCredential: () =>
					Effect.succeed({
						authorization: {
							userId: realSandboxUserId,
							accessClass: "standard" as const,
							credential: { keyId: "test-key", kind: "api-key" as const },
						},
						user: {
							image: null,
							name: "User",
							id: realSandboxUserId,
							email: "user@example.com",
							preferences: { language: null, disableIntegrations: false },
							accountGeneration: { userId: realSandboxUserId, token: "test-account-generation" },
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

const invoke = (mode: "reject" | "crash") =>
	Effect.flatMap(OperationsService, (service) =>
		service.invoke({
			packageId,
			payload: { mode },
			headers: Headers.empty,
			operationSlug: OPERATION_SLUG,
		}),
	);

layer(
	OperationsService.layer.pipe(
		Layer.provide(IntegrationOperationScopeResolverLive),
		Layer.provideMerge(fakeLayer.pipe(Layer.provideMerge(realSandboxLayer()))),
	),
	{ excludeTestServices: true },
)((test) => {
	test.effect(
		"maps an operation rejection thrown inside the sandbox to a message-carrying 422 error",
		() =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(invoke("reject"));
				expect(error).toBeInstanceOf(PluginOperationRejected);
				expect(error).toMatchObject({
					message: "Every episode must belong to the selected parent",
				});
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
