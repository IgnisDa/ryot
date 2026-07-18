import type { AutomationInput } from "@ryot-app/sandbox-sdk/automation";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { expect, it } from "vitest";

import {
	automationOccurrenceRows,
	hostSuccess,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./review-created.sandbox";

const reviewSource = {
	kind: "event" as const,
	after: {
		id: "review-event-1",
		eventSchemaSlug: "review",
		properties: { rating: 80 },
		createdAt: "2026-07-20T09:00:01.000Z",
		occurredAt: "2026-07-20T09:00:00.000Z",
		subject: { name: "Dune", id: "entity-1", entitySchemaSlug: "book" },
	},
};

const input = (origin: AutomationInput["automation"]["origin"]): AutomationInput => ({
	automation: {
		origin,
		ruleId: "rule-1",
		operation: "create",
		occurrenceId: "occurrence-1",
		occurredAt: "2026-07-20T10:00:00.000Z",
		source: { kind: "event", eventId: "review-event-1" },
	},
});

const execution = { metadata: {}, sandboxScriptId: "script-1" };

it("emits one actor signal for an API review from its event snapshot", () => {
	const calls: unknown[] = [];
	return Effect.runPromise(
		definition
			.run(
				input({ kind: "api" }),
				defineSandboxTestHost(manifest, {
					executeRyotql: () => hostSuccess(automationOccurrenceRows(reviewSource)),
					emitSignal: (request) => {
						calls.push(request);
						return Effect.succeed({ wasCreated: true, signalId: "signal-1" });
					},
				}),
				execution,
			)
			.pipe(
				Effect.map((result) => {
					expect(result).toEqual({ wasCreated: true, signalId: "signal-1" });
					expect(calls).toEqual([
						{
							schemaSlug: "review.created",
							discriminator: "review-event-1",
							properties: {
								entityName: "Dune",
								entityId: "entity-1",
								entitySchemaSlug: "book",
								reviewEventId: "review-event-1",
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
		definition
			.run(
				input(origin),
				defineSandboxTestHost(manifest, {
					executeRyotql: () => hostSuccess(automationOccurrenceRows(reviewSource)),
					emitSignal: (request) => {
						calls.push(request);
						return Effect.succeed({ wasCreated: true, signalId: "signal-1" });
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
