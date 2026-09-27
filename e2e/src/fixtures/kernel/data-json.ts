import type { ContractSuccess } from "@ryot-app/contract/client";
import { DataJsonDocument } from "@ryot-app/contract/modules/imports/data-json";
import { Effect, Option, Schema } from "effect";

import { requirePresent } from "~/support/assertions";

import type { createAuthenticatedClient, Client } from "./auth";
import { createPluginEntitySchema } from "./entity-graph";
import { createEventSchema } from "./event-schemas";
import { pollImportRunUntilTerminal, uploadImportFile } from "./imports";
import { getIntegration } from "./integrations";
import { createRelationshipSchema } from "./relationship-schemas";

type AuthenticatedClient = Effect.Success<ReturnType<typeof createAuthenticatedClient>>;
type Integration = ContractSuccess<"integrations", "create">;

const encodeDataDocument = Schema.encodeSync(Schema.fromJsonString(DataJsonDocument));

export const createDataJsonSchemaGraph = (client: Client) =>
	Effect.gen(function* () {
		const suffix = crypto.randomUUID();
		const entityA = yield* createPluginEntitySchema(client, {
			schemaName: `Data JSON A ${suffix}`,
			propertiesSchema: {
				fields: {
					relatedEntity: {
						type: "string",
						label: "Related entity",
						reference: { kind: "entity-id" },
						description: "An entity referenced by this record",
					},
				},
			},
		});
		const entityB = yield* createPluginEntitySchema(client, {
			schemaName: `Data JSON B ${suffix}`,
		});
		const relationship = yield* createRelationshipSchema(client, {
			name: `Data JSON relationship ${suffix}`,
			slug: `data-json-relationship-${suffix}`,
			sourceEntitySchemaSlug: entityA.schemaId,
			targetEntitySchemaSlug: entityB.schemaId,
		});
		const event = yield* createEventSchema(client, {
			name: `Data JSON event ${suffix}`,
			slug: `data-json-event-${suffix}`,
			entitySchemaSlug: entityA.schemaId,
			propertiesSchema: {
				fields: {
					details: {
						type: "object",
						label: "Details",
						description: "Nested data references",
						properties: {
							entityReference: {
								type: "string",
								label: "Entity reference",
								description: "Referenced entity",
								reference: { kind: "entity-id" },
							},
							relationshipReference: {
								type: "string",
								label: "Relationship reference",
								description: "Referenced relationship",
								reference: { kind: "relationship-id" },
							},
						},
					},
				},
			},
		});

		return { event, entityA, entityB, relationship };
	});

export const submitDataJsonImport = (
	user: AuthenticatedClient,
	document: DataJsonDocument,
	submissionKey?: string,
) =>
	Effect.gen(function* () {
		const uploadToken = yield* uploadImportFile(
			user.token,
			encodeDataDocument(document),
			"data.json",
			"application/json",
		);
		const created = yield* user.client.call((c) =>
			c.imports.createRun({
				payload: {
					uploadToken,
					source: "data-json",
					...(submissionKey === undefined ? {} : { submissionKey }),
				},
			}),
		);
		return { ...created, uploadToken };
	});

export const startDataJsonImport = (
	user: AuthenticatedClient,
	document: DataJsonDocument,
	submissionKey?: string,
) =>
	Effect.gen(function* () {
		const created = yield* submitDataJsonImport(user, document, submissionKey);
		const run = yield* pollImportRunUntilTerminal(user.client, created.id);
		return { run, runId: created.id };
	});

export const sendDataWebhook = (
	client: Client,
	integration: Integration,
	document: DataJsonDocument,
	submissionKey: string,
) =>
	Effect.gen(function* () {
		const detail = requirePresent(
			Option.getOrUndefined(yield* getIntegration(client, integration.id)),
			"Expected data JSON integration detail",
		);
		const webhookToken = requirePresent(detail.webhookToken, "Expected data JSON webhook token");
		const response = yield* client.call((c) =>
			c.integrations.webhook({
				params: { webhookToken },
				payload: encodeDataDocument(document),
				headers: { "idempotency-key": submissionKey },
			}),
		);
		return response.runId;
	});
