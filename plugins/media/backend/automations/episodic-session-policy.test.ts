import { describe, expect, it } from "@effect/vitest";
import type { AutomationPolicyInput } from "@ryot-app/plugin-backend-sdk/automation";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";

import {
	hostSuccess,
	policyAutomationContext,
	ryotqlRows,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./episodic-session-policy.sandbox";

type BatchItem = { readonly itemIdentity: string; readonly context: AutomationPolicyInput };
const batch = (first: BatchItem, ...rest: BatchItem[]) => {
	const { payload: firstPayload, ...automation } = first.context.automation;
	return {
		automation,
		items: [
			{ payload: firstPayload, itemIdentity: first.itemIdentity },
			...rest.map(({ context, itemIdentity }) => ({
				itemIdentity,
				payload: context.automation.payload,
			})),
		],
	};
};
const run = (context: AutomationPolicyInput, parents: readonly Record<string, unknown>[] = []) =>
	definition
		.run(
			batch({ context, itemIdentity: "item" }),
			defineSandboxTestHost(manifest, {
				executeRyotql: () => hostSuccess(ryotqlRows("parents", parents)),
			}),
		)
		.pipe(Effect.map((result) => result.items[0]?.decision));

describe("episodic session policy", () => {
	it.live("returns only the session patch", () =>
		Effect.gen(function* () {
			const input = yield* policyAutomationContext({
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
	it.effect.each(["show", "podcast"] as const)(
		"assigns a %s parent to itself",
		(entitySchemaSlug) =>
			Effect.gen(function* () {
				yield* run(
					yield* policyAutomationContext({
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
				);
			}),
	);

	it.effect("retains distinct identities and decisions for each batch item", () =>
		Effect.gen(function* () {
			yield* definition
				.run(
					batch(
						{
							itemIdentity: "parent-event",
							context: yield* policyAutomationContext({
								entityId: "show-1",
								entitySchemaSlug: "show",
							}),
						},
						{
							itemIdentity: "episode-event",
							context: yield* policyAutomationContext({
								entityId: "episode-1",
								entitySchemaSlug: "show-episode",
							}),
						},
					),
					defineSandboxTestHost(manifest, {
						executeRyotql: () =>
							hostSuccess(ryotqlRows("parents", [{ seasonNumber: 1, parentEntityId: "show-1" }])),
					}),
				)
				.pipe(
					Effect.map(({ items }) => {
						expect(items).toEqual([
							{
								itemIdentity: "parent-event",
								decision: {
									action: "transform",
									patch: { resource: "event", draft: { sessionEntityId: "show-1" } },
								},
							},
							{
								itemIdentity: "episode-event",
								decision: {
									action: "transform",
									patch: { resource: "event", draft: { sessionEntityId: "show-1" } },
								},
							},
						]);
					}),
				);
		}),
	);

	it.effect("assigns a regular show episode to its show and replaces a supplied session", () =>
		Effect.gen(function* () {
			yield* run(
				yield* policyAutomationContext({
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
			);
		}),
	);

	it.effect("clears a supplied session for a season zero episode", () =>
		Effect.gen(function* () {
			yield* run(
				yield* policyAutomationContext({
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
			);
		}),
	);

	it.effect("assigns a podcast episode to its podcast", () =>
		Effect.gen(function* () {
			yield* run(
				yield* policyAutomationContext({
					entityId: "episode-1",
					entitySchemaSlug: "podcast-episode",
				}),
				[{ parentEntityId: "podcast-1" }],
			).pipe(
				Effect.map((result) => {
					expect(result).toMatchObject({
						action: "transform",
						patch: { resource: "event", draft: { sessionEntityId: "podcast-1" } },
					});
				}),
			);
		}),
	);

	it.effect("rejects an episode without one deterministic parent", () =>
		Effect.gen(function* () {
			yield* run(
				yield* policyAutomationContext({ entityId: "episode-1", entitySchemaSlug: "show-episode" }),
			).pipe(
				Effect.map((result) => {
					expect(result).toEqual({ action: "reject", reason: "episodic_parent_not_found" });
				}),
			);
		}),
	);
});
