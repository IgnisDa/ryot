import type {
	SandboxExecutionSubject,
	SandboxScriptMetadata,
} from "@ryot-app/contract/modules/sandbox/schemas";
import {
	POLICY_SAFE_SANDBOX_CAPABILITIES,
	SANDBOX_HOST_CAPABILITIES,
} from "@ryot-app/contract/modules/sandbox/wire";
import {
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	IntegrationId,
	PluginId,
	PluginRevisionId,
	PluginConfigRevisionId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, PlatformError } from "effect";
import { describe, expect, it } from "vitest";

import type { SandboxExecutionPrincipal } from "./execution-principal";
import { selectSandboxHostFunctions } from "./service";
import {
	isJsonValue,
	isSandboxCapabilityAllowed,
	requireSandboxCapabilityInput,
	sandboxLifecycleCommand,
	sandboxPlatformFailureKind,
	sandboxRunUserId,
	sandboxRunIntegrationId,
} from "./shared";
import type { SandboxRunInput } from "./shared";

const pluginRevision = (isUserBootstrap = false) => ({
	ownerId: null,
	slug: "plugin",
	compiledHashes: {},
	workflowScripts: {},
	scope: "system" as const,
	id: PluginId.make("plugin_1"),
	revisionId: PluginRevisionId.make("revision_1"),
	configRevisionId: PluginConfigRevisionId.make("config_1"),
	userBootstrapScriptSlugs: isUserBootstrap ? ["script"] : [],
	configSchema: { fields: {}, unknownKeys: "strict" as const },
	schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
});

const makeRunInput = (
	subject: SandboxExecutionSubject,
	providerId: SandboxProviderId | null = null,
	metadata: SandboxScriptMetadata = {},
	principalFacts: Partial<SandboxExecutionPrincipal> = {},
): SandboxRunInput => ({
	context: {},
	compiledCode: "",
	compiledFormat: 1,
	executionId: "exec_1",
	principal: {
		subject,
		providerId,
		contentHash: "",
		scriptSlug: "script",
		pluginRevision: null,
		scriptId: SandboxScriptId.make("script_1"),
		metadata: { capabilities: [...SANDBOX_HOST_CAPABILITIES], ...metadata },
		...principalFacts,
	},
});

const automationSubject = (
	stage: "before" | "after",
	executionUserId: UserId | null,
): Extract<SandboxExecutionSubject, { type: "automation-run" }> => ({
	stage,
	pluginId: null,
	executionUserId,
	type: "automation-run",
	pluginRevisionId: null,
	pluginConfigRevisionId: null,
	runId: AutomationRunId.make("run_1"),
	triggerId: AutomationTriggerId.make("trigger_1"),
	causation: {
		depth: 0,
		source: "api",
		parentRunId: null,
		parentTriggerId: null,
		initiator: { id: null, kind: "system" },
		executionId: AutomationExecutionId.make("execution_1"),
		rootExecutionId: AutomationExecutionId.make("execution_1"),
	},
});

describe("requireSandboxCapabilityInput", () => {
	it("derives trusted source-specific root lifecycle commands", () => {
		const trusted = {
			hostCallDiscriminator: 7,
			workflowExecutionId: "workflow-1",
			startedAt: "2026-09-16T10:00:00.000Z",
		};
		const integration = Effect.runSync(
			sandboxLifecycleCommand(
				{
					...makeRunInput({
						type: "user",
						userId: UserId.make("user-1"),
						integrationId: IntegrationId.make("integration-1"),
					}),
					...trusted,
				},
				"integration",
				"changeUserRelationships",
			),
		);
		expect(integration).toMatchObject({
			occurredAt: trusted.startedAt,
			itemIdentity: "changeUserRelationships",
			causation: {
				depth: 0,
				source: "integration",
				integrationId: "integration-1",
				executionId: "workflow-1-host-7",
				rootExecutionId: "workflow-1-host-7",
				initiator: { kind: "integration", id: "integration-1" },
			},
		});

		const provider = Effect.runSync(
			sandboxLifecycleCommand(
				{ ...makeRunInput({ type: "system" }, SandboxProviderId.make("provider-1")), ...trusted },
				"provider-refresh",
				"upsertGlobalEntities",
			),
		);
		expect(provider.causation).toMatchObject({
			source: "provider-refresh",
			executionId: "workflow-1-host-7",
			providerExecutionId: "workflow-1",
			initiator: { id: null, kind: "system" },
		});
	});

	it("limits before runs to declared policy-safe capabilities at selection and invocation", () => {
		const input = makeRunInput(automationSubject("before", UserId.make("user_1")));
		for (const capability of SANDBOX_HOST_CAPABILITIES) {
			expect(isSandboxCapabilityAllowed(input, capability)).toBe(
				POLICY_SAFE_SANDBOX_CAPABILITIES.some((safe) => safe === capability),
			);
		}
		const functions = Object.fromEntries(
			[...SANDBOX_HOST_CAPABILITIES, "replayJournal"].map((capability) => [
				capability,
				() => Effect.void,
			]),
		);
		expect(Object.keys(selectSandboxHostFunctions(functions, input))).toEqual(
			[...POLICY_SAFE_SANDBOX_CAPABILITIES].sort(
				(a, b) => SANDBOX_HOST_CAPABILITIES.indexOf(a) - SANDBOX_HOST_CAPABILITIES.indexOf(b),
			),
		);
		expect(
			selectSandboxHostFunctions(functions, { ...input, workflowExecutionId: "workflow" }),
		).toHaveProperty("replayJournal", functions["replayJournal"]);
	});

	it("requires a declared notification capability and user automation scope", () => {
		const input = makeRunInput(automationSubject("after", UserId.make("user_1")));
		expect(isSandboxCapabilityAllowed(input, "sendNotification")).toBe(true);
		expect(isSandboxCapabilityAllowed(input, "emitSignal")).toBe(true);
		expect(
			isSandboxCapabilityAllowed(
				makeRunInput(automationSubject("after", null)),
				"sendNotification",
			),
		).toBe(false);
		expect(
			isSandboxCapabilityAllowed(
				makeRunInput({ type: "user", userId: UserId.make("user_1") }),
				"sendNotification",
			),
		).toBe(false);
		expect(
			isSandboxCapabilityAllowed(
				makeRunInput(input.principal.subject, null, { capabilities: [] }),
				"sendNotification",
			),
		).toBe(false);
	});

	it("uses execution user and trusted causation integration without subscription context", () => {
		const base = automationSubject("after", UserId.make("user_1"));
		const subject = {
			...base,
			causation: { ...base.causation, integrationId: IntegrationId.make("integration_1") },
		};
		const input = Effect.runSync(
			requireSandboxCapabilityInput(makeRunInput(subject), "getCurrentIntegration"),
		);
		expect(sandboxRunUserId(input)).toBe("user_1");
		expect(sandboxRunIntegrationId(input)).toBe("integration_1");
		expect(sandboxRunUserId(makeRunInput(automationSubject("after", null)))).toBeNull();
	});

	it("applies system restrictions to system automation runs", () => {
		const input = makeRunInput(
			{
				...automationSubject("after", null),
				pluginId: pluginRevision().id,
				pluginRevisionId: pluginRevision().revisionId,
				pluginConfigRevisionId: pluginRevision().configRevisionId,
			},
			null,
			{ kind: "automation" },
			{ pluginRevision: pluginRevision() },
		);
		expect(isSandboxCapabilityAllowed(input, "emitSignal")).toBe(true);
		expect(isSandboxCapabilityAllowed(input, "executeRyotql")).toBe(true);
		expect(isSandboxCapabilityAllowed(input, "createEvents")).toBe(false);
		expect(isSandboxCapabilityAllowed(input, "upsertGlobalRelationships")).toBe(false);
	});
	it("returns input when subject and metadata satisfy capability policy", () => {
		const input = makeRunInput({ type: "user", userId: UserId.make("user_1") });
		expect(Effect.runSync(requireSandboxCapabilityInput(input, "getUserPreferences"))).toBe(input);
	});

	it("rejects direct-user-only capabilities for automation runs", () => {
		expect(() =>
			Effect.runSync(
				requireSandboxCapabilityInput(
					makeRunInput(automationSubject("after", UserId.make("user_1"))),
					"ensureUserEntities",
				),
			),
		).toThrow("ensureUserEntities is available only to user executions");
	});

	it("accepts system script capabilities and requires provider scope when declared", () => {
		const input = makeRunInput(
			{ type: "system" },
			SandboxProviderId.make("provider_1"),
			{ kind: "script" },
			{ pluginRevision: pluginRevision() },
		);
		expect(Effect.runSync(requireSandboxCapabilityInput(input, "upsertGlobalEntities"))).toBe(
			input,
		);
		expect(() =>
			Effect.runSync(
				requireSandboxCapabilityInput(
					makeRunInput({ type: "system" }, null, { kind: "script" }),
					"upsertGlobalEntities",
				),
			),
		).toThrow("upsertGlobalEntities is available only to provider-associated scripts");
	});

	it("limits system RyotQL access to approved metadata kinds", () => {
		const script = makeRunInput(
			{ type: "system" },
			null,
			{ kind: "script" },
			{ pluginRevision: pluginRevision() },
		);
		expect(Effect.runSync(requireSandboxCapabilityInput(script, "executeRyotql"))).toBe(script);
		const automation = makeRunInput(
			{ type: "system" },
			null,
			{ kind: "automation" },
			{ pluginRevision: pluginRevision() },
		);
		expect(Effect.runSync(requireSandboxCapabilityInput(automation, "executeRyotql"))).toBe(
			automation,
		);
	});

	it("rejects elevated system paths outside a pinned system plugin", () => {
		for (const [capability, providerId, kind] of [
			["upsertGlobalEntities", SandboxProviderId.make("provider_1"), "script"],
			["upsertGlobalRelationships", null, "script"],
			["executeRyotql", null, "script"],
			["emitSignal", null, "automation"],
		] as const) {
			expect(() =>
				Effect.runSync(
					requireSandboxCapabilityInput(
						makeRunInput({ type: "system" }, providerId, { kind }),
						capability,
					),
				),
			).toThrow(`${capability} system access requires a pinned system plugin script`);
		}
	});

	it("restricts automation capabilities to trusted automation executions", () => {
		const automation = makeRunInput(
			{ type: "system" },
			null,
			{ kind: "automation" },
			{ pluginRevision: pluginRevision() },
		);
		expect(Effect.runSync(requireSandboxCapabilityInput(automation, "emitSignal"))).toBe(
			automation,
		);
		expect(() =>
			Effect.runSync(requireSandboxCapabilityInput(makeRunInput({ type: "system" }), "emitSignal")),
		).toThrow("emitSignal is not available to this system execution");
	});

	it("requires a pinned system user-bootstrap script for ensureUserEntities", () => {
		const subject = { type: "user" as const, userId: UserId.make("user_1") };
		expect(() =>
			Effect.runSync(requireSandboxCapabilityInput(makeRunInput(subject), "ensureUserEntities")),
		).toThrow("ensureUserEntities is available only to pinned system user bootstrap scripts");
		const trusted = makeRunInput(
			subject,
			null,
			{ kind: "script" },
			{ pluginRevision: pluginRevision(true) },
		);
		expect(Effect.runSync(requireSandboxCapabilityInput(trusted, "ensureUserEntities"))).toBe(
			trusted,
		);
	});
});

describe("isJsonValue", () => {
	it("uses the canonical cycle-safe JSON predicate", () => {
		const shared = { value: true };
		const cyclic: Record<string, unknown> = {};
		cyclic["self"] = cyclic;

		expect(isJsonValue({ nested: [true, 42, null] })).toBe(true);
		expect(isJsonValue({ left: shared, right: shared })).toBe(true);
		expect(isJsonValue(new Date(0))).toBe(false);
		expect(isJsonValue(Array(1))).toBe(false);
		expect(isJsonValue(cyclic)).toBe(false);
	});
});

const systemError = (tag: "Busy" | "NotFound" | "WouldBlock", cause?: unknown) =>
	PlatformError.systemError({
		_tag: tag,
		method: "spawn",
		module: "ChildProcessSpawner",
		...(cause === undefined ? {} : { cause }),
	});

describe("sandboxPlatformFailureKind", () => {
	it("treats exhausted platform resources as retryable and other failures as infrastructure", () => {
		expect(sandboxPlatformFailureKind(systemError("Busy"))).toBe("resource-unavailable");
		expect(sandboxPlatformFailureKind(systemError("WouldBlock"))).toBe("resource-unavailable");
		expect(sandboxPlatformFailureKind(systemError("NotFound", { code: "EMFILE" }))).toBe(
			"resource-unavailable",
		);
		expect(sandboxPlatformFailureKind(systemError("NotFound", { code: "ENOENT" }))).toBe(
			"infrastructure",
		);
		expect(sandboxPlatformFailureKind(new Error("boom"))).toBe("infrastructure");
	});
});
