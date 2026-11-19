import type { ContractSuccess } from "@ryot-app/contract/client";
import {
	DataJsonDocument,
	dataJsonSourceReference,
} from "@ryot-app/contract/modules/imports/data-json";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect, Option, Schema } from "effect";

import { manifestText } from "~/fixtures/kernel/manifest-text";
import { requirePresent } from "~/support/assertions";

import type { Client, createAuthenticatedClient } from "./auth";
import { createPluginEntitySchema } from "./entity-graph";
import { createEventSchema } from "./event-schemas";
import { pollImportRunUntilTerminal, uploadImportFile } from "./imports";
import { getIntegration } from "./integrations";
import { createPluginScope } from "./plugins";
import { createRelationshipSchema } from "./relationship-schemas";

type Integration = ContractSuccess<"integrations", "create">;
type AuthenticatedClient = Effect.Success<ReturnType<typeof createAuthenticatedClient>>;

const encodeDataDocument = (document: DataJsonDocument) =>
	Schema.encodeEffect(Schema.fromJsonString(DataJsonDocument))(document).pipe(Effect.orDie);

export const createDataJsonSchemaGraph = (client: Client) =>
	Effect.gen(function* () {
		const suffix = yield* randomUuid;
		const pluginSlug = createPluginScope();
		const entityA = yield* createPluginEntitySchema(client, {
			pluginSlug,
			schemaName: `Data JSON A ${suffix}`,
			propertiesSchema: {
				fields: {
					relatedEntity: {
						type: "string",
						reference: { kind: "entity-id" },
						label: manifestText("Related entity"),
						description: "An entity referenced by this record",
					},
				},
			},
		});
		const entityB = yield* createPluginEntitySchema(client, {
			pluginSlug,
			schemaName: `Data JSON B ${suffix}`,
		});
		const relationship = yield* createRelationshipSchema(client, {
			pluginSlug,
			slug: `data-json-relationship-${suffix}`,
			sourceEntitySchemaSlug: entityA.schemaId,
			targetEntitySchemaSlug: entityB.schemaId,
			name: manifestText(`Data JSON relationship ${suffix}`),
		});
		const event = yield* createEventSchema(client, {
			entitySchema: entityA.reference,
			slug: `data-json-event-${suffix}`,
			name: manifestText(`Data JSON event ${suffix}`),
			propertiesSchema: {
				fields: {
					details: {
						type: "object",
						label: manifestText("Details"),
						description: "Nested data references",
						properties: {
							entityReference: {
								type: "string",
								description: "Referenced entity",
								reference: { kind: "entity-id" },
								label: manifestText("Entity reference"),
							},
							relationshipReference: {
								type: "string",
								description: "Referenced relationship",
								reference: { kind: "relationship-id" },
								label: manifestText("Relationship reference"),
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
			user.client,
			yield* encodeDataDocument(document),
			"data.json",
			"application/json",
		);
		const created = yield* user.client.call((c) =>
			c.imports.createRun({
				payload: {
					uploadToken,
					source: dataJsonSourceReference,
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
		const payload = yield* encodeDataDocument(document);
		const response = yield* client.call((c) =>
			c.integrations.webhook({
				payload,
				params: { webhookToken },
				headers: { "idempotency-key": submissionKey },
			}),
		);
		return response.runId;
	});
