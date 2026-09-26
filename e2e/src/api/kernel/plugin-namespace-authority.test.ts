import type { ContractPayload } from "@ryot-app/contract/client";
import {
	AutomationHookSlug,
	EntityId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { genericImportSealInputSchema } from "@ryot-app/plugin-backend-sdk/imports";
import {
	ascending,
	column,
	defineRecipe,
	eq,
	pluginId,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Deferred, Effect, Result, Schema } from "effect";

import {
	createAuthenticatedClient,
	enqueueProviderEntityImport,
	executeRyotQLRecipe,
	installNamespacePackage,
	invokeNamespaceOperation,
	namespaceBottlesRecipe,
	namespaceProvidersRecipe,
	namespaceRelationshipsRecipe,
	namespaceEntityGraphRecipe,
	pluginNamespacePackages,
	pollProviderEntityImportResult,
	listEventsForEntity,
	pollSignalTrigger,
	listAutomationRuns,
	createNotificationChannel,
	installNotificationRule,
	pollUntil,
	startFakeAppriseServerScoped,
	pollImportRunUntilTerminal,
	getImportRun,
} from "~/fixtures/kernel";
import { assertCompleted, assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";

const entity = table("entity", "namespaceGraph");
const graphRecipe = defineRecipe((owner: Parameters<typeof pluginId>[0]) => ({
	map: ({ graph }) => Result.succeed(graph.items),
	queries: {
		graph: selectedRows(entity, {
			limit: 100,
			orderBy: [ascending(column(entity, "id"))],
			where: eq(column(entity, "entitySchemaPluginId"), pluginId(owner)),
			selection: {
				id: selectedField(column(entity, "id"), EntityId),
				schema: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
				userId: selectedField(column(entity, "userId"), Schema.NullOr(Schema.String)),
			},
		}),
	},
}));

describe("plugin namespace authority", () => {
	it.live(
		"carries a private source's write context through real kernel capture/apply children",
		() =>
			Effect.gen(function* () {
				const { client, userId } = yield* createAuthenticatedClient();
				const packages = pluginNamespacePackages();
				const a = yield* installNamespacePackage(client, packages.a);
				const b = yield* installNamespacePackage(client, packages.b);
				const own = requirePresent(
					(yield* executeRyotQLRecipe(
						client,
						namespaceBottlesRecipe({ reference: { kind: "local", pluginId: a.pluginId } }),
					))[0],
					"A bottle missing",
				);
				const foreign = requirePresent(
					(yield* executeRyotQLRecipe(
						client,
						namespaceBottlesRecipe({ reference: { kind: "local", pluginId: b.pluginId } }),
					))[0],
					"B bottle missing",
				);
				const created = yield* client.call((contract) =>
					contract.imports.createRun({
						payload: {
							ownEntityId: own.id,
							foreignEntityId: foreign.id,
							source: { slug: "kernel-write", owner: { kind: "plugin", pluginId: a.pluginId } },
						},
					}),
				);
				const terminal = yield* pollImportRunUntilTerminal(client, created.id);
				expect(terminal.status).toBe("completed");
				expect(terminal.failureReason).toBeNull();
				expect(terminal.summary).toEqual(
					expect.arrayContaining([
						{
							unit: "entities",
							recordKind: "bottle",
							counts: { created: 1, updated: 0, skipped: 0, unchanged: 0, unsuccessful: 2 },
						},
						{
							unit: "events",
							recordKind: "tasted",
							counts: { created: 1, updated: 0, skipped: 0, unchanged: 0, unsuccessful: 1 },
						},
					]),
				);
				const detail = yield* getImportRun(client, created.id, undefined, 100);
				expect(
					detail.issues.items
						.map(({ data }) =>
							requirePresent(data.operationId, "Import issue operation ID missing"),
						)
						.sort((left, right) => {
							if (left < right) {
								return -1;
							}
							if (left > right) {
								return 1;
							}
							return 0;
						}),
				).toEqual(["foreign-entity", "foreign-event", "global-entity"]);
				expect(
					detail.issues.items.every(({ data }) => data.reason.code === "database-commit-failed"),
				).toBe(true);
				const graph = yield* executeRyotQLRecipe(
					client,
					namespaceEntityGraphRecipe({ kind: "local", pluginId: a.pluginId }),
				);
				expect(graph).toHaveLength(3);
				expect(graph.every((row) => row.userId === userId)).toBe(true);
				const ownBottles = yield* executeRyotQLRecipe(
					client,
					namespaceBottlesRecipe({ reference: { kind: "local", pluginId: a.pluginId } }),
				);
				expect(ownBottles.map(({ name }) => name).sort()).toEqual(["A1 bottle", "A1 kernel child"]);
				const child = requirePresent(
					ownBottles.find(({ name }) => name === "A1 kernel child"),
					"Positive kernel child missing",
				);
				expect(
					(yield* listEventsForEntity(client, child.id, undefined, 100)).map(
						({ properties }) => properties,
					),
				).toEqual([{ note: "A1 policy" }]);
				expect(yield* listEventsForEntity(client, foreign.id, undefined, 100)).toEqual([]);
				expect(
					yield* executeRyotQLRecipe(
						client,
						namespaceBottlesRecipe({ reference: { kind: "local", pluginId: b.pluginId } }),
					),
				).toEqual([foreign]);
			}),
	);
	it.live("does not lend kernel import authority to a foreign same-name plugin operation", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const release = yield* Deferred.make<void>();
			const upstream = yield* startFakeHttpServerScoped(() =>
				Effect.gen(function* () {
					yield* Deferred.await(release);
					return Response.json({ ok: true });
				}),
			);
			yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
			const packages = pluginNamespacePackages();
			const a = yield* installNamespacePackage(client, packages.a);
			const b = yield* installNamespacePackage(client, packages.b, { checkpointUrl: upstream.url });
			const run = yield* client.call((contract) =>
				contract.imports.createRun({
					payload: { source: { slug: "import", owner: { kind: "plugin", pluginId: b.pluginId } } },
				}),
			);
			const body = yield* pollUntil(
				"B kernel import checkpoint",
				Effect.sync(() => upstream.requests[0]?.body ?? null),
			);
			const evidence = yield* Schema.decodeUnknownEffect(
				Schema.Struct({ request: genericImportSealInputSchema }),
			)(body);
			const request = evidence.request;
			expect(request.runId).toBe(run.id);
			const kernelInput = yield* Schema.encodeEffect(
				Schema.toCodecJson(genericImportSealInputSchema),
			)(request);
			const denied = yield* Effect.flip(
				invokeNamespaceOperation(client, a.installation.packageId, {
					kernelInput,
					action: "kernel-child",
				}),
			);
			assertTaggedError(denied, "PluginInvocationError");
			expect(denied.reason.code).toBe("runtime-failed");
			yield* Deferred.succeed(release, undefined);
			expect((yield* pollImportRunUntilTerminal(client, run.id)).status).toBe("completed");
			expect((yield* invokeNamespaceOperation(client, a.installation.packageId)).result).toEqual({
				label: "A1",
			});
		}),
	);
	it.live("matches policies, hooks and same-name signals only within their exact owner", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const apprise = yield* startFakeAppriseServerScoped;
			yield* createNotificationChannel(client, {
				channel: "apprise",
				channelSpecifics: { kind: "apprise", key: "namespaces", baseUrl: apprise.url },
			});
			const packages = pluginNamespacePackages();
			const a = yield* installNamespacePackage(client, packages.a);
			const b = yield* installNamespacePackage(client, packages.b);
			for (const installed of [a, b]) {
				yield* installNotificationRule(client, {
					slug: SignalSchemaSlug.make("tasted"),
					owner: { kind: "plugin", pluginId: installed.pluginId },
				});
			}
			for (const [installed, label] of [
				[a, "A1"],
				[b, "B1"],
			] as const) {
				const bottle = requirePresent(
					(yield* executeRyotQLRecipe(
						client,
						namespaceBottlesRecipe({ reference: { kind: "local", pluginId: installed.pluginId } }),
					))[0],
					"Owned bottle missing",
				);
				yield* invokeNamespaceOperation(client, installed.installation.packageId, {
					entityId: bottle.id,
					action: "create-event",
				});
				const events = yield* listEventsForEntity(client, bottle.id, undefined, 100);
				expect(events).toHaveLength(1);
				expect(events[0]?.properties).toEqual({ note: `${label} policy` });
				const event = requirePresent(events[0], "Owned event missing");
				const runs = yield* listAutomationRuns({
					hookSlug: AutomationHookSlug.make("after"),
					sourceRecord: { id: event.id, resource: "event" },
				});
				expect(runs).toHaveLength(1);
				expect(runs[0]?.pluginId).toBe(installed.pluginId);
				const signal = yield* pollSignalTrigger({
					actorUserId: UserId.make(userId),
					subjectEntityId: EntityId.make(bottle.id),
					signalSchema: {
						slug: SignalSchemaSlug.make("tasted"),
						owner: { kind: "plugin", pluginId: installed.pluginId },
					},
				});
				expect(signal.payload.properties).toEqual({ label });
			}
			const messages = yield* pollUntil(
				"both namespace formatter deliveries",
				Effect.sync(() => {
					const delivered = apprise.requests.filter(({ path }) => path === "/notify/namespaces");
					return delivered.length >= 2 ? delivered : null;
				}),
			);
			expect(messages).toHaveLength(2);
			expect(messages.map(({ body }) => body)).toEqual(
				expect.arrayContaining([
					{ title: "Ryot", body: "A1 tasting" },
					{ title: "Ryot", body: "B1 tasting" },
				]),
			);
		}),
	);
	it.live("denies foreign event writes, relationship endpoints, and private global writes", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const packages = pluginNamespacePackages();
			const a = yield* installNamespacePackage(client, packages.a);
			const b = yield* installNamespacePackage(client, packages.b);
			const foreign = requirePresent(
				(yield* executeRyotQLRecipe(
					client,
					namespaceBottlesRecipe({ reference: { kind: "local", pluginId: b.pluginId } }),
				))[0],
				"B bottle missing",
			);
			const own = requirePresent(
				(yield* executeRyotQLRecipe(
					client,
					namespaceBottlesRecipe({ reference: { kind: "local", pluginId: a.pluginId } }),
				))[0],
				"A bottle missing",
			);
			const foreignDistillery = requirePresent(
				(yield* executeRyotQLRecipe(
					client,
					graphRecipe({ kind: "local", pluginId: b.pluginId }),
				)).find(({ schema }) => schema === "distillery"),
				"B distillery missing",
			);
			yield* invokeNamespaceOperation(client, b.installation.packageId, {
				entityId: foreign.id,
				action: "create-event",
			});
			const foreignEvent = requirePresent(
				(yield* listEventsForEntity(client, foreign.id, undefined, 100))[0],
				"B event missing",
			);
			const attacks: ReadonlyArray<ContractPayload<"plugins", "invoke">["payload"]> = [
				{ entityId: foreign.id, action: "create-event" },
				{ action: "update-event", eventId: foreignEvent.id },
				{ action: "delete-event", eventId: foreignEvent.id },
				{ action: "global", externalId: packages.externalId },
				{ entityId: own.id, action: "relationship", targetEntityId: foreignDistillery.id },
			];
			for (const payload of attacks) {
				const error = yield* Effect.flip(
					invokeNamespaceOperation(client, a.installation.packageId, payload),
				);
				assertTaggedError(error, "PluginInvocationError");
				expect(error.reason.code).toBe("runtime-failed");
			}
			expect(
				(yield* executeRyotQLRecipe(client, namespaceBottlesRecipe({})))
					.map(({ name }) => name)
					.sort(),
			).toEqual(["A1 bottle", "B1 bottle"]);
			expect(
				(yield* listEventsForEntity(client, foreign.id, undefined, 100)).map(
					({ id, properties }) => ({ id, properties }),
				),
			).toEqual([{ id: foreignEvent.id, properties: { note: "B1 policy" } }]);
		}),
	);

	it.live("imports root, child, and related private graphs without cross-owner deduplication", () =>
		Effect.gen(function* () {
			const { client, userId } = yield* createAuthenticatedClient();
			const packages = pluginNamespacePackages();
			const a = yield* installNamespacePackage(client, packages.a);
			const b = yield* installNamespacePackage(client, packages.b);
			const roots: string[] = [];
			for (const installed of [a, b]) {
				const reference = { kind: "local" as const, pluginId: installed.pluginId };
				const selected = requirePresent(
					(yield* executeRyotQLRecipe(client, namespaceProvidersRecipe(reference)))[0],
					"Exact provider missing",
				);
				expect(selected.root).toBe("bottle");
				const { jobId } = yield* enqueueProviderEntityImport(client, {
					providerId: selected.id,
					externalId: packages.externalId,
				});
				const result = yield* pollProviderEntityImportResult(client, jobId);
				assertCompleted(result, "private namespace import");
				roots.push(result.data.id);
				const graph = yield* executeRyotQLRecipe(client, graphRecipe(reference));
				expect(graph.every((row) => row.userId === userId)).toBe(true);
				expect(graph.map(({ schema }) => schema).sort()).toEqual(
					[
						"bottle",
						"bottle",
						installed.pluginId === a.pluginId ? "cask" : "barrel",
						"distillery",
						"distillery",
					].sort(),
				);
				const relationships = yield* executeRyotQLRecipe(
					client,
					namespaceRelationshipsRecipe(reference),
				);
				expect(relationships).toHaveLength(2);
				expect(
					relationships.every(
						(row) =>
							row.userId === userId &&
							row.sourceId === result.data.id &&
							graph.some(({ id }) => id === row.targetId),
					),
				).toBe(true);
				expect(relationships.map(({ slug }) => slug).sort()).toEqual(["bottled-by", "contains"]);
				const repeated = yield* enqueueProviderEntityImport(client, {
					providerId: selected.id,
					externalId: packages.externalId,
				});
				const replay = yield* pollProviderEntityImportResult(client, repeated.jobId);
				assertCompleted(replay, "repeated private import");
				expect(replay.data.id).toBe(result.data.id);
			}
			expect(new Set(roots).size).toBe(2);
		}),
	);
});
