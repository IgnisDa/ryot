import {
	POLICY_SAFE_SANDBOX_CAPABILITIES,
	SANDBOX_HOST_CAPABILITIES,
} from "@ryot-app/contract/modules/sandbox/wire";
import {
	PluginId,
	PluginPackageId,
	PluginRevisionId,
	PluginConfigRevisionId,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { isJsonValue } from "@ryot-app/contract/schema/json";
import { Effect, PlatformError } from "effect";
import { describe, expect, it } from "vitest";

import { selectSandboxHostFunctions } from "./executor";
import { sandboxHostResultBytes } from "./host-execution-policy";
import {
	isSandboxCapabilityAllowed,
	requireSandboxCapabilityInput,
	sandboxPlatformFailureKind,
} from "./invocation";
import { automationRunSubject, makeSubjectRunInput } from "./run-input.test-support";

const pluginRevision = (isUserBootstrap = false) => ({
	ownerId: null,
	compiledHashes: {},
	workflowScripts: {},
	scope: "system" as const,
	id: PluginId.make("plugin_1"),
	packageId: PluginPackageId.make("test/fixture"),
	revisionId: PluginRevisionId.make("revision_1"),
	configRevisionId: PluginConfigRevisionId.make("config_1"),
	userBootstrapScriptSlugs: isUserBootstrap ? ["script"] : [],
	configSchema: { fields: {}, unknownKeys: "strict" as const },
	schemaScope: {
		eventSchemas: [],
		entitySchemaSlugs: [],
		signalSchemaSlugs: [],
		relationshipSchemaSlugs: [],
	},
});

describe("requireSandboxCapabilityInput", () => {
	it("limits before runs to declared policy-safe capabilities at selection and invocation", () => {
		const input = makeSubjectRunInput(automationRunSubject("before", UserId.make("user_1")));
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
			POLICY_SAFE_SANDBOX_CAPABILITIES.filter(
				(capability) => sandboxHostResultBytes(capability) !== null,
			).sort((a, b) => SANDBOX_HOST_CAPABILITIES.indexOf(a) - SANDBOX_HOST_CAPABILITIES.indexOf(b)),
		);
		expect(
			selectSandboxHostFunctions(functions, { ...input, workflowExecutionId: "workflow" }),
		).not.toHaveProperty("replayJournal");
	});

	const selection: ReadonlyArray<
		readonly [
			name: string,
			kind: "script" | "workflow",
			capabilities: ReadonlyArray<string> | undefined,
			bound: ReadonlyArray<string>,
			expected: ReadonlyArray<string>,
		]
	> = [
		["binds nothing without declared capabilities", "script", undefined, ["log", "span"], []],
		["ignores unknown capability names", "script", ["log", "unknown"], ["log", "span"], ["log"]],
		[
			"never binds filesystem grant capabilities",
			"script",
			["scratch", "artifact-read", "httpCall"],
			["scratch", "httpCall"],
			["httpCall"],
		],
		[
			"keeps replayJournal out of workflow selection",
			"workflow",
			["httpCall"],
			["httpCall", "replayJournal"],
			[],
		],
		[
			"does not bind replayJournal alone",
			"script",
			["replayJournal"],
			["httpCall", "replayJournal"],
			[],
		],
		[
			"binds only the ordinary capability beside replayJournal",
			"script",
			["httpCall", "replayJournal"],
			["httpCall", "replayJournal"],
			["httpCall"],
		],
		[
			"gates executeRyotql by the declared capability",
			"script",
			["executeRyotql"],
			["executeRyotql"],
			["executeRyotql"],
		],
	];

	it.each(selection)("selects host functions: %s", (_name, kind, capabilities, bound, expected) => {
		const input = makeSubjectRunInput(
			{ type: "system" },
			null,
			{ kind, capabilities: capabilities === undefined ? undefined : [...capabilities] },
			{ pluginRevision: pluginRevision() },
		);
		const functions = Object.fromEntries(bound.map((name) => [name, () => Effect.void]));

		expect(Object.keys(selectSandboxHostFunctions(functions, input))).toEqual(expected);
	});

	it("requires a declared notification capability and user automation scope", () => {
		const input = makeSubjectRunInput(automationRunSubject("after", UserId.make("user_1")));
		expect(isSandboxCapabilityAllowed(input, "sendNotification")).toBe(true);
		expect(isSandboxCapabilityAllowed(input, "emitSignal")).toBe(true);
		expect(
			isSandboxCapabilityAllowed(
				makeSubjectRunInput(automationRunSubject("after", null)),
				"sendNotification",
			),
		).toBe(false);
		expect(
			isSandboxCapabilityAllowed(
				makeSubjectRunInput({
					type: "user",
					userId: UserId.make("user_1"),
					accountGeneration: { userId: UserId.make("user_1"), token: "test-account-generation" },
				}),
				"sendNotification",
			),
		).toBe(false);
		expect(
			isSandboxCapabilityAllowed(
				makeSubjectRunInput(input.principal.subject, null, { capabilities: [] }),
				"sendNotification",
			),
		).toBe(false);
	});

	it("exposes only resource-free capabilities to non-workflow executions", () => {
		const input = makeSubjectRunInput(automationRunSubject("after", UserId.make("user_1")));
		const functions = Object.fromEntries(
			SANDBOX_HOST_CAPABILITIES.map((capability) => [capability, () => Effect.void]),
		);
		for (const capability of [
			"createEvents",
			"updateEvents",
			"deleteEvents",
			"listIntegrations",
			"sendNotification",
			"getEntitySchemas",
			"changeUserRelationships",
		] as const) {
			expect(isSandboxCapabilityAllowed(input, capability)).toBe(true);
			expect(selectSandboxHostFunctions(functions, input)).not.toHaveProperty(capability);
		}
		expect(selectSandboxHostFunctions(functions, input)).toHaveProperty("httpCall");
		expect(selectSandboxHostFunctions(functions, input)).toHaveProperty("getCachedValue");
	});

	it("applies system restrictions to system automation runs", () => {
		const input = makeSubjectRunInput(
			{
				...automationRunSubject("after", null),
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
		expect(isSandboxCapabilityAllowed(input, "updateEvents")).toBe(false);
		expect(isSandboxCapabilityAllowed(input, "deleteEvents")).toBe(false);
		expect(isSandboxCapabilityAllowed(input, "upsertGlobalRelationships")).toBe(false);
	});
	it("returns input when subject and metadata satisfy capability policy", () => {
		const input = makeSubjectRunInput({
			type: "user",
			userId: UserId.make("user_1"),
			accountGeneration: { userId: UserId.make("user_1"), token: "test-account-generation" },
		});
		expect(Effect.runSync(requireSandboxCapabilityInput(input, "getUserPreferences"))).toBe(input);
		expect(Effect.runSync(requireSandboxCapabilityInput(input, "updateEvents"))).toBe(input);
		expect(Effect.runSync(requireSandboxCapabilityInput(input, "deleteEvents"))).toBe(input);
	});

	it("rejects direct-user-only capabilities for automation runs", () => {
		const failure = Effect.runSync(
			Effect.flip(
				requireSandboxCapabilityInput(
					makeSubjectRunInput(automationRunSubject("after", UserId.make("user_1"))),
					"ensureUserEntities",
				),
			),
		);
		expect(failure.message).toContain("available only to user executions");
		expect(failure.data).toEqual({
			code: "unavailable-operation",
			operation: "ensureUserEntities",
		});
	});

	it("accepts system script capabilities and requires provider scope when declared", () => {
		const input = makeSubjectRunInput(
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
					makeSubjectRunInput({ type: "system" }, null, { kind: "script" }),
					"upsertGlobalEntities",
				),
			),
		).toThrow("upsertGlobalEntities is available only to provider-associated scripts");
	});

	it("limits system RyotQL access to approved metadata kinds", () => {
		const script = makeSubjectRunInput(
			{ type: "system" },
			null,
			{ kind: "script" },
			{ pluginRevision: pluginRevision() },
		);
		expect(Effect.runSync(requireSandboxCapabilityInput(script, "executeRyotql"))).toBe(script);
		const automation = makeSubjectRunInput(
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
						makeSubjectRunInput({ type: "system" }, providerId, { kind }),
						capability,
					),
				),
			).toThrow(`${capability} system access requires a pinned system plugin script`);
		}
	});

	it("restricts automation capabilities to trusted automation executions", () => {
		const automation = makeSubjectRunInput(
			{ type: "system" },
			null,
			{ kind: "automation" },
			{ pluginRevision: pluginRevision() },
		);
		expect(Effect.runSync(requireSandboxCapabilityInput(automation, "emitSignal"))).toBe(
			automation,
		);
		expect(() =>
			Effect.runSync(
				requireSandboxCapabilityInput(makeSubjectRunInput({ type: "system" }), "emitSignal"),
			),
		).toThrow("emitSignal is not available to this system execution");
	});

	it("permits only exact designated user-bootstrap scripts in either plugin scope", () => {
		const subject = {
			type: "user" as const,
			userId: UserId.make("user_1"),
			accountGeneration: { userId: UserId.make("user_1"), token: "test-account-generation" },
		};
		expect(() =>
			Effect.runSync(
				requireSandboxCapabilityInput(makeSubjectRunInput(subject), "ensureUserEntities"),
			),
		).toThrow("ensureUserEntities is available only to pinned user bootstrap scripts");
		const trusted = makeSubjectRunInput(
			subject,
			null,
			{ kind: "script" },
			{ pluginRevision: pluginRevision(true) },
		);
		expect(Effect.runSync(requireSandboxCapabilityInput(trusted, "ensureUserEntities"))).toBe(
			trusted,
		);
		const privateBootstrap = {
			...trusted,
			principal: {
				...trusted.principal,
				pluginRevision: {
					...pluginRevision(true),
					scope: "user" as const,
					ownerId: subject.userId,
				},
			},
		};
		expect(
			Effect.runSync(requireSandboxCapabilityInput(privateBootstrap, "ensureUserEntities")),
		).toBe(privateBootstrap);
		expect(Effect.runSync(requireSandboxCapabilityInput(privateBootstrap, "executeRyotql"))).toBe(
			privateBootstrap,
		);
		expect(() =>
			Effect.runSync(
				requireSandboxCapabilityInput(
					{
						...privateBootstrap,
						principal: { ...privateBootstrap.principal, scriptSlug: "other-script" },
					},
					"ensureUserEntities",
				),
			),
		).toThrow("available only to pinned user bootstrap scripts");
		expect(() =>
			Effect.runSync(
				requireSandboxCapabilityInput(
					{
						...privateBootstrap,
						principal: { ...privateBootstrap.principal, subject: { type: "system" } },
					},
					"executeRyotql",
				),
			),
		).toThrow("system access requires a pinned system plugin script");
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
