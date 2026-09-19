import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { DownloadTickets } from "#lib/infrastructure/download-tickets";
import { makeWorkflowEngine } from "#lib/test-utils/effect";
import { AuthRepository } from "#modules/auth/repository";
import {
	ImportSourceCatalog,
	type RegisteredImportSource,
} from "#modules/plugins/import-source-catalog";
import { IngestionReadinessService } from "#modules/plugins/ingestion-readiness-service";
import { UploadIntentsService } from "#modules/uploads/intents/service";

import { DataImportAdmission } from "./data-admission";
import { IngestionExecution } from "./execution-service";
import {
	ingestionTestDatabase,
	ingestionTestNow,
	ingestionTestRevision,
	ingestionTestRun,
	ingestionTestScope,
} from "./ingestion.test-support";
import { ImportsRepository } from "./repository";
import type { ImportSourceState } from "./runtime/source-state";
import { ImportSourceStateStore } from "./runtime/source-state-store";
import { ImportRunError } from "./runtime/workflow-errors";
import { ImportsService } from "./service";
import { ImportWorkflowPinning } from "./workflow-pinning";

const user: CurrentUserValue = {
	image: null,
	name: "User",
	email: "user@example.test",
	id: ingestionTestScope.userId,
	accountGeneration: ingestionTestScope.accountGeneration,
	preferences: { language: null, disableIntegrations: false },
};
const source: RegisteredImportSource = {
	slug: "fixture",
	name: "Fixture",
	pluginId: "plugin-1",
	pluginSlug: "fixture",
	pluginScope: "system",
	description: "Fixture",
	workflowSlug: "fixture",
	configSchema: { fields: {} },
	requiredPluginConfigKeys: [],
	configuredPluginConfigKeys: [],
	installationId: "installation-1",
	readinessMetadata: { scripts: [], workflows: [], oauthProviders: [], availableConfigKeys: [] },
	configContext: {
		kind: "revision",
		ownerUserId: null,
		configSchema: { fields: {} },
		pluginRevisionId: "revision-1",
		pluginConfigRevisionId: "config-1",
	},
	inputSchema: {
		unknownKeys: "strict",
		fields: {
			apiKey: {
				label: "Key",
				secret: true,
				type: "string",
				description: "Key",
				validation: { required: true },
			},
		},
	},
};
const script = {
	name: "Fixture",
	slug: "fixture",
	providerId: null,
	source: "source",
	compiledFormat: 1,
	contentHash: "hash",
	pluginId: "plugin-1",
	compiledCode: "compiled",
	pluginRevisionId: "revision-1",
	id: SandboxScriptId.make("script-1"),
	createdAt: new Date(ingestionTestNow),
	updatedAt: new Date(ingestionTestNow),
	metadata: { kind: "workflow" as const },
};
const serviceCase = (
	mode: "success" | "dispatch-failed" | "store-failed" | "pin-failed" | "not-ready",
) =>
	Effect.gen(function* () {
		const events: string[] = [];
		const dispatched: unknown[] = [];
		const states: ImportSourceState[] = [];
		const summaries: unknown[] = [];
		const listed = {
			startedAt: null,
			finishedAt: null,
			inputSummary: {},
			source: "fixture",
			failureReason: null,
			status: "pending" as const,
			createdAt: ingestionTestNow,
			updatedAt: ingestionTestNow,
			id: ingestionTestScope.runId,
		};
		const dependencies = Layer.mergeAll(
			ingestionTestDatabase(),
			Layer.mock(AuthRepository)({}),
			Layer.mock(DownloadTickets)({}),
			Layer.mock(UploadIntentsService)({}),
			Layer.mock(DataImportAdmission)({}),
			Layer.mock(ImportsRepository)({
				getIngestionRun: () =>
					Effect.succeed(ingestionTestRun({ plan: null, pins: null, status: "pending" })),
				createManualRun: (input) =>
					Effect.sync(() => {
						events.push("create");
						summaries.push(input.inputSummary);
						return listed;
					}),
				pinIngestion: (input) =>
					Effect.sync(() => {
						events.push("pin-plan");
						expect(input.pins.executionId).toBe("run-1-import");
						return true;
					}),
			}),
			Layer.mock(ImportSourceCatalog)({ resolveForUser: () => Effect.succeed({ source, script }) }),
			Layer.mock(IngestionReadinessService)({
				evaluateImport: () =>
					Effect.succeed({
						source,
						script,
						pins: {
							scriptId: script.id,
							pluginRevisionId: "revision-1",
							pluginConfigRevisionId: "config-1",
						},
						readiness: {
							ready: mode !== "not-ready",
							plan: { operation: "fixture", selection: { parser: "file" } },
							blockReasons:
								mode === "not-ready" ? [{ key: "endpoint", code: "configuration-required" }] : [],
						},
					}),
			}),
			Layer.mock(ImportSourceStateStore)({
				store: (input) =>
					Effect.sync(() => {
						events.push("store");
						states.push(input.state);
					}).pipe(
						Effect.andThen(
							mode === "store-failed"
								? Effect.fail(new ImportRunError({ message: "storage unavailable" }))
								: Effect.void,
						),
					),
			}),
			Layer.mock(ImportWorkflowPinning)({
				preRegister: () =>
					Effect.sync(() => events.push("register")).pipe(
						Effect.andThen(
							mode === "pin-failed"
								? Effect.fail(
										new SandboxRunError({ kind: "script-failure", message: "pin changed" }),
									)
								: Effect.succeed({
										pluginRevision: ingestionTestRevision,
										registrationStatus: "registered" as const,
									}),
						),
					),
			}),
			Layer.mock(IngestionExecution)({
				abortAdmission: () =>
					Effect.sync(() => {
						events.push("abort");
						return true;
					}),
			}),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({
					execute: (_workflow, options) =>
						Effect.sync(() => {
							events.push("dispatch");
							dispatched.push(options);
						}).pipe(
							Effect.andThen(
								mode === "dispatch-failed" ? Effect.fail("dispatch unavailable") : Effect.void,
							),
						),
				}),
			),
		);
		const exit = yield* Effect.flatMap(ImportsService, (service) =>
			service.startImportRun(user, { apiKey: "secret", source: "fixture" }),
		).pipe(
			Effect.exit,
			Effect.provideContext(
				yield* Layer.build(ImportsService.layer.pipe(Layer.provide(dependencies))),
			),
		);
		return { exit, events, states, summaries, dispatched };
	});
it.effect(
	"stores admitted credentials before pinning the plan and dispatching opaque root input",
	() =>
		Effect.gen(function* () {
			const result = yield* serviceCase("success");
			expect(result.exit._tag).toBe("Success");
			expect(result.events).toEqual(["create", "register", "store", "pin-plan", "dispatch"]);
			expect(result.states[0]?.sourcePayload).toEqual({ apiKey: "secret" });
			expect(result.summaries).toEqual([{ source: "fixture" }]);
			expect(result.dispatched[0]).not.toHaveProperty("payload.sourcePayload");
			expect(result.dispatched[0]).not.toHaveProperty("payload.apiKey");
		}),
);
it.effect("keeps durable admitted input and pins when dispatch must be retried", () =>
	Effect.gen(function* () {
		const result = yield* serviceCase("dispatch-failed");
		expect(result.exit._tag).toBe("Success");
		expect(result.events).toEqual(["create", "register", "store", "pin-plan", "dispatch"]);
	}),
);
it.effect("rolls back incomplete admission when pinning or durable storage fails", () =>
	Effect.gen(function* () {
		for (const mode of ["pin-failed", "store-failed"] as const) {
			const result = yield* serviceCase(mode);
			expect(result.exit._tag).toBe("Failure");
			expect(result.events.at(-1)).toBe("abort");
			expect(result.dispatched).toEqual([]);
		}
	}),
);
it.effect("rejects missing readiness before creating an import", () =>
	Effect.gen(function* () {
		const result = yield* serviceCase("not-ready");
		expect(result.exit._tag).toBe("Failure");
		expect(result.events).toEqual([]);
	}),
);
