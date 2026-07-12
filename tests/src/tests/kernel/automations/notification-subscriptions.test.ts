import { AutomationRuleId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createBuiltinMediaLifecycleFixture,
	createEntity,
	createNotificationChannel,
	deleteNotificationRule,
	findBuiltinSchemaBySlug,
	getAutomationCatalogSchema,
	getEntity,
	getNotificationRule,
	installNotificationRule,
	listAutomationCatalog,
	listNotificationRules,
	pollUntil,
	postBackendJson,
	setNotificationRuleActive,
	startFakeAppriseServer,
} from "~/fixtures";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { afterAll, beforeAll, describe, expect, it } from "~/support/effect-test";
import type { FakeHttpServer } from "~/support/fake-http-server";

let fakeApprise: FakeHttpServer;

beforeAll(async () => {
	fakeApprise = await startFakeAppriseServer();
});

afterAll(() => {
	fakeApprise.stop();
});

describe("notification subscription catalog and rules", () => {
	it.live("installs every active catalog schema by default at signup", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const catalog = yield* listAutomationCatalog(client);
			const rules = yield* listNotificationRules(client);

			expect(catalog.map((schema) => schema.slug).sort()).toEqual([
				"company.media-group.associated",
				"company.media.associated",
				"integration.disabled",
				"media.content-count.changed",
				"media.episode.discovered",
				"media.episode.images.changed",
				"media.episode.name.changed",
				"media.release-date.changed",
				"media.season-count.changed",
				"media.status.changed",
				"person.media-group.associated",
				"person.media.associated",
				"review.created",
				"workout.created",
			]);
			expect(catalog.some((schema) => schema.slug.startsWith("automation.test-"))).toBe(false);
			expect(rules).toHaveLength(catalog.length);
			expect(rules.map((rule) => rule.signalSchema.id).sort()).toEqual(
				catalog.map((schema) => schema.id).sort(),
			);
			expect(rules.every((rule) => rule.isActive)).toBe(true);
			expect(
				yield* Effect.all(catalog.map((schema) => getAutomationCatalogSchema(client, schema.id))),
			).toEqual([...catalog]);
		}),
	);

	it.live("manages only the authenticated user's rules and supports delete-reinstall", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const other = yield* createAuthenticatedClient();
			const ownerRules = yield* listNotificationRules(owner.client);
			const reviewRule = requirePresent(
				ownerRules.find((rule) => rule.signalSchema.slug === "review.created"),
				"Expected the default review notification rule",
			);

			const inaccessible = yield* Effect.flip(
				other.client.call((c) =>
					c.automations.getRule({ params: { ruleId: AutomationRuleId.make(reviewRule.id) } }),
				),
			);
			assertTaggedError(inaccessible, "NotFound");
			const nonexistent = yield* Effect.flip(
				owner.client.call((c) =>
					c.automations.getRule({
						params: { ruleId: AutomationRuleId.make(`missing-${crypto.randomUUID()}`) },
					}),
				),
			);
			assertTaggedError(nonexistent, "NotFound");
			expect(inaccessible).toEqual(nonexistent);

			const deactivated = yield* setNotificationRuleActive(owner.client, reviewRule.id, false);
			expect(deactivated.isActive).toBe(false);
			const loadedDeactivated = yield* getNotificationRule(owner.client, reviewRule.id);
			expect(loadedDeactivated.isActive).toBe(false);
			const activated = yield* setNotificationRuleActive(owner.client, reviewRule.id, true);
			expect(activated.isActive).toBe(true);

			expect(yield* deleteNotificationRule(owner.client, reviewRule.id)).toEqual({
				id: reviewRule.id,
			});
			const reinstalled = yield* installNotificationRule(owner.client, reviewRule.signalSchema.id);
			expect(reinstalled.id).not.toBe(reviewRule.id);
			expect(reinstalled.name).toBe(reviewRule.name);
			expect(reinstalled.isActive).toBe(true);
			expect(reinstalled.signalSchema).toEqual(reviewRule.signalSchema);

			const conflict = yield* Effect.flip(
				owner.client.call((c) =>
					c.automations.installRule({
						payload: { signalSchemaSlug: reviewRule.signalSchema.id },
					}),
				),
			);
			assertTaggedError(conflict, "Conflict");

			const arbitraryFields = yield* Effect.promise(() =>
				postBackendJson(
					"/automations/rules",
					{
						operation: "signal",
						scriptId: "caller-selected-script",
						signalSchemaSlug: reviewRule.signalSchema.id,
					},
					owner.cookies,
				),
			);
			expect(arbitraryFields.status).toBe(400);
		}),
	);

	it.live("delivers an API-created workout through its default subscription", () =>
		Effect.gen(function* () {
			fakeApprise.requests.length = 0;
			const { client } = yield* createAuthenticatedClient();
			yield* createNotificationChannel(client, {
				channel: "apprise",
				channelSpecifics: { baseUrl: fakeApprise.url, key: "workout", kind: "apprise" },
			});
			const { schema } = yield* findBuiltinSchemaBySlug(client, "workout");
			const workoutName = `E2E Workout ${crypto.randomUUID()}`;
			yield* createEntity(client, {
				name: workoutName,
				entitySchemaSlug: schema.id,
				properties: { endedAt: "2026-07-21T11:00:00Z", startedAt: "2026-07-21T10:00:00Z" },
			});

			const delivered = yield* pollUntil(
				"default workout notification delivery",
				Effect.sync(
					() => fakeApprise.requests.find((entry) => entry.path === "/notify/workout") ?? null,
				),
			);
			expect(delivered.body).toEqual({ title: "Ryot", body: `Workout ${workoutName} was created` });
		}),
	);

	it.live("delivers an API-created review through its default subscription", () =>
		Effect.gen(function* () {
			fakeApprise.requests.length = 0;
			const { client } = yield* createAuthenticatedClient();
			yield* createNotificationChannel(client, {
				channel: "apprise",
				channelSpecifics: { baseUrl: fakeApprise.url, key: "review", kind: "apprise" },
			});
			const { entityId, reviewEventSchemaSlug } = yield* createBuiltinMediaLifecycleFixture(client);
			const entity = yield* getEntity(client, entityId);

			yield* client.call((c) =>
				c.events.create({
					payload: [
						{ entityId, eventSchemaSlug: reviewEventSchemaSlug, properties: { rating: 8 } },
					],
				}),
			);

			const delivered = yield* pollUntil(
				"default review notification delivery",
				Effect.sync(
					() => fakeApprise.requests.find((entry) => entry.path === "/notify/review") ?? null,
				),
			);
			expect(delivered.body).toEqual({ title: "Ryot", body: `Review posted for ${entity.name}` });
		}),
	);
});
