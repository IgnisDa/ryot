import { afterEach, describe, expect, it } from "bun:test";

import { SignalSchemaId } from "@ryot/contract/schema/brands";

import {
	cleanupHiddenSignalSchema,
	createAuthenticatedClient,
	getSignalSchema,
	getSignalSchemaIdBySlug,
	listSignalSchemas,
	seedHiddenSignalSchema,
	type SeededSignalSchema,
} from "../fixtures";
import { assertTaggedError } from "../test-support/assertions";

const MEDIA_STATUS_CHANGED_SLUG = "media.status.changed";

let hidden: SeededSignalSchema | undefined;

afterEach(async () => {
	if (hidden) {
		await cleanupHiddenSignalSchema(hidden);
		hidden = undefined;
	}
});

describe("signal schemas catalog", () => {
	it("lists active builtins including a known slug", async () => {
		const { client } = await createAuthenticatedClient();
		const schemas = await listSignalSchemas(client);
		expect(schemas.length).toBeGreaterThan(0);
		expect(schemas.some((schema) => schema.slug === MEDIA_STATUS_CHANGED_SLUG)).toBe(true);
	});

	it("excludes a hidden schema from the list and 404s on direct get", async () => {
		const { client } = await createAuthenticatedClient();
		hidden = await seedHiddenSignalSchema();

		const schemas = await listSignalSchemas(client);
		expect(schemas.some((schema) => schema.slug === hidden?.slug)).toBe(false);

		const error = await client.runError((c) =>
			c.automations.getSignalSchema({
				path: { signalSchemaId: SignalSchemaId.make(hidden?.id ?? "") },
			}),
		);
		assertTaggedError(error, "NotFound");
	});

	it("returns slug/name/propertiesSchema for an active schema and NotFound for a random id", async () => {
		const { client } = await createAuthenticatedClient();
		const activeId = await getSignalSchemaIdBySlug(MEDIA_STATUS_CHANGED_SLUG);

		const schema = await getSignalSchema(client, activeId);
		expect(schema.slug).toBe(MEDIA_STATUS_CHANGED_SLUG);
		expect(typeof schema.name).toBe("string");
		expect(schema.propertiesSchema).toBeDefined();

		const error = await client.runError((c) =>
			c.automations.getSignalSchema({
				path: { signalSchemaId: SignalSchemaId.make(crypto.randomUUID()) },
			}),
		);
		assertTaggedError(error, "NotFound");
	});
});
