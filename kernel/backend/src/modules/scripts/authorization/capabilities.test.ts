import { describe, expect, it } from "bun:test";

import {
	POLICY_SAFE_SANDBOX_CAPABILITIES,
	SANDBOX_HOST_CAPABILITIES,
} from "@ryot-app/contract/modules/scripts/wire";
import {
	PluginConfigRevisionId,
	PluginId,
	PluginPackageId,
	PluginRevisionId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import {
	automationRunSubject,
	policyRunSubject,
} from "@ryot-app/sandbox/host/run-input.test-support";
import { Effect } from "effect";

import { isSandboxCapabilityAllowed, requireSandboxCapabilityInput } from "./capabilities";
import { emptyScriptsDigest, makeSubjectRunInput } from "./principal.test-support";

const pluginRevision = () => ({
	ownerId: null,
	workflowScripts: {},
	scope: "system" as const,
	userBootstrapScriptSlugs: [],
	id: PluginId.make("plugin_1"),
	scriptsDigest: emptyScriptsDigest,
	packageId: PluginPackageId.make("test/fixture"),
	revisionId: PluginRevisionId.make("revision_1"),
	configRevisionId: PluginConfigRevisionId.make("config_1"),
	configSchema: { fields: {}, unknownKeys: "strict" as const },
});

describe("requireSandboxCapabilityInput", () => {
	it("confines agent authority to diagnostics and capability calls", () => {
		const input = makeSubjectRunInput({
			type: "agent",
			accessClass: "standard",
			userId: UserId.make("agent-user"),
		});
		for (const capability of SANDBOX_HOST_CAPABILITIES) {
			expect(isSandboxCapabilityAllowed(input, capability)).toBe(
				["log", "span", "invokeCapability"].includes(capability),
			);
		}
	});

	it("limits projection processors to declared read-only capabilities", () => {
		const userId = UserId.make("user_1");
		const subject = { userId, type: "projection" as const };
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
		const rejected = Effect.runSync(Effect.flip(requireSandboxCapabilityInput(input, "httpCall")));
		expect(rejected.data).toEqual({ operation: "httpCall", code: "unavailable-operation" });
	});

	it("limits before runs to declared policy-safe capabilities", () => {
		const input = makeSubjectRunInput(policyRunSubject(UserId.make("user_1")));
		for (const capability of SANDBOX_HOST_CAPABILITIES) {
			expect(isSandboxCapabilityAllowed(input, capability)).toBe(
				POLICY_SAFE_SANDBOX_CAPABILITIES.some((safe) => safe === capability),
			);
		}
	});

	it("applies system restrictions to system automation runs", () => {
		const input = makeSubjectRunInput(
			{
				...automationRunSubject(null),
				pluginId: pluginRevision().id,
				pluginRevisionId: pluginRevision().revisionId,
				pluginConfigRevisionId: pluginRevision().configRevisionId,
			},
			null,
			{ kind: "automation" },
			{ pluginRevision: pluginRevision() },
		);
		expect(isSandboxCapabilityAllowed(input, "executeRyotql")).toBe(true);
		expect(isSandboxCapabilityAllowed(input, "getEntitlements")).toBe(false);
		expect(isSandboxCapabilityAllowed(input, "getOAuthAccessToken")).toBe(false);
	});
	it("returns input when subject and metadata satisfy capability policy", () => {
		const input = makeSubjectRunInput({ type: "user", userId: UserId.make("user_1") });
		expect(
			Effect.runSync(requireSandboxCapabilityInput(input, "getUserPreferences")),
		).toBe<unknown>(input);
		expect(
			Effect.runSync(requireSandboxCapabilityInput(input, "getOAuthAccessToken")),
		).toBe<unknown>(input);
	});

	it("limits Pro availability and managed asset verification to user-owned runs", () => {
		const userId = UserId.make("user_1");
		const user = makeSubjectRunInput({ userId, type: "user" });
		const automation = makeSubjectRunInput(automationRunSubject(userId));
		const before = makeSubjectRunInput(policyRunSubject(userId));
		const system = makeSubjectRunInput({ type: "system" });

		for (const capability of ["getEntitlements", "verifyManagedAssets"] as const) {
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
					makeSubjectRunInput(automationRunSubject(UserId.make("user_1"))),
					"getOAuthAccessToken",
				),
			),
		);
		expect(failure.message).toContain("available only to user executions");
		expect(failure.data).toEqual({
			code: "unavailable-operation",
			operation: "getOAuthAccessToken",
		});
	});

	it("limits system RyotQL access to approved metadata kinds", () => {
		const script = makeSubjectRunInput(
			{ type: "system" },
			null,
			{ kind: "script" },
			{ pluginRevision: pluginRevision() },
		);
		expect(Effect.runSync(requireSandboxCapabilityInput(script, "executeRyotql"))).toBe<unknown>(
			script,
		);
		const automation = makeSubjectRunInput(
			{ type: "system" },
			null,
			{ kind: "automation" },
			{ pluginRevision: pluginRevision() },
		);
		expect(
			Effect.runSync(requireSandboxCapabilityInput(automation, "executeRyotql")),
		).toBe<unknown>(automation);
		expect(() =>
			Effect.runSync(
				requireSandboxCapabilityInput(
					makeSubjectRunInput(
						{ type: "system" },
						null,
						{ kind: "operation" },
						{ pluginRevision: pluginRevision() },
					),
					"executeRyotql",
				),
			),
		).toThrow("executeRyotql is not available to this system execution");
	});

	it("rejects elevated system paths outside a pinned system plugin", () => {
		for (const kind of ["script", "automation"] as const) {
			expect(() =>
				Effect.runSync(
					requireSandboxCapabilityInput(
						makeSubjectRunInput({ type: "system" }, null, { kind }),
						"executeRyotql",
					),
				),
			).toThrow("executeRyotql system access requires a pinned system plugin script");
		}
		expect(() =>
			Effect.runSync(
				requireSandboxCapabilityInput(
					makeSubjectRunInput(
						{ type: "system" },
						null,
						{ kind: "script" },
						{ pluginRevision: { ...pluginRevision(), scope: "user" } },
					),
					"executeRyotql",
				),
			),
		).toThrow("executeRyotql system access requires a pinned system plugin script");
	});
});
