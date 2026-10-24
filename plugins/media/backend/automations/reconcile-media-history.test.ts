import { expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";

import { eventAutomationContext } from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./reconcile-media-history.sandbox";

it.effect(
	"repairs both child scope readiness and parent correction after a child source write",
	() =>
		Effect.gen(function* () {
			const scopes: string[] = [];
			const host = defineSandboxTestHost(manifest, {
				requestUserWork: (request) => {
					scopes.push(request.scope);
					return Effect.succeed({ workId: `work:${scopes.length}` });
				},
			});
			yield* definition.run(
				eventAutomationContext({
					entityId: "child",
					sessionEntityId: "parent",
					eventSchemaSlug: "progress",
					entitySchemaSlug: "show-episode",
				}),
				host,
			);
			expect(scopes).toEqual(["parent", "child"]);
			scopes.length = 0;
			yield* definition.run(
				eventAutomationContext({
					entityId: "child",
					sessionEntityId: "parent",
					eventSchemaSlug: "complete",
					entitySchemaSlug: "show-episode",
					properties: { completionKey: "occurrence" },
				}),
				host,
			);
			expect(scopes).toEqual(["child"]);
		}),
);
