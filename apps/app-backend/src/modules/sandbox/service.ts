import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, conflict, notFound } from "@ryot/contract/errors";
import type {
	CreateSandboxScriptBody,
	EnqueueSandboxBody,
	SandboxScriptManifest,
} from "@ryot/contract/modules/sandbox/schemas";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { AUTOMATION_SANDBOX_HOST_CAPABILITIES } from "@ryot/sandbox-sdk/core";
import { generateId } from "better-auth";
import { Effect, Redacted } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { sandboxContextError } from "#lib/infrastructure/sandbox-runtime/limits";
import { createWorkflowJobId, resolveWorkflowExecutionId } from "#lib/shared/job-id";
import { trimToNull } from "#lib/shared/validation";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { SandboxCompiler } from "./compiler";
import { resolveSandboxExecutionPayload } from "./durable-queues";
import { SandboxRepository, type PatchSandboxScriptInput } from "./repository";
import { RunSandboxWorkflow } from "./sandbox-run-workflow";
import { toSandboxRunResult } from "./sandbox-workflow-live";

const sandboxJobNotFoundError = "Sandbox job not found";
const sandboxScriptNotFoundError = "Sandbox script not found";
const restrictedPublicCapabilities = new Set<string>(AUTOMATION_SANDBOX_HOST_CAPABILITIES);

export class SandboxApiService extends Effect.Service<SandboxApiService>()("SandboxApiService", {
	effect: Effect.gen(function* () {
		const config = yield* AppConfig;
		const runWithDb = yield* DbRunner;
		const engine = yield* WorkflowEngine;
		const compiler = yield* SandboxCompiler;
		const repository = yield* SandboxRepository;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const jobIdSecret = Redacted.value(config.sandbox.jobIdSecret);

		const createScript = Effect.fn("SandboxApiService.createScript")(function* (
			user: CurrentUserValue,
			payload: CreateSandboxScriptBody,
		) {
			const compiled = yield* compiler.compile(payload.source);
			if (
				compiled.manifest.capabilities.some((capability) =>
					restrictedPublicCapabilities.has(capability),
				)
			) {
				return yield* badRequest(
					"Public sandbox scripts cannot request automation host capabilities",
				);
			}
			const manifestBase = {
				name: compiled.manifest.name,
				slug: compiled.manifest.slug,
				capabilities: [...compiled.manifest.capabilities],
				requiredAppConfigKeys: [...compiled.manifest.requiredAppConfigKeys],
			};
			let manifest: SandboxScriptManifest;
			if (compiled.manifest.kind === "provider") {
				manifest = {
					...manifestBase,
					kind: compiled.manifest.kind,
					providerInformation: { ...compiled.manifest.providerInformation },
				};
			} else {
				manifest = { ...manifestBase, kind: compiled.manifest.kind };
			}

			const existing = yield* runWithDb(
				repository.findScriptBySlugForUser({ userId: user.id, slug: manifest.slug }),
			);
			if (existing) {
				return yield* conflict("A sandbox script with this slug already exists");
			}

			return yield* runWithDb(
				repository.createScript({
					manifest,
					userId: user.id,
					slug: manifest.slug,
					name: manifest.name,
					source: payload.source,
					compiledFormat: compiled.format,
					compiledCode: compiled.javascript,
				}),
			);
		});

		const enqueue = Effect.fn("SandboxApiService.enqueue")(function* (
			user: CurrentUserValue,
			payload: EnqueueSandboxBody,
		) {
			const scriptId = trimToNull(payload.scriptId);
			const driverName = trimToNull(payload.driverName);
			if (!scriptId || !driverName) {
				return yield* notFound(sandboxScriptNotFoundError);
			}
			const context = payload.context ?? {};
			const contextError = sandboxContextError(context);
			if (contextError) {
				return yield* badRequest(contextError);
			}

			const script = yield* runWithDb(
				repository.getScriptForUser({
					userId: user.id,
					scriptId: SandboxScriptId.make(scriptId),
				}),
			);
			if (!script) {
				return yield* notFound(sandboxScriptNotFoundError);
			}
			const executionId = generateId();
			const resolvedPayload = yield* resolveSandboxExecutionPayload({
				context,
				driverName,
				executionId,
				userId: user.id,
				scriptId: script.id,
			}).pipe(
				Effect.provideService(DbRunner, runWithDb),
				Effect.provideService(SandboxRepository, repository),
				Effect.provideService(PluginRuntimeResolver, pluginRuntime),
				Effect.catchTag("SandboxRunError", () => notFound(sandboxScriptNotFoundError)),
			);
			yield* engine
				.execute(RunSandboxWorkflow, {
					executionId,
					discard: true,
					payload: resolvedPayload,
				})
				.pipe(Effect.orDie);

			return { jobId: createWorkflowJobId(jobIdSecret, executionId, user.id) };
		});

		const getResult = Effect.fn("SandboxApiService.getResult")(function* (
			user: CurrentUserValue,
			jobId: string,
		) {
			const resolvedJobId = trimToNull(jobId);
			if (!resolvedJobId) {
				return yield* notFound(sandboxJobNotFoundError);
			}

			const executionId = resolveWorkflowExecutionId(jobIdSecret, user.id, resolvedJobId);
			if (!executionId) {
				return yield* notFound(sandboxJobNotFoundError);
			}

			return toSandboxRunResult(yield* engine.poll(RunSandboxWorkflow, executionId));
		});

		const getStoredScript = Effect.fn("SandboxApiService.getStoredScript")(function* (
			scriptId: SandboxScriptId,
		) {
			const script = yield* runWithDb(repository.getScriptById(scriptId));
			if (!script) {
				return yield* notFound(sandboxScriptNotFoundError);
			}
			return script;
		});

		const listStoredScripts = Effect.fn("SandboxApiService.listStoredScripts")(function* (
			userId: Parameters<typeof repository.listScripts>[0],
		) {
			return yield* runWithDb(repository.listScripts(userId));
		});

		const patchStoredScript = Effect.fn("SandboxApiService.patchStoredScript")(function* (
			input: PatchSandboxScriptInput,
		) {
			const script = yield* runWithDb(repository.patchScript(input));
			if (!script) {
				return yield* notFound(sandboxScriptNotFoundError);
			}
			return script;
		});

		const promoteStoredScript = Effect.fn("SandboxApiService.promoteStoredScript")(function* (
			scriptId: SandboxScriptId,
		) {
			const script = yield* runWithDb(repository.promoteScript(scriptId));
			if (!script) {
				return yield* notFound(sandboxScriptNotFoundError);
			}
			return script;
		});

		const deleteStoredScript = Effect.fn("SandboxApiService.deleteStoredScript")(function* (
			scriptId: SandboxScriptId,
		) {
			return yield* runWithDb(repository.deleteScript(scriptId));
		});

		return {
			enqueue,
			getResult,
			createScript,
			getStoredScript,
			listStoredScripts,
			patchStoredScript,
			deleteStoredScript,
			promoteStoredScript,
		};
	}),
}) {}
