import { expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import { mediaPlugin } from "../../manifest/plugin";
import {
	entityRecord,
	eventAutomationContext,
	hostSuccess,
	returnedChanges,
	ryotqlRows,
} from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./review-created.sandbox";

it.live(
	"emits a review signal using the inline event identity and current entity name",
	() =>
		Effect.gen(function* () {
			const result = yield* definition.run(
				yield* eventAutomationContext({
					id: "review-event-1",
					entitySchemaSlug: "book",
					eventSchemaSlug: "review",
					properties: { rating: 80 },
				}),
				defineSandboxTestHost(manifest, {
					executeRyotql: () =>
						hostSuccess(
							ryotqlRows("entities", [entityRecord({ name: "Dune", entitySchemaSlug: "book" })]),
						),
				}),
			);
			expect(returnedChanges(result).signals).toEqual([
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
	testTimeout,
);

it.live(
	"ignores non-review events and deleted subjects",
	() =>
		Effect.gen(function* () {
			const host = defineSandboxTestHost(manifest, {
				executeRyotql: () => hostSuccess(ryotqlRows("entities", [])),
			});
			expect(
				yield* definition.run(yield* eventAutomationContext({ eventSchemaSlug: "progress" }), host),
			).toEqual({});
			expect(
				yield* definition.run(yield* eventAutomationContext({ eventSchemaSlug: "review" }), host),
			).toEqual({});
		}),
	testTimeout,
);

it.live(
	"preserves review notifications for explicit kernel-owned collections",
	() =>
		Effect.gen(function* () {
			const result = yield* definition.run(
				yield* eventAutomationContext({
					id: "collection-review",
					entityId: "collection-1",
					eventSchemaPluginId: null,
					eventSchemaSlug: "review",
					entitySchemaPluginId: null,
					entitySchemaSlug: "collection",
				}),
				defineSandboxTestHost(manifest, {
					executeRyotql: () =>
						hostSuccess(
							ryotqlRows("entities", [
								entityRecord({
									name: "Favorites",
									id: "collection-1",
									entitySchemaPluginId: null,
									entitySchemaSlug: "collection",
								}),
							]),
						),
				}),
			);
			expect(returnedChanges(result).signals).toEqual([
				{
					schemaSlug: "review.created",
					discriminator: "collection-review",
					properties: {
						entityName: "Favorites",
						entityId: "collection-1",
						entitySchemaSlug: "collection",
						reviewEventId: "collection-review",
					},
				},
			]);
		}),
	testTimeout,
);
