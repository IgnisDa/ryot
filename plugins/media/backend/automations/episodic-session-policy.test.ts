import { describe, expect, it } from "@effect/vitest";
import type { AutomationPolicyInput } from "@ryot-app/sandbox-sdk/automation";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";

import {
	hostSuccess,
	policyAutomationContext,
	ryotqlRows,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./episodic-session-policy.sandbox";

const run = (context: AutomationPolicyInput, parents: readonly Record<string, unknown>[] = []) =>
	// oxlint-disable-next-line effecttsgo/unnecessary-effect-gen -- Unifies the policy's union of Effect return types
	Effect.gen(function* () {
		return yield* definition.run(
			context,
			defineSandboxTestHost(manifest, {
				executeRyotql: () => hostSuccess(ryotqlRows("parents", parents)),
			}),
		);
	});

describe("episodic session policy", () => {
	it.live("returns only the session patch", () =>
		Effect.gen(function* () {
			const input = policyAutomationContext({
				entityId: "episode-1",
				eventSchemaSlug: "progress",
				sessionEntityId: "wrong-show",
				entitySchemaSlug: "show-episode",
				occurredAt: "2026-02-01T00:00:00.000Z",
				properties: { consumedOn: "Plex", progressPercent: 42.125 },
			});
			const result = yield* run(input, [{ seasonNumber: 1, parentEntityId: "show-1" }]);
			expect(result).toEqual({
				action: "transform",
				patch: { resource: "event", draft: { sessionEntityId: "show-1" } },
			});
		}),
	);
	it.each(["show", "podcast"] as const)("assigns a %s parent to itself", (entitySchemaSlug) =>
		Effect.runPromise(
			run(
				policyAutomationContext({
					entitySchemaSlug,
					sessionEntityId: "wrong-parent",
					entityId: `${entitySchemaSlug}-1`,
				}),
			).pipe(
				Effect.map((result) => {
					expect(result).toMatchObject({
						action: "transform",
						patch: { resource: "event", draft: { sessionEntityId: `${entitySchemaSlug}-1` } },
					});
				}),
			),
		),
	);

	it("assigns a regular show episode to its show and replaces a supplied session", () =>
		Effect.runPromise(
			run(
				policyAutomationContext({
					entityId: "episode-1",
					sessionEntityId: "wrong-show",
					entitySchemaSlug: "show-episode",
				}),
				[{ seasonNumber: 1, parentEntityId: "show-1" }],
			).pipe(
				Effect.map((result) => {
					expect(result).toMatchObject({
						action: "transform",
						patch: { resource: "event", draft: { sessionEntityId: "show-1" } },
					});
				}),
			),
		));

	it("clears a supplied session for a season zero episode", () =>
		Effect.runPromise(
			run(
				policyAutomationContext({
					entityId: "special-1",
					sessionEntityId: "show-1",
					entitySchemaSlug: "show-episode",
				}),
				[{ seasonNumber: 0, parentEntityId: "show-1" }],
			).pipe(
				Effect.map((result) => {
					expect(result).toMatchObject({
						action: "transform",
						patch: { resource: "event", draft: { sessionEntityId: null } },
					});
				}),
			),
		));

	it("assigns a podcast episode to its podcast", () =>
		Effect.runPromise(
			run(policyAutomationContext({ entityId: "episode-1", entitySchemaSlug: "podcast-episode" }), [
				{ parentEntityId: "podcast-1" },
			]).pipe(
				Effect.map((result) => {
					expect(result).toMatchObject({
						action: "transform",
						patch: { resource: "event", draft: { sessionEntityId: "podcast-1" } },
					});
				}),
			),
		));

	it("rejects an episode without one deterministic parent", () =>
		Effect.runPromise(
			run(
				policyAutomationContext({ entityId: "episode-1", entitySchemaSlug: "show-episode" }),
			).pipe(
				Effect.map((result) => {
					expect(result).toEqual({ action: "reject", reason: "episodic_parent_not_found" });
				}),
			),
		));
});
