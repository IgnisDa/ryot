import { automationPolicyInputSchema } from "@ryot-app/plugin-backend-sdk/automation";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { describe, expect, it } from "vitest";

import definition, { manifest } from "./workout-context-policy.sandbox";

const timestamp = "2026-01-01T08:00:00.000Z";

const policyInput = (payload: unknown, executionUserId: string | null = "user-1") =>
	Schema.decodeUnknownSync(automationPolicyInputSchema)({
		automation: {
			payload,
			runId: "run-1",
			executionUserId,
			occurredAt: timestamp,
			triggerId: "trigger-1",
			hookSlug: "fitness.workout-context",
			causation: {
				depth: 0,
				source: "api",
				parentRunId: null,
				lane: "interactive",
				parentTriggerId: null,
				executionId: "execution-1",
				rootExecutionId: "execution-1",
				initiator: { kind: "user", id: "user-1" },
			},
		},
	});

const eventDraft = (
	properties: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
) => ({
	properties,
	entityId: "exercise-1",
	sessionEntityId: "workout-1",
	entitySchemaSlug: "exercise",
	eventSchemaSlug: "workout-set",
	eventSchemaPluginId: "fitness-owner",
	entitySchemaPluginId: "fitness-owner",
	occurredAt: "2026-01-01T09:00:00.000Z",
	...overrides,
});

const contextResponse = (
	options: { readonly kind?: string | null; readonly startedAt?: string | null } = {},
) => ({
	data: {
		exercise: {
			type: "rows" as const,
			pageInfo: { limit: 2, hasMore: false, nextCursor: null },
			items: [
				{ id: "exercise-1", kind: options.kind === undefined ? "reps_and_weight" : options.kind },
			],
		},
		workout: {
			type: "rows" as const,
			pageInfo: { limit: 2, hasMore: false, nextCursor: null },
			items: [
				{
					id: "workout-1",
					startedAt: options.startedAt === undefined ? timestamp : options.startedAt,
				},
			],
		},
	},
});

const run = (input: ReturnType<typeof policyInput>, response: unknown, calls: unknown[] = []) =>
	definition.run(
		input,
		defineSandboxTestHost(manifest, {
			executeRyotql: (document) => {
				calls.push(document);
				return Effect.succeed(response);
			},
		}),
	);

describe("workout context policy", () => {
	it("preserves supplied times for unconfirmed creates and updates", () => {
		const create = policyInput({
			resource: "event",
			category: "request",
			operation: "create",
			draft: eventDraft({}, { occurredAt: "2026-01-01T07:30:00.000Z" }),
		});
		const update = policyInput({
			resource: "event",
			category: "request",
			operation: "update",
			changedProperties: [],
			draft: eventDraft({}, { occurredAt: "2026-01-01T07:45:00.000Z" }),
			before: { ...eventDraft({}), id: "event-1", createdAt: timestamp, updatedAt: timestamp },
		});

		return Effect.runPromise(
			Effect.gen(function* () {
				expect(yield* run(create, contextResponse())).toEqual({ action: "allow" });
				expect(yield* run(update, contextResponse())).toEqual({ action: "allow" });
			}),
		);
	});

	it("uses a confirmed time and rejects missing event context", () => {
		const confirmed = policyInput({
			resource: "event",
			category: "request",
			operation: "create",
			draft: eventDraft({ confirmedAt: "2026-01-01T08:45:00.000Z" }),
		});
		const missingStart = policyInput({
			resource: "event",
			category: "request",
			operation: "create",
			draft: eventDraft({}),
		});
		const missingSession = policyInput({
			resource: "event",
			category: "request",
			operation: "create",
			draft: eventDraft({}, { sessionEntityId: null }),
		});

		return Effect.runPromise(
			Effect.gen(function* () {
				expect(yield* run(confirmed, contextResponse())).toEqual({
					action: "transform",
					patch: { resource: "event", draft: { occurredAt: "2026-01-01T08:45:00.000Z" } },
				});
				expect(yield* run(missingStart, contextResponse({ startedAt: null }))).toEqual({
					action: "reject",
					reason: "workout_set_context_missing",
				});
				expect(yield* run(missingSession, contextResponse())).toEqual({
					action: "reject",
					reason: "workout_set_context_missing",
				});
			}),
		);
	});

	it("rejects an invalid confirmed time", () => {
		const input = policyInput({
			resource: "event",
			category: "request",
			operation: "create",
			draft: eventDraft({ confirmedAt: "not-a-date" }),
		});

		return Effect.runPromise(
			run(input, contextResponse()).pipe(
				Effect.map((result) => {
					expect(result).toEqual({ action: "reject", reason: "workout_set_confirmed_at_invalid" });
				}),
			),
		);
	});
});
