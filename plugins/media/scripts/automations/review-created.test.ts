import type { AutomationInput } from "@ryot/sandbox-sdk/automation";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot/sandbox-sdk/testing";
import { expect, it } from "vitest";

import definition, { manifest } from "./review-created.sandbox";

const input = (origin: AutomationInput["automation"]["origin"]): AutomationInput => ({
	automation: {
		origin,
		ruleId: "rule-1",
		operation: "create",
		occurrenceId: "occurrence-1",
		occurredAt: "2026-07-20T10:00:00.000Z",
		source: {
			kind: "event",
			after: {
				id: "review-event-1",
				eventSchemaSlug: "review",
				properties: { rating: 80 },
				occurredAt: "2026-07-20T09:00:00.000Z",
				subject: { id: "entity-1", name: "Dune", entitySchemaSlug: "book" },
			},
		},
	},
});

const execution = { metadata: {}, sandboxScriptId: "script-1" };

it("emits one actor signal for an API review from its event snapshot", () => {
	const calls: unknown[] = [];
	return Effect.runPromise(
		definition.drivers.automation
			.run(
				input({ kind: "api" }),
				defineSandboxTestHost(manifest, {
					emitSignal: (request) => {
						calls.push(request);
						return Effect.succeed({ signalId: "signal-1", wasCreated: true });
					},
				}),
				execution,
			)
			.pipe(
				Effect.map((result) => {
					expect(result).toEqual({ signalId: "signal-1", wasCreated: true });
					expect(calls).toEqual([
						{
							discriminator: "review-event-1",
							schemaSlug: "review.created",
							properties: {
								entityId: "entity-1",
								entityName: "Dune",
								reviewEventId: "review-event-1",
								entitySchemaSlug: "book",
							},
						},
					]);
					return undefined;
				}),
			),
	);
});

it.each([
	{ kind: "bootstrap" } as const,
	{ kind: "provider_refresh" } as const,
	{ kind: "import", importRunId: "import-1" } as const,
	{ kind: "integration", integrationId: "integration-1" } as const,
	{ kind: "automation", executionId: "execution-1" } as const,
])("does not emit for the $kind origin", (origin) => {
	const calls: unknown[] = [];
	return Effect.runPromise(
		definition.drivers.automation
			.run(
				input(origin),
				defineSandboxTestHost(manifest, {
					emitSignal: (request) => {
						calls.push(request);
						return Effect.succeed({ signalId: "signal-1", wasCreated: true });
					},
				}),
				execution,
			)
			.pipe(
				Effect.map((result) => {
					expect(result).toBeNull();
					expect(calls).toEqual([]);
					return undefined;
				}),
			),
	);
});
