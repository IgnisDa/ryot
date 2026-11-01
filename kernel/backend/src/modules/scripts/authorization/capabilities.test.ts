import {
	POLICY_SAFE_SANDBOX_CAPABILITIES,
	SANDBOX_HOST_CAPABILITIES,
} from "@ryot-app/contract/modules/scripts/wire";
import {
	PluginConfigRevisionId,
	PluginId,
	PluginPackageId,
	PluginRevisionId,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { automationRunSubject } from "@ryot-app/sandbox/host/run-input.test-support";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { isSandboxCapabilityAllowed, requireSandboxCapabilityInput } from "./capabilities";
import { makeSubjectRunInput } from "./principal.test-support";

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
	it("limits projection processors to declared read-only capabilities", () => {
		const userId = UserId.make("user_1");
		const subject = {
			userId,
			type: "projection" as const,
			accountGeneration: { userId, token: "test-account-generation" },
		};
		const input = makeSubjectRunInput(subject);
		for (const capability of SANDBOX_HOST_CAPABILITIES) {
			expect(isSandboxCapabilityAllowed(input, capability)).toBe(
				POLICY_SAFE_SANDBOX_CAPABILITIES.some((safe) => safe === capability),
			);
		}
		expect(
			isSandboxCapabilityAllowed(
				makeSubjectRunInput(subject, null, { capabilities: [] }),
				"executeRyotql",
			),
		).toBe(false);
		const rejected = Effect.runSync(
			Effect.flip(requireSandboxCapabilityInput(input, "commitUserChanges")),
		);
		expect(rejected.data).toEqual({
			code: "unavailable-operation",
			operation: "commitUserChanges",
		});
	});

	it("limits before runs to declared policy-safe capabilities", () => {
		const input = makeSubjectRunInput(automationRunSubject("before", UserId.make("user_1")));
		for (const capability of SANDBOX_HOST_CAPABILITIES) {
			expect(isSandboxCapabilityAllowed(input, capability)).toBe(
				POLICY_SAFE_SANDBOX_CAPABILITIES.some((safe) => safe === capability),
			);
		}
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

	it("limits Pro availability and managed asset verification to user-owned runs", () => {
		const userId = UserId.make("user_1");
		const user = makeSubjectRunInput({
			userId,
			type: "user",
			accountGeneration: { userId, token: "test-account-generation" },
		});
		const automation = makeSubjectRunInput(automationRunSubject("after", userId));
		const before = makeSubjectRunInput(automationRunSubject("before", userId));
		const system = makeSubjectRunInput({ type: "system" });

		for (const capability of ["getProAvailability", "verifyManagedAssets"] as const) {
			expect(isSandboxCapabilityAllowed(user, capability)).toBe(true);
			expect(isSandboxCapabilityAllowed(automation, capability)).toBe(true);
			expect(isSandboxCapabilityAllowed(before, capability)).toBe(false);
			expect(isSandboxCapabilityAllowed(system, capability)).toBe(false);
		}
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

	it("limits user settings writes to declared direct user executions", () => {
		const userId = UserId.make("user_1");
		const subject = {
			userId,
			type: "user" as const,
			accountGeneration: { userId, token: "test-account-generation" },
		};
		expect(isSandboxCapabilityAllowed(makeSubjectRunInput(subject), "updateUserSettings")).toBe(
			true,
		);
		expect(
			isSandboxCapabilityAllowed(
				makeSubjectRunInput(subject, null, { capabilities: ["getUserSettings"] }),
				"updateUserSettings",
			),
		).toBe(false);
		for (const other of [
			automationRunSubject("after", userId),
			automationRunSubject("before", userId),
			automationRunSubject("after", null),
			{ type: "system" as const },
			{ ...subject, type: "projection" as const },
		]) {
			expect(isSandboxCapabilityAllowed(makeSubjectRunInput(other), "updateUserSettings")).toBe(
				false,
			);
		}
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
