import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { AutomationRuleId } from "@ryot/contract/schema/brands";

import {
	createAuthenticatedClient,
	createEntity,
	createNotificationChannel,
	deleteNotificationRule,
	findBuiltinSchemaBySlug,
	getAutomationCatalogSchema,
	getNotificationRule,
	installNotificationRule,
	listAutomationCatalog,
	listNotificationRules,
	postBackendJson,
	setNotificationRuleActive,
	startFakeAppriseServer,
} from "~/fixtures";
import { pollUntil } from "~/fixtures/polling";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import type { FakeHttpServer } from "~/support/fake-http-server";

let fakeApprise: FakeHttpServer;

beforeAll(async () => {
	fakeApprise = await startFakeAppriseServer();
});

afterAll(() => {
	fakeApprise.stop();
});

describe("notification subscription catalog and rules", () => {
	it("installs every active catalog schema by default at signup", async () => {
		const { client } = await createAuthenticatedClient();
		const catalog = await listAutomationCatalog(client);
		const rules = await listNotificationRules(client);

		expect(catalog.map((schema) => schema.slug).sort()).toEqual([
			"integration.disabled",
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
			await Promise.all(catalog.map((schema) => getAutomationCatalogSchema(client, schema.id))),
		).toEqual([...catalog]);
	});

	it("manages only the authenticated user's rules and supports delete-reinstall", async () => {
		const owner = await createAuthenticatedClient();
		const other = await createAuthenticatedClient();
		const ownerRules = await listNotificationRules(owner.client);
		const reviewRule = requirePresent(
			ownerRules.find((rule) => rule.signalSchema.slug === "review.created"),
			"Expected the default review notification rule",
		);

		const inaccessible = await other.client.runError((c) =>
			c.automations.getRule({ path: { ruleId: AutomationRuleId.make(reviewRule.id) } }),
		);
		assertTaggedError(inaccessible, "NotFound");
		const nonexistent = await owner.client.runError((c) =>
			c.automations.getRule({
				path: { ruleId: AutomationRuleId.make(`missing-${crypto.randomUUID()}`) },
			}),
		);
		assertTaggedError(nonexistent, "NotFound");
		expect(inaccessible).toEqual(nonexistent);

		const deactivated = await setNotificationRuleActive(owner.client, reviewRule.id, false);
		expect(deactivated.isActive).toBe(false);
		const loadedDeactivated = await getNotificationRule(owner.client, reviewRule.id);
		expect(loadedDeactivated.isActive).toBe(false);
		const activated = await setNotificationRuleActive(owner.client, reviewRule.id, true);
		expect(activated.isActive).toBe(true);

		expect(await deleteNotificationRule(owner.client, reviewRule.id)).toEqual({
			id: reviewRule.id,
		});
		const reinstalled = await installNotificationRule(owner.client, reviewRule.signalSchema.id);
		expect(reinstalled.id).not.toBe(reviewRule.id);
		expect(reinstalled.name).toBe(reviewRule.name);
		expect(reinstalled.isActive).toBe(true);
		expect(reinstalled.signalSchema).toEqual(reviewRule.signalSchema);

		const conflict = await owner.client.runError((c) =>
			c.automations.installRule({
				payload: { signalSchemaId: reviewRule.signalSchema.id },
			}),
		);
		assertTaggedError(conflict, "Conflict");

		const arbitraryFields = await postBackendJson(
			"/automations/rules",
			{
				operation: "signal",
				scriptId: "caller-selected-script",
				signalSchemaId: reviewRule.signalSchema.id,
			},
			owner.cookies,
		);
		expect(arbitraryFields.status).toBe(400);
	});

	it("delivers an API-created workout through its default subscription", async () => {
		fakeApprise.requests.length = 0;
		const { client } = await createAuthenticatedClient();
		await createNotificationChannel(client, {
			channel: "apprise",
			channelSpecifics: { baseUrl: fakeApprise.url, key: "workout", kind: "apprise" },
		});
		const { schema } = await findBuiltinSchemaBySlug(client, "workout");
		const workoutName = `E2E Workout ${crypto.randomUUID()}`;
		await createEntity(client, {
			name: workoutName,
			entitySchemaId: schema.id,
			properties: { endedAt: "2026-07-21T11:00:00Z", startedAt: "2026-07-21T10:00:00Z" },
		});

		const delivered = await pollUntil("default workout notification delivery", () => {
			const request = fakeApprise.requests.find((entry) => entry.path === "/notify/workout");
			return Promise.resolve(request ?? null);
		});
		expect(delivered.body).toEqual({ title: "Ryot", body: `Workout ${workoutName} was created` });
	});
});
