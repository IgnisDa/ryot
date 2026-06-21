import type { AutomationPolicyInput } from "@ryot-app/sandbox-sdk/automation";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import {
	execution,
	hostSuccess,
	policyAutomationContext,
	ryotqlRows,
} from "./automation-test-utils";
import definition, { manifest } from "./episodic-session-policy.sandbox";

const run = (context: AutomationPolicyInput, parents: readonly Record<string, unknown>[] = []) =>
	definition.run(
		context,
		defineSandboxTestHost(manifest, {
			executeRyotql: () => hostSuccess(ryotqlRows("parents", parents)),
		}),
		execution,
	);

describe("episodic session policy", () => {
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
					expect(result).toEqual({
						action: "replace",
						body: { sessionEntityId: `${entitySchemaSlug}-1` },
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
				[{ parentEntityId: "show-1", seasonNumber: 1 }],
			).pipe(
				Effect.map((result) => {
					expect(result).toEqual({ action: "replace", body: { sessionEntityId: "show-1" } });
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
				[{ parentEntityId: "show-1", seasonNumber: 0 }],
			).pipe(
				Effect.map((result) => {
					expect(result).toEqual({ action: "replace", body: { sessionEntityId: null } });
				}),
			),
		));

	it("assigns a podcast episode to its podcast", () =>
		Effect.runPromise(
			run(policyAutomationContext({ entityId: "episode-1", entitySchemaSlug: "podcast-episode" }), [
				{ parentEntityId: "podcast-1" },
			]).pipe(
				Effect.map((result) => {
					expect(result).toEqual({ action: "replace", body: { sessionEntityId: "podcast-1" } });
				}),
			),
		));

	it("skips an episode without one deterministic parent", () =>
		Effect.runPromise(
			run(
				policyAutomationContext({ entityId: "episode-1", entitySchemaSlug: "show-episode" }),
			).pipe(
				Effect.map((result) => {
					expect(result).toEqual({ action: "skip", reason: "episodic_parent_not_found" });
				}),
			),
		));
});
