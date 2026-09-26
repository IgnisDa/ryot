import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import {
	SavedViewReference,
	type PluginIdentityReference,
} from "@ryot-app/contract/modules/plugins/references";
import { PluginInstallationHealth } from "@ryot-app/contract/modules/plugins/schemas";
import {
	PluginPackageId,
	pluginPackageSegments,
	PluginId,
	EntityId,
	SandboxProviderId,
} from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	join,
	literal,
	pluginId,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Effect, Result, Schema } from "effect";

import type { Client } from "./auth";
import type { PluginPackageInput } from "./compiled-package";
import { pollUntil } from "./polling";
import { installPrivatePluginPackage } from "./private-plugin";
import { executeRyotQLRecipe } from "./ryotql";
import { providerSandboxSource } from "./sandbox-provider";
import { uploadPrivatePluginPackage } from "./temporary-archive";
import { encodePluginSourceFiles, testPluginManifest, testPluginPackageId } from "./test-plugin";

type NamespaceInstallResult = ContractSuccess<"plugins", "install">;
type NamespaceInvocation = ContractPayload<"plugins", "invoke">;

const entity = table("entity", "namespaceEntity");
const definition = table("entitySchema", "namespaceDefinition");
const plugin = table("plugin", "namespacePlugin");
const installationTable = table("pluginInstallation", "namespaceInstallation");

export const namespaceInstallationsRecipe = defineRecipe(() => ({
	map: ({ installations }) => Result.succeed(installations.items),
	queries: {
		installations: selectedRows(installationTable, {
			limit: 100,
			orderBy: [ascending(column(installationTable, "id"))],
			where: eq(column(plugin, "status"), literal("active")),
			joins: [
				join("inner", plugin, eq(column(plugin, "id"), column(installationTable, "pluginId"))),
			],
			selection: {
				pluginId: selectedField(column(plugin, "id"), PluginId),
				name: selectedField(column(plugin, "name"), Schema.String),
				version: selectedField(column(plugin, "version"), Schema.String),
				id: selectedField(column(installationTable, "id"), Schema.String),
				packageId: selectedField(column(plugin, "packageId"), PluginPackageId),
				contentHash: selectedField(column(plugin, "contentHash"), Schema.String),
				activationId: selectedField(column(plugin, "activationId"), Schema.String),
				isHidden: selectedField(column(installationTable, "isHidden"), Schema.Boolean),
				scope: selectedField(column(plugin, "scope"), Schema.Literals(["system", "user"])),
				activeRevisionId: selectedField(column(plugin, "activeRevisionId"), Schema.String),
				health: selectedField(column(installationTable, "health"), PluginInstallationHealth),
				isInitialized: selectedField(column(installationTable, "isInitialized"), Schema.Boolean),
				homeSavedView: selectedField(
					column(installationTable, "homeSavedView"),
					Schema.NullOr(SavedViewReference),
				),
				incompatibilityReason: selectedField(
					column(installationTable, "incompatibilityReason"),
					Schema.NullOr(Schema.Literal("package-identity-conflict")),
				),
			},
		}),
	},
}));

export const listNamespaceInstallations = (client: Client) =>
	executeRyotQLRecipe(client, namespaceInstallationsRecipe());

const namespaceProvider = table("sandboxProvider", "namespaceProvider");
const namespaceRelationship = table("relationship", "namespaceRelationship");
const namespaceSubscription = table("notificationSubscription", "namespaceSubscription");
export const namespaceProvidersRecipe = defineRecipe((reference: PluginIdentityReference) => ({
	map: ({ providers }) => Result.succeed(providers.items),
	queries: {
		providers: selectedRows(namespaceProvider, {
			limit: 100,
			orderBy: [ascending(column(namespaceProvider, "id"))],
			where: and(
				eq(column(namespaceProvider, "pluginId"), pluginId(reference)),
				eq(column(namespaceProvider, "slug"), literal("catalog")),
			),
			selection: {
				id: selectedField(column(namespaceProvider, "id"), SandboxProviderId),
				root: selectedField(column(namespaceProvider, "rootEntitySchemaSlug"), Schema.String),
			},
		}),
	},
}));
export const namespaceRelationshipsRecipe = defineRecipe((reference: PluginIdentityReference) => ({
	map: ({ relationships }) => Result.succeed(relationships.items),
	queries: {
		relationships: selectedRows(namespaceRelationship, {
			limit: 100,
			orderBy: [ascending(column(namespaceRelationship, "id"))],
			where: eq(column(namespaceRelationship, "relationshipSchemaPluginId"), pluginId(reference)),
			selection: {
				sourceId: selectedField(column(namespaceRelationship, "sourceEntityId"), EntityId),
				targetId: selectedField(column(namespaceRelationship, "targetEntityId"), EntityId),
				slug: selectedField(column(namespaceRelationship, "relationshipSchemaSlug"), Schema.String),
				userId: selectedField(
					column(namespaceRelationship, "userId"),
					Schema.NullOr(Schema.String),
				),
			},
		}),
	},
}));
export const namespaceEntityGraphRecipe = defineRecipe((reference: PluginIdentityReference) => ({
	map: ({ entities }) => Result.succeed(entities.items),
	queries: {
		entities: selectedRows(entity, {
			limit: 100,
			orderBy: [ascending(column(entity, "id"))],
			where: eq(column(entity, "entitySchemaPluginId"), pluginId(reference)),
			selection: {
				id: selectedField(column(entity, "id"), EntityId),
				userId: selectedField(column(entity, "userId"), Schema.String),
				slug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
				externalId: selectedField(column(entity, "externalId"), Schema.NullOr(Schema.String)),
				providerId: selectedField(column(entity, "providerId"), Schema.NullOr(SandboxProviderId)),
			},
		}),
	},
}));
export const namespaceSubscriptionsRecipe = defineRecipe(() => ({
	map: ({ subscriptions }) => Result.succeed(subscriptions.items),
	queries: {
		subscriptions: selectedRows(namespaceSubscription, {
			limit: 100,
			orderBy: [ascending(column(namespaceSubscription, "id"))],
			where: eq(column(namespaceSubscription, "signalSchemaSlug"), literal("tasted")),
			selection: {
				isActive: selectedField(column(namespaceSubscription, "isActive"), Schema.Boolean),
				pluginId: selectedField(column(namespaceSubscription, "signalSchemaPluginId"), PluginId),
			},
		}),
	},
}));

export const namespaceBottlesRecipe = defineRecipe(
	(input: {
		readonly reference?: PluginIdentityReference;
		readonly joinDefinitions?: boolean;
	}) => ({
		map: ({ bottles }) => Result.succeed(bottles.items),
		queries: {
			bottles: selectedRows(entity, {
				limit: 100,
				orderBy: [ascending(column(entity, "id"))],
				where: and(
					eq(column(entity, "entitySchemaSlug"), literal("bottle")),
					...(input.reference
						? [eq(column(entity, "entitySchemaPluginId"), pluginId(input.reference))]
						: []),
				),
				joins: input.joinDefinitions
					? [
							join(
								"inner",
								definition,
								and(
									eq(column(entity, "entitySchemaSlug"), column(definition, "slug")),
									eq(column(entity, "entitySchemaPluginId"), column(definition, "pluginId")),
								),
							),
						]
					: [],
				selection: {
					id: selectedField(column(entity, "id"), Schema.String),
					name: selectedField(column(entity, "name"), Schema.String),
					properties: selectedField(column(entity, "properties"), Schema.Unknown),
					owner: selectedField(column(entity, "entitySchemaPluginId"), Schema.String),
				},
			}),
		},
	}),
);

const otherEntity = table("entity", "namespaceOtherEntity");
export const namespacePairRecipe = defineRecipe(
	(input: { readonly a: PluginIdentityReference; readonly b: PluginIdentityReference }) => ({
		map: ({ pairs }) => Result.succeed(pairs.items),
		queries: {
			pairs: selectedRows(entity, {
				limit: 100,
				orderBy: [ascending(column(entity, "id")), ascending(column(otherEntity, "id"))],
				where: and(
					eq(column(entity, "entitySchemaSlug"), literal("bottle")),
					eq(column(entity, "entitySchemaPluginId"), pluginId(input.a)),
				),
				selection: {
					aName: selectedField(column(entity, "name"), Schema.String),
					bName: selectedField(column(otherEntity, "name"), Schema.String),
				},
				joins: [
					join(
						"inner",
						otherEntity,
						and(
							eq(column(otherEntity, "entitySchemaSlug"), literal("bottle")),
							eq(column(otherEntity, "entitySchemaPluginId"), pluginId(input.b)),
						),
					),
				],
			}),
		},
	}),
);

const operationSource = (label: string) => `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import { genericImportSealReference } from "@ryot-app/sandbox-sdk/imports";
export const manifest = defineManifest({ kind: "operation", name: "Whiskey operation", slug: "inspect" });
export default defineOperation({
  manifest,
  input: Schema.Struct({
    action: Schema.optional(Schema.String),
    entityId: Schema.optional(Schema.String),
    eventId: Schema.optional(Schema.String),
    targetEntityId: Schema.optional(Schema.String),
    externalId: Schema.optional(Schema.String),
    kernelInput: Schema.optional(genericImportSealReference.input),
  }),
  output: jsonValueSchema,
  run: (input, host) => Effect.gen(function* () {
    if (input.action === "kernel-child" && input.kernelInput) {
      return yield* (host.executeWorkflow?.(genericImportSealReference.workflowSlug, genericImportSealReference, input.kernelInput) ?? Effect.fail(new Error("Kernel workflow capability unavailable")));
    }
    if (input.action === "global") {
      return yield* host.upsertGlobalEntities([{ name: "Forbidden global bottle", entitySchemaSlug: "bottle", externalId: input.externalId ?? "forbidden", properties: {}, populatedAt: null }]);
    }
    if (input.action === "create-event" && input.entityId) {
      return yield* host.createEvents([{ entityId: input.entityId, eventSchemaSlug: "tasted", properties: { note: ${JSON.stringify(label)} } }]);
    }
    if (input.action === "update-event" && input.eventId) {
      return yield* host.updateEvents([{ eventId: input.eventId, patch: { properties: { remove: [], set: { note: ${JSON.stringify(label)} } } } }]);
    }
    if (input.action === "delete-event" && input.eventId) {
      return yield* host.deleteEvents([input.eventId]);
    }
    if (input.action === "relationship" && input.entityId && input.targetEntityId) {
      return yield* host.changeUserRelationships([{ creates: [{ sourceEntityId: input.entityId, targetEntityId: input.targetEntityId, relationshipSchemaSlug: "bottled-by", properties: {}, propertiesMode: "replace" }], deletes: [] }]);
    }
    return { label: ${JSON.stringify(label)} };
  }),
});
`;

const bootstrapSource = (label: string, strength: string | number, opaque: string) => `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
export const manifest = defineManifest({ kind: "script", name: "Whiskey bootstrap", slug: "bootstrap" });
export default defineScript({
  manifest, input: Schema.Struct({}), output: Schema.Boolean,
  run: (_input, host) => Effect.gen(function* () {
    const config = yield* host.getPluginConfig({ optional: ["bootstrapGateUrl"] });
    if (typeof config.bootstrapGateUrl === "string") yield* host.httpCall("GET", config.bootstrapGateUrl);
    yield* host.ensureUserEntities([
      { name: ${JSON.stringify(`${label} bottle`)}, entitySchemaSlug: "bottle", properties: { strength: ${JSON.stringify(strength)}, opaque: ${JSON.stringify(opaque)} } },
      { name: ${JSON.stringify(`${label} distillery`)}, entitySchemaSlug: "distillery", properties: {} },
    ]);
    return true;
  }),
});
`;

const importSource = `
import { genericImportSealReference, genericImportWorkflowInputSchema, genericImportWorkflowResultSchema } from "@ryot-app/sandbox-sdk/imports";
import { Effect, defineManifest, defineWorkflow, defineScriptReference } from "@ryot-app/sandbox-sdk/workflow";
const checkpoint = defineScriptReference({ scriptSlug: "checkpoint", input: genericImportWorkflowInputSchema, output: genericImportSealReference.input });
export const manifest = defineManifest({ kind: "workflow", name: "Whiskey import", slug: "import-workflow" });
export default defineWorkflow({
  manifest, input: genericImportWorkflowInputSchema, output: genericImportWorkflowResultSchema,
  run: (input, replay) => Effect.gen(function* () {
    yield* replay.activity("checkpoint", checkpoint, input);
    const sealed = yield* replay.child("seal", genericImportSealReference, { operation: { action: "seal" }, runId: input.runId, command: input.command });
    return { summary: sealed.summary, issues: [] };
  }),
});
`;

const checkpointSource = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { genericImportWorkflowInputSchema, genericImportSealReference } from "@ryot-app/sandbox-sdk/imports";
import { configValuesSchema } from "@ryot-app/sandbox-sdk/core";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
export const manifest = defineManifest({ kind: "script", name: "Whiskey checkpoint", slug: "checkpoint" });
export default defineScript({ manifest, input: genericImportWorkflowInputSchema, output: genericImportSealReference.input, run: (input, host, execution) => Effect.gen(function* () {
  const request = { runId: input.runId, command: input.command, operation: { action: "seal" as const } };
  const config = yield* host.getPluginConfig({ optional: ["checkpointUrl", "writerMarker"] });
  if (typeof config.checkpointUrl === "string") {
    const body = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Struct({ request: genericImportSealReference.input, scriptId: Schema.String, config: configValuesSchema })) )({ request, scriptId: execution.sandboxScriptId, config });
    yield* host.httpCall("POST", config.checkpointUrl, { body, headers: { "Content-Type": "application/json" } });
  }
  return request;
}) });
`;

const integrationSource = (label: string) => `
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
export const manifest = defineManifest({ kind: "operation", name: "Whiskey integration", slug: "inspect-integration" });
export default defineOperation({ manifest, input: Schema.Struct({ integrationId: Schema.String }), output: Schema.Struct({ integrationId: Schema.String, label: Schema.String }), run: (input) => Effect.succeed({ integrationId: input.integrationId, label: ${JSON.stringify(label)} }) });
`;

const kernelWriteChunksSource = (label: string, strength: string | number) => `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { readArtifact, sandboxScratchManifestSchema, writeScratchChunks } from "@ryot-app/sandbox-sdk/filesystem";
import { genericImportChunkSchema, type GenericImportWriteItem } from "@ryot-app/sandbox-sdk/imports";
export const manifest = defineManifest({ kind: "script", name: "Whiskey kernel writes", slug: "kernel-write-chunks" });
const Source = Schema.Struct({ ownEntityId: Schema.String, foreignEntityId: Schema.String });
export default defineScript({
  manifest, input: Schema.Struct({ artifactHandle: Schema.String, occurredAt: Schema.String }), output: sandboxScratchManifestSchema,
  run: (input) => Effect.gen(function* () {
    const source = yield* Schema.decodeEffect(Schema.fromJsonString(Source))(new TextDecoder().decode(yield* readArtifact));
    const entity = (operationId: string, name: string, extras: Partial<GenericImportWriteItem["entities"][number]> = {}): GenericImportWriteItem["entities"][number] => ({ alias: "root", entitySchemaSlug: "bottle", name, properties: { strength: ${JSON.stringify(strength)} }, operationId, outcome: { unit: "entities", recordKind: "bottle" }, ...extras });
    const event = (operationId: string, extras: Partial<GenericImportWriteItem["events"][number]> = {}): GenericImportWriteItem["events"][number] => ({ entityAlias: "root", eventSchemaSlug: "tasted", properties: { note: "kernel child" }, occurredAt: input.occurredAt, operationId, outcome: { unit: "events", recordKind: "tasted" }, ...extras });
    const item = (recordId: string, itemIndex: number, entities: GenericImportWriteItem["entities"], events: GenericImportWriteItem["events"]): GenericImportWriteItem => ({ recordId, itemIndex, entities, events, relationships: [], sourceLabel: "Whiskey kernel writes", sourceIdentifier: recordId, subjectEntityAlias: "root" });
    const contents = yield* Schema.encodeEffect(Schema.fromJsonString(genericImportChunkSchema))({ failures: [], items: [
      item("own", 0, [entity("own-entity", ${JSON.stringify(`${label} kernel child`)})], [event("own-event")]),
      item("foreign", 1, [entity("foreign-entity", "Existing own bottle", { entityId: source.ownEntityId, existingOnly: true })], [event("foreign-event", { subjectEntityId: source.foreignEntityId })]),
      item("global", 2, [entity("global-entity", ${JSON.stringify(`${label} forbidden global`)}, { scope: "global" })], []),
    ] });
    return yield* writeScratchChunks([{ name: "kernel-write.json", contents }]);
  }),
});
`;

const kernelWriteWorkflowSource = `
import { genericImportApplyReference, genericImportCaptureReference, genericImportSealReference, genericImportWorkflowInputSchema, genericImportWorkflowResultSchema } from "@ryot-app/sandbox-sdk/imports";
import { Effect, Schema, defineManifest, defineScriptReference, defineWorkflow } from "@ryot-app/sandbox-sdk/workflow";
export const manifest = defineManifest({ kind: "workflow", name: "Whiskey kernel write workflow", slug: "kernel-write-workflow" });
const chunks = defineScriptReference({ scriptSlug: "kernel-write-chunks", input: Schema.Struct({ artifactHandle: Schema.String, occurredAt: Schema.String }), output: Schema.Struct({ chunkHandles: Schema.Array(Schema.String) }) });
export default defineWorkflow({ manifest, input: genericImportWorkflowInputSchema, output: genericImportWorkflowResultSchema,
  run: (input, replay) => Effect.gen(function* () {
    const written = yield* replay.activity("chunks", chunks, { artifactHandle: input.sourcePayloadHandle, occurredAt: input.command.occurredAt });
    const attribution = { runId: input.runId, command: input.command };
    const issues: Array<(typeof genericImportWorkflowResultSchema.Type)["issues"][number]> = [];
    for (const [ordinal, handle] of written.chunkHandles.entries()) {
      const captured = yield* replay.child("capture-" + ordinal, genericImportCaptureReference, { ...attribution, operation: { action: "capture", phase: "application", ordinal, handle, captureId: "chunk-" + ordinal, checkpoint: {} } });
      const applied = yield* replay.child("apply-" + ordinal, genericImportApplyReference, { ...attribution, operation: { action: "apply", ordinal, batchId: "batch-" + ordinal, captureId: captured.captureId, inputFingerprint: captured.inputFingerprint } });
      issues.push(...applied.issues);
    }
    const sealed = yield* replay.child("seal", genericImportSealReference, { ...attribution, operation: { action: "seal" } });
    return { summary: sealed.summary, issues };
  }),
});
`;

const retainedSource = (label: string) => `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
export const manifest = defineManifest({ kind: "script", name: "Retained Whiskey writer", slug: "retained" });
export default defineScript({
  manifest, input: Schema.Struct({ gateUrl: Schema.String, entityId: Schema.String }), output: jsonValueSchema,
  run: (input, host, execution) => Effect.gen(function* () {
    yield* host.httpCall("GET", input.gateUrl);
    const definitions = yield* host.getEntitySchemas(["bottle"]);
    const config = yield* host.getPluginConfig({ optional: ["writerMarker"] });
    yield* host.createEvents([{ entityId: input.entityId, eventSchemaSlug: "tasted", properties: { note: ${JSON.stringify(label)} } }]);
    return { label: ${JSON.stringify(label)}, scriptId: execution.sandboxScriptId, definitions, config };
  }),
});
`;

const policySource = (label: string) => `
import { defineAutomationPolicy } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
export const manifest = defineManifest({ kind: "automation", automationType: "policy", name: "Whiskey policy", slug: "policy", inputProjection: { event: { properties: ["note"] } } });
export default defineAutomationPolicy({ manifest, run: ({ automation }) => Effect.succeed(
  automation.payload.resource === "event" && automation.payload.operation === "create"
    ? { action: "transform" as const, patch: { resource: "event" as const, draft: { properties: { remove: [], set: { note: ${JSON.stringify(`${label} policy`)} } } } } }
    : { action: "allow" as const },
) });
`;

const afterSource = (label: string) => `
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
export const manifest = defineManifest({ kind: "automation", automationType: "automation", name: "Whiskey after hook", slug: "after", inputProjection: { event: { properties: ["note"], compareProperties: [] } } });
export default defineAutomation({ manifest, run: ({ automation }, host) => Effect.gen(function* () {
  const config = yield* host.getPluginConfig({ optional: ["retryGateUrl"] });
  if (typeof config.retryGateUrl === "string") {
    const response = yield* host.httpCall("GET", config.retryGateUrl, { headers: { "Idempotency-Key": automation.runId } });
    if (response.status !== 200) return yield* Effect.fail(new Error("namespace upstream refused"));
  }
  const payload = automation.payload;
  if (payload.resource !== "event" || payload.operation !== "create") return null;
  return yield* host.emitSignal({ schemaSlug: "tasted", discriminator: payload.after.id, subjectEntityId: payload.after.entityId, properties: { label: ${JSON.stringify(label)} } });
}) });
`;

const formatterSource = (label: string) => `
import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
export const manifest = defineManifest({ kind: "automation", automationType: "automation", name: "Whiskey formatter", slug: "formatter", inputProjection: { signal: { properties: ["label"] } } });
export default defineAutomation({ manifest, run: ({ automation }, host) => automation.payload.resource === "signal" ? host.sendNotification(${JSON.stringify(`${label} tasting`)}) : Effect.succeed(null) });
`;

const clientRecipeSource = `
import { Schema, Result } from "@ryot-app/plugin-kit/effect";
import { and, ascending, column, defineRecipe, eq, literal, pluginId, selectedField, selectedRows, table } from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";
const entity = table("entity", "contributorBottle");
export const contributorBottlesRecipe = defineRecipe((reference: PluginIdentityReference) => ({
  map: ({ bottles }) => Result.succeed(bottles.items.map(({ name }) => name)),
  queries: { bottles: selectedRows(entity, {
    limit: 100, orderBy: [ascending(column(entity, "id"))],
    where: and(eq(column(entity, "entitySchemaSlug"), literal("bottle")), eq(column(entity, "entitySchemaPluginId"), pluginId(reference))),
    selection: { name: selectedField(column(entity, "name"), Schema.String) },
  }) },
}));
`;

const clientSource = (label: string, packageId: PluginPackageId, contributor: boolean) => `
import { Schema } from "@ryot-app/client-sdk/effect";
import { createRyotMutation, createRyotQuery, usePluginIdentity, usePluginStorage, useRyotMutation, useRyotQuery } from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { PluginPackageId, type PluginIdentityReference } from "@ryot-app/client-sdk/plugin";
import { contributorBottlesRecipe } from "../shared/query-recipes";
${contributor ? 'import Contributor from "@ryot-app/plugins/whiskey/catalog";' : ""}
const invoke = createRyotMutation<{ packageId: typeof PluginPackageId.Type }, { label: string }>(({ input, client }) => client.operations.invoke({ packageId: input.packageId, slug: "inspect", input: {}, output: Schema.Struct({ label: Schema.String }) }));
const bottlesQuery = createRyotQuery<PluginIdentityReference, readonly string[]>(({ input, client }) => client.data.query(contributorBottlesRecipe(input)));
export const Catalog = () => {
  const identity = usePluginIdentity(PluginPackageId.make(${JSON.stringify(packageId)}));
  const storage = usePluginStorage({ pluginId: identity.pluginId, key: "selected", schema: Schema.String });
  const operation = useRyotMutation(invoke);
  const bottles = useRyotQuery(bottlesQuery, identity);
  return <section data-testid=${JSON.stringify(`catalog-${label}`)}>
    <p data-testid="contributor-owner">{identity.pluginId}</p>
    <p data-testid="storage-value">{storage.status === "ready" ? storage.value ?? "empty" : "loading"}</p>
    <p data-testid="bottle-names">{bottles.data?.join(",") ?? "loading"}</p>
    <button disabled={storage.status !== "ready"} onClick={() => { if (storage.status === "ready") void storage.set(${JSON.stringify(label)}); }}>Store ${label}</button>
    <button onClick={() => operation.mutate({ packageId: PluginPackageId.make(${JSON.stringify(packageId)}) })}>Invoke ${label}</button>
    <p data-testid="operation-result">{operation.data?.label ?? "idle"}</p>
  </section>;
};
export const Home = () => <PluginScreenFrame title="Whiskey"><Catalog />${contributor ? "<Contributor />" : ""}</PluginScreenFrame>;
export default Catalog;
`;

const namespacePackage = (input: {
	readonly label: string;
	readonly packageId: PluginPackageId;
	readonly strength: string | number;
	readonly uniqueSchema: string;
	readonly revision?: 1 | 2;
	readonly bootstrap?: boolean;
	readonly dependency?: PluginPackageId;
	readonly opaque: string;
}): PluginPackageInput => {
	const entry = "backend/scripts/inspect.sandbox.ts";
	const bootstrapEntry = "backend/scripts/bootstrap.sandbox.ts";
	const providerEntry = "backend/providers/catalog/details.sandbox.ts";
	const importEntry = "backend/scripts/import.sandbox.ts";
	const manifest = testPluginManifest({
		pluginSlug: "whiskey",
		packageId: input.packageId,
		workflows: [
			{ slug: "import", scriptSlug: "import-workflow" },
			{ slug: "kernel-write", scriptSlug: "kernel-write-workflow" },
		],
		userBootstrap:
			input.bootstrap === false
				? []
				: [
						{
							slug: "bootstrap",
							scriptSlug: "bootstrap",
							description: "Initialize private bottles",
						},
					],
		savedViews: [
			{
				icon: "wine",
				sortOrder: 0,
				settings: {},
				name: "All bottles",
				slug: "all-bottles",
				renderer: { kind: "plugin", exportName: "home" },
				dataSources: namespaceBottlesRecipe({ reference: { kind: "self" } }).document,
			},
		],
		integrationProviders: [
			{
				lot: "push",
				name: "Import",
				slug: "import",
				description: "Offline namespaced integration",
				settingsSchema: {
					unknownKeys: "strict",
					fields: { marker: { type: "string", label: "Marker", description: "Fixture marker" } },
				},
			},
		],
		signalSchemas: [
			{
				name: "Tasted",
				slug: "tasted",
				catalogState: "active",
				audiencePolicy: { kind: "actor" },
				notificationHookSlug: "formatter",
				propertiesSchema: {
					fields: { label: { type: "string", label: "Label", description: "Exact emitter" } },
				},
			},
		],
		operations: [
			{
				auth: "integration",
				slug: "inspect-integration",
				scriptSlug: "inspect-integration",
				description: "Inspect an exact integration installation",
			},
			{
				auth: "user",
				slug: "inspect",
				scriptSlug: "inspect",
				demoAccess: "allowed",
				description: "Inspect exact namespace",
			},
		],
		relationshipSchemas: [
			{
				name: "Contains",
				slug: "contains",
				sourceEntitySchemaSlug: "bottle",
				propertiesSchema: { fields: {} },
				targetEntitySchemaSlug: input.uniqueSchema,
			},
			{
				name: "Bottled by",
				slug: "bottled-by",
				sourceEntitySchemaSlug: "bottle",
				propertiesSchema: { fields: {} },
				targetEntitySchemaSlug: "distillery",
			},
		],
		providers: [
			{
				name: "Catalog",
				slug: "catalog",
				rootEntitySchemaSlug: "bottle",
				information: { source: "offline" },
				operations: { details: "catalog.details" },
			},
			{
				name: "Distillery",
				slug: "distillery",
				rootEntitySchemaSlug: "distillery",
				information: { source: "offline" },
				operations: { details: "distillery.details" },
			},
		],
		clientDefinition: {
			apiVersion: 1,
			homeView: "all-bottles",
			routes: { "/": "home" },
			pluginDependencies: input.dependency
				? { whiskey: { scope: "user", packageId: input.dependency } }
				: {},
			exports: {
				catalog: {
					kind: "component",
					entry: "client/catalog.tsx",
					automaticEntityPresentations: false,
				},
				home: {
					kind: "page",
					entry: "client/home.tsx",
					settingsSchema: { fields: {} },
					automaticEntityPresentations: false,
				},
			},
		},
		configSchema: {
			unknownKeys: "strict",
			fields: {
				retryGateUrl: {
					type: "string",
					label: "Retry gate",
					description: "Hermetic retry checkpoint",
				},
				writerMarker: {
					type: "string",
					label: "Writer marker",
					description: "Exact retained configuration marker",
				},
				checkpointUrl: {
					type: "string",
					label: "Checkpoint",
					description: "Hermetic kernel child admission checkpoint",
				},
				bootstrapGateUrl: {
					type: "string",
					label: "Bootstrap gate",
					description: "Hermetic installation admission checkpoint",
				},
			},
		},
		importSources: [
			{
				slug: "kernel-write",
				name: "Kernel writes",
				workflowSlug: "kernel-write",
				description: "Restricted kernel import children",
				inputSchema: {
					unknownKeys: "strict",
					fields: {
						ownEntityId: {
							type: "string",
							label: "Own entity",
							validation: { required: true },
							description: "Own existing bottle",
						},
						foreignEntityId: {
							type: "string",
							label: "Foreign entity",
							validation: { required: true },
							description: "Foreign existing bottle",
						},
					},
				},
			},
			{
				name: "Import",
				slug: "import",
				workflowSlug: "import",
				description: "Offline import",
				inputSchema: { fields: {}, unknownKeys: "strict" },
			},
		],
		hooks: [
			{
				position: 0,
				slug: "policy",
				stage: "before",
				scriptSlug: "policy",
				name: "Whiskey policy",
				targets: [
					{
						resource: "event",
						operation: "create",
						eventSchemaSlug: "tasted",
						entitySchemaSlug: "bottle",
					},
				],
			},
			{
				slug: "after",
				stage: "after",
				scriptSlug: "after",
				delivery: "required",
				name: "Whiskey after hook",
				retry: {
					maxAttempts: 1,
					maxDelayMs: 1000,
					initialDelayMs: 1000,
					externalIdempotency: "run-id",
				},
				targets: [
					{
						resource: "event",
						operation: "create",
						eventSchemaSlug: "tasted",
						entitySchemaSlug: "bottle",
					},
				],
			},
			{
				stage: "after",
				slug: "formatter",
				delivery: "async",
				scriptSlug: "formatter",
				name: "Whiskey formatter",
				targets: [{ operation: "emit", resource: "signal", signalSchemaSlug: "tasted" }],
			},
		],
		entitySchemas: [
			{
				icon: "wine",
				name: "Bottle",
				slug: "bottle",
				eventSchemas: [
					{
						name: "Tasted",
						slug: "tasted",
						propertiesSchema: {
							fields: { note: { label: "Note", type: "string", description: "Tasting note" } },
						},
					},
				],
				propertiesSchema: {
					unknownKeys: "strict",
					fields: {
						opaque: {
							type: "string",
							label: "Opaque value",
							description: "An uninterpreted string",
						},
						strength: {
							label: "Strength",
							validation: { required: true },
							description: "Package-specific strength representation",
							type: typeof input.strength === "string" ? "string" : "integer",
						},
						...(input.revision === 2
							? {
									finish: {
										label: "Finish",
										type: "string" as const,
										description: "Optional additive property",
									},
								}
							: {}),
					},
				},
			},
			...["distillery", input.uniqueSchema].map((slug) => ({
				slug,
				name: slug,
				icon: "wine",
				eventSchemas: [],
				propertiesSchema: { fields: {}, unknownKeys: "strict" as const },
			})),
		],
		scripts: [
			{
				kind: "script",
				capabilities: [],
				slug: "kernel-write-chunks",
				requiredPluginConfigKeys: [],
				name: "Whiskey kernel writes",
				entry: "backend/scripts/kernel-write-chunks.sandbox.ts",
			},
			{
				kind: "workflow",
				capabilities: [],
				requiredPluginConfigKeys: [],
				slug: "kernel-write-workflow",
				name: "Whiskey kernel write workflow",
				entry: "backend/scripts/kernel-write-workflow.sandbox.ts",
			},
			{
				capabilities: [],
				kind: "operation",
				name: "Whiskey integration",
				slug: "inspect-integration",
				requiredPluginConfigKeys: [],
				entry: "backend/scripts/integration.sandbox.ts",
			},
			{
				kind: "script",
				capabilities: [],
				slug: "checkpoint",
				name: "Whiskey checkpoint",
				requiredPluginConfigKeys: [],
				entry: "backend/scripts/checkpoint.sandbox.ts",
			},
			{
				entry,
				slug: "inspect",
				capabilities: [],
				kind: "operation",
				name: "Whiskey operation",
				requiredPluginConfigKeys: [],
			},
			{
				kind: "script",
				slug: "bootstrap",
				entry: bootstrapEntry,
				name: "Whiskey bootstrap",
				requiredPluginConfigKeys: [],
				capabilities: ["ensureUserEntities"],
			},
			{
				kind: "provider",
				capabilities: [],
				entry: providerEntry,
				name: "Whiskey details",
				slug: "catalog.details",
				providerSlug: "catalog",
				providerOperation: "details",
				requiredPluginConfigKeys: [],
			},
			{
				kind: "provider",
				capabilities: [],
				name: "Distillery details",
				slug: "distillery.details",
				providerSlug: "distillery",
				providerOperation: "details",
				requiredPluginConfigKeys: [],
				entry: "backend/providers/distillery/details.sandbox.ts",
			},
			{
				kind: "workflow",
				capabilities: [],
				entry: importEntry,
				name: "Whiskey import",
				slug: "import-workflow",
				requiredPluginConfigKeys: [],
			},
			{
				kind: "script",
				slug: "retained",
				capabilities: [],
				requiredPluginConfigKeys: [],
				name: "Retained Whiskey writer",
				entry: "backend/scripts/retained.sandbox.ts",
			},
			{
				slug: "policy",
				capabilities: [],
				kind: "automation",
				name: "Whiskey policy",
				automationType: "policy",
				requiredPluginConfigKeys: [],
				entry: "backend/automations/policy.sandbox.ts",
				inputProjection: { event: { properties: ["note"] } },
			},
			{
				slug: "after",
				capabilities: [],
				kind: "automation",
				name: "Whiskey after hook",
				automationType: "automation",
				requiredPluginConfigKeys: [],
				entry: "backend/automations/after.sandbox.ts",
				inputProjection: { event: { properties: ["note"], compareProperties: [] } },
			},
			{
				capabilities: [],
				slug: "formatter",
				kind: "automation",
				name: "Whiskey formatter",
				automationType: "automation",
				requiredPluginConfigKeys: [],
				entry: "backend/automations/formatter.sandbox.ts",
				inputProjection: { signal: { properties: ["label"] } },
			},
		],
	});
	return {
		manifest: {
			...manifest,
			metadata: { ...manifest.metadata, name: "Whiskey", version: "1.0.0" },
		},
		files: encodePluginSourceFiles({
			[importEntry]: importSource,
			[entry]: operationSource(input.label),
			"shared/query-recipes.ts": clientRecipeSource,
			"backend/scripts/checkpoint.sandbox.ts": checkpointSource,
			"backend/automations/after.sandbox.ts": afterSource(input.label),
			"client/home.tsx": 'export { Home as default } from "./catalog";',
			"backend/scripts/retained.sandbox.ts": retainedSource(input.label),
			"backend/automations/policy.sandbox.ts": policySource(input.label),
			"backend/scripts/integration.sandbox.ts": integrationSource(input.label),
			"backend/automations/formatter.sandbox.ts": formatterSource(input.label),
			"backend/scripts/kernel-write-workflow.sandbox.ts": kernelWriteWorkflowSource,
			"client/catalog.tsx": clientSource(
				input.label,
				input.packageId,
				input.dependency !== undefined,
			),
			"backend/scripts/kernel-write-chunks.sandbox.ts": kernelWriteChunksSource(
				input.label,
				input.strength,
			),
			[bootstrapEntry]: bootstrapSource(
				input.revision === 2 ? "A1" : input.label,
				input.strength,
				input.opaque,
			),
			"backend/providers/distillery/details.sandbox.ts": providerSandboxSource({
				operation: "details",
				name: "Distillery details",
				slug: "distillery.details",
				result: { properties: {}, name: `${input.label} provider distillery` },
			}),
			[providerEntry]: providerSandboxSource({
				operation: "details",
				name: "Whiskey details",
				slug: "catalog.details",
				result: {
					name: `${input.label} provider bottle`,
					properties: { opaque: input.opaque, strength: input.strength },
					childEntities: [
						{
							properties: {},
							name: `${input.label} child`,
							externalId: `${input.opaque}-child`,
							entitySchemaSlug: input.uniqueSchema,
						},
					],
					relatedEntityGroups: [
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "bottled-by",
							entities: [
								{
									properties: {},
									providerSlug: "distillery",
									externalId: `${input.opaque}-distillery`,
									name: `${input.label} provider distillery`,
								},
							],
						},
					],
				},
			}),
		}),
	};
};

export const pluginNamespacePackages = (options: { readonly compose?: boolean } = {}) => {
	const aId = testPluginPackageId();
	const bId = testPluginPackageId();
	const externalId = `namespace-${crypto.randomUUID()}`;
	const commonA = {
		packageId: aId,
		strength: "forty",
		opaque: externalId,
		uniqueSchema: "cask",
		...(options.compose ? { dependency: bId } : {}),
	};
	return {
		externalId,
		a: namespacePackage({ ...commonA, label: "A1" }),
		a2: namespacePackage({ ...commonA, label: "A2", revision: 2 }),
		b: namespacePackage({
			label: "B1",
			strength: 40,
			packageId: bId,
			opaque: externalId,
			uniqueSchema: "barrel",
		}),
		claim: namespacePackage({
			packageId: aId,
			label: "Claim",
			bootstrap: false,
			strength: "forty",
			opaque: externalId,
			uniqueSchema: "cask",
		}),
		contributor: namespacePackage({
			dependency: aId,
			strength: "forty",
			opaque: externalId,
			label: "Contributor",
			uniqueSchema: "warehouse",
			packageId: testPluginPackageId(),
		}),
	};
};

export const namespaceInstallation = (client: Client, targetPluginId: PluginId) =>
	pollUntil(
		`namespace installation '${targetPluginId}'`,
		listNamespaceInstallations(client).pipe(
			Effect.map((installations) => {
				const found = installations.find(
					(installation) => installation.pluginId === targetPluginId,
				);
				return found && found.health !== "installing" ? found : null;
			}),
		),
	);

export const installNamespacePackage = (
	client: Client,
	pluginPackage: PluginPackageInput,
	config: ContractPayload<"plugins", "install">["config"] = {},
) =>
	Effect.gen(function* () {
		const installed = yield* installPrivatePluginPackage({ client, config, pluginPackage });
		const installation = yield* namespaceInstallation(client, installed.pluginId);
		return { ...installed, installation, pluginPackage };
	});

export const invokeNamespaceOperation = (
	client: Client,
	targetPackageId: PluginPackageId,
	payload: NamespaceInvocation["payload"] = {},
	contentHash?: string,
) =>
	client.call((contract) =>
		contract.plugins.invoke({
			payload: { payload, ...(contentHash ? { contentHash } : {}) },
			params: { ...pluginPackageSegments(targetPackageId), operationSlug: "inspect" },
		}),
	);

export const updateNamespacePackage = (
	client: Client,
	installed: Pick<NamespaceInstallResult, "id"> & {
		readonly installation: { readonly contentHash: string };
	},
	pluginPackage: PluginPackageInput,
	config?: ContractPayload<"plugins", "update">["config"],
) =>
	Effect.gen(function* () {
		const uploadToken = yield* uploadPrivatePluginPackage(client, pluginPackage);
		return yield* client.call((contract) =>
			contract.plugins.update({
				params: { installationId: installed.id },
				payload: {
					uploadToken,
					contentHash: installed.installation.contentHash,
					...(config === undefined ? {} : { config }),
				},
			}),
		);
	});
