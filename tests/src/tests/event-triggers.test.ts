import { describe, expect, it } from "bun:test";
import {
	createAuthenticatedClient,
	createBuiltinMediaLifecycleFixture,
	waitForEventCount,
} from "../fixtures";

async function pollForEventWithSchema(
	client: Awaited<ReturnType<typeof createAuthenticatedClient>>["client"],
	cookies: string,
	entityId: string,
	eventSchemaSlug: string,
) {
	for (let attempt = 0; attempt < 30; attempt++) {
		const events = await client.GET("/events", {
			headers: { Cookie: cookies },
			params: { query: { entityId } },
		});
		const found = events.data?.data.find(
			(event) => event.eventSchemaSlug === eventSchemaSlug,
		);
		if (found) {
			return found;
		}

		await Bun.sleep(500);
	}

	throw new Error(
		`Timed out waiting for '${eventSchemaSlug}' event on '${entityId}'`,
	);
}

describe("Event trigger firing", () => {
	it("logging 100% progress creates a completion event via builtin trigger", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } =
			await createBuiltinMediaLifecycleFixture(client, cookies, userId);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100 },
				},
			],
		});

		const completionEvent = await pollForEventWithSchema(
			client,
			cookies,
			entityId,
			"complete",
		);

		expect(completionEvent.eventSchemaSlug).toBe("complete");
		expect(completionEvent.properties).toMatchObject({
			completionMode: "just_now",
		});
	}, 20_000);

	it("logging less than 100% progress does not create a completion event", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } =
			await createBuiltinMediaLifecycleFixture(client, cookies, userId);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					properties: { progressPercent: 50 },
					eventSchemaId: progressEventSchemaId,
				},
			],
		});

		await waitForEventCount(client, cookies, entityId, 1);

		const events = await client.GET("/events", {
			headers: { Cookie: cookies },
			params: { query: { entityId } },
		});
		const completeEvent = events.data?.data.find(
			(event) => event.eventSchemaSlug === "complete",
		);

		expect(completeEvent).toBeUndefined();
	}, 20_000);

	it("logging 100% progress twice creates two completion events", async () => {
		const { client, cookies, userId } = await createAuthenticatedClient();

		const { entityId, progressEventSchemaId } =
			await createBuiltinMediaLifecycleFixture(client, cookies, userId);

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100 },
				},
			],
		});

		await pollForEventWithSchema(client, cookies, entityId, "complete");

		await client.POST("/events", {
			headers: { Cookie: cookies },
			body: [
				{
					entityId,
					eventSchemaId: progressEventSchemaId,
					properties: { progressPercent: 100 },
				},
			],
		});

		await waitForEventCount(client, cookies, entityId, 4);

		const allEvents = await client.GET("/events", {
			headers: { Cookie: cookies },
			params: { query: { entityId } },
		});
		const completeEvents = allEvents.data?.data.filter(
			(event) => event.eventSchemaSlug === "complete",
		);

		expect(completeEvents?.length).toBe(2);
	}, 20_000);
});
