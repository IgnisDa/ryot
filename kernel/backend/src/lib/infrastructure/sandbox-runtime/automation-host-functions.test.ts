import { expect, it } from "@effect/vitest";
import {
	AutomationOccurrenceId,
	SignalId,
	SignalSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	SubscriptionRunId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { selectSandboxHostFunctions } from "#lib/infrastructure/sandbox-runtime/service";
import type { SandboxRunInput } from "#lib/infrastructure/sandbox-runtime/shared";
import { databaseLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { NotificationsRepository } from "#modules/notifications/repository";
import { NotificationsService } from "#modules/notifications/service";
import { SignalEmissionService, type EmitSignalInput } from "#modules/signals/service";

import { makeAutomationSandboxApiFunctions } from "./automation-host-functions";

const userId = UserId.make("user-1");
const occurredAt = "2026-07-20T10:00:00.000Z";
const upsertGlobalEntities = () => Effect.void;
const runId = SubscriptionRunId.make("run-1");
const emitSignal = () => Effect.succeed(null);
const sendNotification = () => Effect.succeed(null);
const changeUserRelationships = () => Effect.succeed([]);
const ensureUserEntities = () => Effect.succeed([]);
const getUserPreferences = () => Effect.succeed(null);

const pluginRevision = (isUserBootstrap = false) => ({
	ownerId: null,
	id: "plugin-1",
	slug: "plugin",
	compiledHashes: {},
	workflowScripts: {},
	scope: "system" as const,
	userBootstrapScriptSlugs: isUserBootstrap ? ["script"] : [],
	configSchema: { fields: {}, unknownKeys: "strict" as const },
	schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
});

const runInput = {
	context: {},
	compiledCode: "",
	compiledFormat: 1,
	executionId: `${runId}-sandbox`,
	principal: {
		contentHash: "",
		providerId: null,
		pluginRevision: null,
		scriptSlug: "script",
		scriptId: SandboxScriptId.make("script-1"),
		metadata: { capabilities: ["emitSignal", "sendNotification"] },
		subject: {
			userId,
			type: "subscription",
			subscriptionRun: {
				id: runId,
				occurredAt,
				origin: { kind: "api" },
				occurrenceId: AutomationOccurrenceId.make("occurrence-1"),
			},
		},
	},
} as const satisfies SandboxRunInput;

const selectionPrincipal = (
	subject: SandboxRunInput["principal"]["subject"],
	kind: NonNullable<SandboxRunInput["principal"]["metadata"]["kind"]>,
	capabilities: readonly string[],
) => ({ ...runInput.principal, subject, metadata: { kind, capabilities: [...capabilities] } });

it.effect("derives signal subject and identity from the subscription run", () => {
	let captured: EmitSignalInput | undefined;
	const signals = Layer.mock(SignalEmissionService, {
		emit: (input) => {
			captured = input;
			return Effect.succeed({
				wasCreated: true,
				recipientUserIds: [userId],
				signal: {
					actorUserId: userId,
					origin: input.origin,
					subjectEntityId: null,
					schemaSlug: input.schemaSlug,
					id: SignalId.make("signal-1"),
					properties: { message: "trace" },
					createdAt: "2026-07-20T10:00:01.000Z",
					occurredAt: input.occurredAt.toISOString(),
					signalSchemaSlug: SignalSchemaSlug.make("signal-schema-1"),
				},
			});
		},
	});
	const notifications = Layer.mock(NotificationsService, {});

	return Effect.gen(function* () {
		const host = yield* makeAutomationSandboxApiFunctions;
		const result = yield* host.emitSignal(runInput, {
			discriminator: "part-item-1",
			schemaSlug: "review.created",
			properties: { message: "trace" },
		});

		expect(result).toEqual({ wasCreated: true, signalId: "signal-1" });
		expect(captured).toMatchObject({
			executionId: runId,
			origin: { kind: "api" },
			discriminator: "part-item-1",
			schemaSlug: "review.created",
			properties: { message: "trace" },
			principal: { userId, kind: "user" },
		});
		expect(captured?.occurredAt.toISOString()).toBe(occurredAt);
	}).pipe(Effect.provide(Layer.mergeAll(databaseLayer, signals, notifications)));
});

it.effect("uses one run-derived message delivery identity across replay", () => {
	const deliveries: Parameters<WorkflowEngine["Service"]["execute"]>[1][] = [];
	const workflowEngine = makeWorkflowEngine({
		execute: (_workflow, options) => {
			deliveries.push(options);
			return Effect.succeed(options.executionId);
		},
	});
	const signals = Layer.mock(SignalEmissionService, {});
	const notificationsRepository = Layer.succeed(
		NotificationsRepository,
		Object.assign(Object.create(null), {}),
	);
	const notifications = NotificationsService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				notificationsRepository,
				Layer.succeed(WorkflowEngine, workflowEngine),
			),
		),
	);

	return Effect.gen(function* () {
		const host = yield* makeAutomationSandboxApiFunctions;
		const runNotifier = () => host.sendNotification(runInput, "Review posted for Dune");
		expect(yield* runNotifier()).toBeNull();
		expect(yield* runNotifier()).toBeNull();
		expect(deliveries).toHaveLength(2);
		for (const delivery of deliveries) {
			expect(delivery).toMatchObject({
				discard: true,
				payload: {
					userId,
					executionId: "run-1-notification",
					request: { kind: "message", message: "Review posted for Dune" },
				},
			});
		}
	}).pipe(Effect.provide(Layer.mergeAll(signals, notifications)));
});

it.effect("returns context failures through the Effect error channel", () => {
	const signals = Layer.mock(SignalEmissionService, {});
	const notifications = Layer.mock(NotificationsService, {});

	return Effect.gen(function* () {
		const host = yield* makeAutomationSandboxApiFunctions;
		const error = yield* Effect.flip(
			host.sendNotification(
				{ ...runInput, principal: { ...runInput.principal, subject: { type: "system" } } },
				"Review posted for Dune",
			),
		);

		expect(error).toEqual({
			message: "sendNotification is available only to subscription executions",
		});
	}).pipe(Effect.provide(Layer.mergeAll(databaseLayer, signals, notifications)));
});

it("exposes automation capabilities only to trusted automation executions", () => {
	const bound = { emitSignal, sendNotification };
	const direct = selectSandboxHostFunctions(bound, {
		principal: selectionPrincipal({ userId, type: "user" }, "script", [
			"emitSignal",
			"sendNotification",
		]),
	});
	const subscription = selectSandboxHostFunctions(bound, runInput);
	const system = selectSandboxHostFunctions(bound, {
		principal: {
			...selectionPrincipal({ type: "system" }, "automation", ["emitSignal", "sendNotification"]),
			pluginRevision: pluginRevision(),
		},
	});

	expect(direct).toEqual({});
	expect(system).toEqual({ emitSignal });
	expect(subscription).toEqual({ emitSignal, sendNotification });
});

it("exposes global writes only to system runs with explicit capabilities", () => {
	const bound = { upsertGlobalEntities };
	const user = selectSandboxHostFunctions(bound, {
		principal: selectionPrincipal({ userId, type: "user" }, "script", ["upsertGlobalEntities"]),
	});
	const subscription = selectSandboxHostFunctions(bound, {
		principal: selectionPrincipal(runInput.principal.subject, "automation", [
			"upsertGlobalEntities",
		]),
	});
	const system = selectSandboxHostFunctions(bound, {
		principal: selectionPrincipal({ type: "system" }, "script", ["upsertGlobalEntities"]),
	});
	const providerSystem = selectSandboxHostFunctions(bound, {
		principal: {
			...selectionPrincipal({ type: "system" }, "script", ["upsertGlobalEntities"]),
			pluginRevision: pluginRevision(),
			providerId: SandboxProviderId.make("provider-1"),
		},
	});

	expect(user).toEqual({});
	expect(subscription).toEqual({});
	expect(system).toEqual({});
	expect(providerSystem).toEqual({ upsertGlobalEntities });
});

it("filters user-context and user-only capabilities by subject", () => {
	const bound = { ensureUserEntities, getUserPreferences };
	const user = selectSandboxHostFunctions(bound, {
		principal: {
			...selectionPrincipal({ userId, type: "user" }, "operation", [
				"ensureUserEntities",
				"getUserPreferences",
			]),
			pluginRevision: pluginRevision(true),
		},
	});
	const subscription = selectSandboxHostFunctions(bound, {
		principal: selectionPrincipal(runInput.principal.subject, "automation", [
			"ensureUserEntities",
			"getUserPreferences",
		]),
	});
	const system = selectSandboxHostFunctions(bound, {
		principal: selectionPrincipal({ type: "system" }, "script", [
			"ensureUserEntities",
			"getUserPreferences",
		]),
	});

	expect(user).toEqual({ ensureUserEntities, getUserPreferences });
	expect(subscription).toEqual({ getUserPreferences });
	expect(system).toEqual({});
});

it("exposes declared user relationship changes only to user-bound subject", () => {
	const bound = { changeUserRelationships };
	const user = selectSandboxHostFunctions(bound, {
		principal: selectionPrincipal({ userId, type: "user" }, "operation", [
			"changeUserRelationships",
		]),
	});
	const subscription = selectSandboxHostFunctions(bound, {
		principal: selectionPrincipal(runInput.principal.subject, "automation", [
			"changeUserRelationships",
		]),
	});
	const undeclared = selectSandboxHostFunctions(bound, {
		principal: selectionPrincipal(runInput.principal.subject, "automation", []),
	});
	const system = selectSandboxHostFunctions(bound, {
		principal: selectionPrincipal({ type: "system" }, "script", ["changeUserRelationships"]),
	});

	expect(user).toEqual({ changeUserRelationships });
	expect(subscription).toEqual({ changeUserRelationships });
	expect(undeclared).toEqual({});
	expect(system).toEqual({});
});
