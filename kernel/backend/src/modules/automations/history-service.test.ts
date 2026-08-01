import { expect, it } from "@effect/vitest";
import {
	AUTOMATION_HISTORY_LIMITS,
	AutomationHistoryRequestError,
} from "@ryot-app/contract/modules/automations/history-schemas";
import {
	AutomationRunAttempt,
	AutomationSignalPayload,
	AutomationTriggerPayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Effect, Schema } from "effect";
import { it as unit } from "vitest";

import { assertExitFails } from "#lib/test-utils/assertions";
import { fixtureManifest } from "#modules/plugins/test-support";

import {
	decodeAutomationHistoryCursor,
	projectAutomationHistoryAttempt,
	redactAutomationHistoryPayload,
} from "./history-service";

const base = fixtureManifest();
const manifest: PluginManifest = {
	...base,
	signalSchemas: base.signalSchemas.map((signal) => ({
		...signal,
		propertiesSchema: {
			fields: {
				public: { type: "string", label: "Public", description: "Public field" },
				password: { secret: true, type: "string", label: "Password", description: "Secret field" },
				nested: {
					type: "object",
					label: "Nested",
					description: "Nested object",
					properties: {
						visible: { type: "string", label: "Visible", description: "Visible field" },
						credential: {
							secret: true,
							type: "string",
							label: "Credential",
							description: "Secret credential",
						},
					},
				},
				items: {
					type: "array",
					label: "Items",
					description: "Array of objects",
					items: {
						label: "Item",
						type: "object",
						description: "Array item",
						properties: {
							label: { type: "string", label: "Label", description: "Public label" },
							private: {
								secret: true,
								type: "string",
								label: "Private",
								description: "Private field",
							},
						},
					},
				},
			},
		},
	})),
};

unit(
	"redacts secret fields from the retained revision, including nested objects and array items",
	() => {
		const payload = Schema.decodeSync(AutomationSignalPayload)({
			operation: "emit",
			category: "signal",
			resource: "signal",
			actorUserId: "owner",
			signalSchemaPluginId: "plugin-1",
			signalSchemaSlug: "fixture.signal",
			properties: {
				public: "visible",
				password: "hidden",
				items: [{ label: "ok", private: "hidden" }],
				nested: { visible: "ok", credential: "hidden" },
			},
		});
		expect(redactAutomationHistoryPayload(payload, manifest, payload.signalSchemaPluginId)).toEqual(
			{
				...payload,
				properties: { public: "visible", items: [{ label: "ok" }], nested: { visible: "ok" } },
			},
		);
		expect(redactAutomationHistoryPayload(payload, null, payload.signalSchemaPluginId)).toEqual({
			...payload,
			properties: {},
		});
		expect(redactAutomationHistoryPayload(payload, manifest, null)).toEqual({
			...payload,
			properties: {},
		});
		expect(payload.properties).toMatchObject({ password: "hidden" });
	},
);

unit("redacts mutation snapshots and parent population properties with their own schemas", () => {
	const pinned: PluginManifest = {
		...base,
		entitySchemas: base.entitySchemas.map((entity) =>
			Object.assign({}, entity, {
				propertiesSchema: {
					fields: {
						count: { type: "number", label: "Count", description: "Counter" },
						token: { secret: true, type: "string", label: "Token", description: "Secret token" },
					},
				} satisfies AppSchema,
			}),
		),
	};
	const snapshot = {
		id: "entity",
		name: "Item",
		externalId: null,
		providerId: null,
		populatedAt: null,
		entitySchemaSlug: "fixture-entity",
		createdAt: "2026-09-15T00:00:00.000Z",
		updatedAt: "2026-09-15T00:00:00.000Z",
		properties: { count: 2, token: "hidden" },
	};
	const item = {
		after: snapshot,
		before: snapshot,
		category: "change",
		resource: "entity",
		operation: "update",
	} as const;
	const population = {
		rootPreviouslyPopulated: true,
		scopeEntity: { id: "entity", name: "Item", entitySchemaSlug: "fixture-entity" },
		parentEntity: {
			name: "Parent",
			entitySchemaSlug: "fixture-entity",
			properties: { count: 1, token: "hidden" },
		},
	};
	const payload = Schema.decodeSync(AutomationTriggerPayload)({ ...item, population });
	expect(redactAutomationHistoryPayload(payload, pinned, null)).toMatchObject({
		after: { properties: { count: 2 } },
		before: { properties: { count: 2 } },
		population: { parentEntity: { properties: { count: 1 } } },
	});
	expect(JSON.stringify(redactAutomationHistoryPayload(payload, pinned, null))).not.toContain(
		"hidden",
	);
	const batch = Schema.decodeSync(AutomationTriggerPayload)({
		category: "change",
		resource: "entity",
		operation: "batch",
		items: [{ ...item, population }],
	});
	expect(redactAutomationHistoryPayload(batch, pinned, null)).toMatchObject({
		items: [
			{
				after: { properties: { count: 2 } },
				before: { properties: { count: 2 } },
				population: { parentEntity: { properties: { count: 1 } } },
			},
		],
	});
	expect(JSON.stringify(redactAutomationHistoryPayload(batch, pinned, null))).not.toContain(
		"hidden",
	);
});

const attempt = () =>
	Schema.decodeSync(AutomationRunAttempt)({
		runId: "run",
		timing: null,
		id: "attempt",
		status: "failed",
		retryable: false,
		attemptNumber: 1,
		artifactsPrunedAt: null,
		workflowExecutionId: "workflow",
		failureKind: "business-failure",
		startedAt: "2026-09-15T00:00:00.000Z",
		finishedAt: "2026-09-15T00:00:00.000Z",
		returnedValue: { secret: "not-public" },
		error: { code: "private-error-code", message: "Authorization: Bearer private-token" },
		logs: [
			{
				level: "error",
				message: "password=private-password",
				attributes: { nested: { count: 2, apiKey: "private-key" } },
			},
		],
	});

unit(
	"uses existing sensitive diagnostic redaction and excludes raw results and workflow identity",
	() => {
		const projected = projectAutomationHistoryAttempt(attempt());
		expect(projected.error).toEqual({
			code: "business-failure",
			message: "Authorization: [REDACTED]",
		});
		expect(projected.logs).toEqual([
			{
				level: "error",
				message: "password=[REDACTED]",
				attributes: { nested: { count: 2, apiKey: "[REDACTED]" } },
			},
		]);
		expect(projected).not.toHaveProperty("returnedValue");
		expect(projected).not.toHaveProperty("workflowExecutionId");
		expect(JSON.stringify(projected)).not.toContain("private-");
	},
);

unit("bounds UTF-8 artifacts and suppresses pruned artifacts", () => {
	const original = attempt();
	const huge = "😀".repeat(AUTOMATION_HISTORY_LIMITS.attemptBytes);
	const projected = projectAutomationHistoryAttempt({
		...original,
		error: { message: huge, code: "failure" },
		logs: [
			{ level: "info", message: huge },
			{ level: "info", message: "small" },
		],
	});
	expect(projected.artifactsTruncated).toBe(true);
	expect(projected.logs).toEqual([{ level: "info", message: "small" }]);
	expect(
		Buffer.byteLength(JSON.stringify({ logs: projected.logs, error: projected.error })),
	).toBeLessThan(AUTOMATION_HISTORY_LIMITS.attemptBytes);
	expect(
		projectAutomationHistoryAttempt({ ...original, artifactsPrunedAt: original.startedAt }),
	).toMatchObject({ logs: null, error: null });
	const many = projectAutomationHistoryAttempt({
		...original,
		logs: Array.from({ length: 100 }, () => ({ level: "info", message: "token=x ".repeat(30) })),
	});
	expect(many.artifactsTruncated).toBe(true);
	expect(many.logs?.length).toBeGreaterThan(0);
	expect(
		Buffer.byteLength(JSON.stringify({ logs: many.logs, error: many.error })),
	).toBeLessThanOrEqual(AUTOMATION_HISTORY_LIMITS.attemptBytes);
});

it.effect(
	"rejects malformed, oversized, noncanonical and invalid-shape cursors with one public reason",
	() =>
		Effect.gen(function* () {
			for (const cursor of [
				"",
				"!",
				"a".repeat(513),
				Buffer.from("{}").toString("base64url"),
				Buffer.from('{"queuedAt":"not-a-date","id":"run"}').toString("base64url"),
				"e30=",
			]) {
				assertExitFails(
					yield* decodeAutomationHistoryCursor(cursor).pipe(Effect.exit),
					new AutomationHistoryRequestError({ reason: { code: "invalid-cursor" } }),
				);
			}
		}),
);
