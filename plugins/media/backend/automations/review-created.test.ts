import { expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";

import { mediaPlugin } from "../../host/plugin";
import {
	entityRecord,
	eventAutomationContext,
	hostSuccess,
	ryotqlRows,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./review-created.sandbox";

it.live("emits a review signal using the inline event identity and current entity name", () =>
	Effect.gen(function* () {
		const calls: unknown[] = [];
		yield* definition.run(
			eventAutomationContext({
				id: "review-event-1",
				entitySchemaSlug: "book",
				eventSchemaSlug: "review",
				properties: { rating: 80 },
			}),
			defineSandboxTestHost(manifest, {
				emitSignal: (request) => {
					calls.push(request);
					return hostSuccess({ wasCreated: true, triggerId: "signal-1" });
				},
				executeRyotql: () =>
					hostSuccess(
						ryotqlRows("entities", [entityRecord({ name: "Dune", entitySchemaSlug: "book" })]),
					),
			}),
		);
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
		expect(mediaPlugin.hooks.find(({ slug }) => slug === "media.review-created")).toMatchObject({
			causationSources: ["api"],
		});
	}),
);

it.live("ignores non-review events and deleted subjects", () =>
	Effect.gen(function* () {
		const calls: unknown[] = [];
		const host = defineSandboxTestHost(manifest, {
			executeRyotql: () => hostSuccess(ryotqlRows("entities", [])),
			emitSignal: (request) => {
				calls.push(request);
				return hostSuccess({ wasCreated: true, triggerId: "signal-1" });
			},
		});
		yield* definition.run(eventAutomationContext({ eventSchemaSlug: "progress" }), host);
		yield* definition.run(eventAutomationContext({ eventSchemaSlug: "review" }), host);
		expect(calls).toEqual([]);
	}),
);
