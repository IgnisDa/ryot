import type {
	SandboxExecutionSubject,
	SandboxScriptMetadata,
} from "@ryot/contract/modules/sandbox/schemas";
import {
	SandboxProviderId,
	SandboxScriptId,
	SubscriptionRunId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { SandboxExecutionPrincipal } from "./execution-principal";
import { isJsonValue, requireSandboxCapabilityInput } from "./shared";
import type { SandboxRunInput } from "./shared";

const pluginRevision = (isUserBootstrap = false) => ({
	ownerId: null,
	id: "plugin_1",
	slug: "plugin",
	compiledHashes: {},
	workflowScripts: {},
	scope: "system" as const,
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
		metadata,
		providerId,
		contentHash: "",
		scriptSlug: "script",
		pluginRevision: null,
		scriptId: SandboxScriptId.make("script_1"),
		...principalFacts,
	},
});

describe("requireSandboxCapabilityInput", () => {
	it("returns input when subject and metadata satisfy capability policy", () => {
		const input = makeRunInput({ type: "user", userId: UserId.make("user_1") });
		expect(Effect.runSync(requireSandboxCapabilityInput(input, "getUserPreferences"))).toBe(input);
	});

	it("rejects user-only capabilities for subscriptions", () => {
		expect(() =>
			Effect.runSync(
				requireSandboxCapabilityInput(
					makeRunInput({
						type: "subscription",
						userId: UserId.make("user_1"),
						subscriptionRun: {
							origin: { kind: "api" },
							occurredAt: "2026-01-01T00:00:00.000Z",
							id: SubscriptionRunId.make("run_1"),
						},
					}),
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
	it("accepts nested JSON and rejects non-JSON objects", () => {
		expect(isJsonValue({ nested: [true, 42, null] })).toBe(true);
		expect(isJsonValue(new Date(0))).toBe(false);
	});
});
