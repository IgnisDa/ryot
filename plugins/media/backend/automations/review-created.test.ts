import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { expect, it } from "vitest";

import { mediaPlugin } from "../../host/plugin";
import {
	entityRecord,
	eventAutomationContext,
	execution,
	hostSuccess,
	ryotqlRows,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./review-created.sandbox";

it("emits a review signal using the inline event identity and current entity name", async () => {
	const calls: unknown[] = [];
	await Effect.runPromise(
		definition.run(
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
			execution,
		),
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
});

it("ignores non-review events and deleted subjects", async () => {
	const calls: unknown[] = [];
	const host = defineSandboxTestHost(manifest, {
		executeRyotql: () => hostSuccess(ryotqlRows("entities", [])),
		emitSignal: (request) => {
			calls.push(request);
			return hostSuccess({ wasCreated: true, triggerId: "signal-1" });
		},
	});
	await Effect.runPromise(
		definition.run(eventAutomationContext({ eventSchemaSlug: "progress" }), host, execution),
	);
	await Effect.runPromise(
		definition.run(eventAutomationContext({ eventSchemaSlug: "review" }), host, execution),
	);
	expect(calls).toEqual([]);
});
