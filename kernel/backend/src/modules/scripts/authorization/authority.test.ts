import { expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import type { ResultsTableSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import { SandboxProviderId, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { column, field, rows as queryRows, table } from "@ryot-app/ryotql";
import { SandboxExecutionAuthority } from "@ryot-app/sandbox/host/authority";
import { nativeRecoveryLayer } from "@ryot-app/sandbox/host/recovery-native.test-support";
import { SandboxSidecarSupervisor } from "@ryot-app/sandbox/host/supervisor";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { eq, sql } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { assert, describe } from "vitest";

import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { PluginRepository } from "#modules/plugins/packages/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { SandboxWorkflowPinning } from "../executions/workflow";
import { ScriptExecutionWorkflowPayload } from "../executions/workflow-payload";
import { SandboxPluginScriptResolver } from "../registry/plugin-script-resolver";
import { SandboxRepository } from "../registry/repository";
import { SandboxExecutionAuthorityLive } from "./authority";
import { pluginSandboxAuthority } from "./plugin-authority";
import { ScriptExecutionPrincipal } from "./principal";

const savedViewEntity = table("entity", "entity");

type PersistedScript = Parameters<PluginRepository["Service"]["persistKernelScript"]>[0];

const persistedScript = (slug: string) => {
	const [compiled] = revisionPackage(slug).scripts;
	assert(compiled);
	const { entry: _entry, ...script } = compiled;
	return { ...script, source: "sandbox runtime authority source" } satisfies PersistedScript;
};

const addScriptCleanup = (session: DatabaseSession["Service"], slug: string) =>
	Effect.addFinalizer(() =>
		session
			.run((db) =>
				Effect.gen(function* () {
					yield* db.delete(tables.kernelScript).where(eq(tables.kernelScript.slug, slug));
					yield* db.delete(tables.sandboxScript).where(eq(tables.sandboxScript.slug, slug));
				}),
			)
			.pipe(Effect.orDie),
	);

const missingArtifact = () =>
	new SandboxRunError({
		kind: "missing-artifact",
		message: "Sandbox execution pin does not match its stored authority",
	});

const owner = UserId.make("owner");
const ownerSubject = {
	type: "user",
	userId: owner,
	accountGeneration: { userId: owner, token: "test-account-generation" },
} as const;

type ScriptPin = NonNullable<
	Effect.Success<ReturnType<SandboxRepository["Service"]["getScriptPin"]>>
>;

const principalFor = (pin: ScriptPin) =>
	Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject: ownerSubject });

const assertRejected = Effect.fnUntraced(function* (
	authority: SandboxExecutionAuthority["Service"],
	principals: ReadonlyArray<ScriptExecutionPrincipal>,
) {
	for (const principal of principals) {
		assertExitFails(yield* Effect.exit(authority.resolve(principal)), missingArtifact());
	}
});

describe("sandbox execution authority", () => {
	layer(SandboxExecutionAuthorityLive.pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect(
			"canonicalizes persisted provider annotations while rejecting changed execution authority",
			() =>
				Effect.gen(function* () {
					const authority = yield* SandboxExecutionAuthority;
					const sandbox = yield* SandboxRepository;
					const session = yield* DatabaseSession;
					const slug = `runtime-authority-provider-${crypto.randomUUID()}`;
					const sourcePackage = revisionPackage(slug);
					const [entitySchema] = sourcePackage.manifest.entitySchemas;
					assert(entitySchema);
					const [relationshipSchema] = sourcePackage.manifest.relationshipSchemas;
					assert(relationshipSchema);
					const [eventSchema] = entitySchema.eventSchemas;
					assert(eventSchema);
					const secondEntitySlug = `${slug}-entity-second`;
					const secondEventSlugs = [`${slug}-event-second-first`, `${slug}-event-second-second`];
					const pluginPackage = {
						...sourcePackage,
						manifest: {
							...sourcePackage.manifest,
							relationshipSchemas: [
								relationshipSchema,
								{
									...relationshipSchema,
									slug: `${slug}-link-second`,
									sourceEntitySchemaSlug: secondEntitySlug,
									targetEntitySchemaSlug: secondEntitySlug,
								},
							],
							providers: sourcePackage.manifest.providers.map((provider) =>
								Object.assign({}, provider, {
									information: Object.assign({}, provider.information, {
										source: "large provider payload ".repeat(512),
									}),
								}),
							),
							entitySchemas: [
								entitySchema,
								{
									...entitySchema,
									name: "Second entity",
									slug: secondEntitySlug,
									eventSchemas: secondEventSlugs.map((eventSlug) =>
										Object.assign({}, eventSchema, { slug: eventSlug }),
									),
								},
							],
							savedViews: [
								{
									sortOrder: 0,
									icon: "bookmark",
									name: "Large saved view",
									slug: `${slug}-saved-view`,
									renderer: { kind: "kernel", name: "results-table" },
									dataSources: {
										queries: {
											records: queryRows(savedViewEntity, {
												fields: [field("id", column(savedViewEntity, "id"))],
											}),
										},
									},
									settings: {
										pageSize: 20,
										entityLink: null,
										rowKeyFields: ["id"],
										sourceName: "records",
										columns: [
											{
												field: "id",
												displayKind: "text",
												label: "large saved view payload ".repeat(512),
											},
										],
									} satisfies ResultsTableSavedViewSettings,
								},
							],
						},
					} satisfies typeof sourcePackage;
					const installed = yield* installRevisionPackage(pluginPackage, owner);
					const [revision] = yield* session.run((db) =>
						db
							.select({
								manifest: tables.pluginRevisionManifest.manifest,
								sandboxAuthority: tables.pluginRevision.sandboxAuthority,
							})
							.from(tables.pluginRevision)
							.innerJoin(
								tables.pluginRevisionManifest,
								eq(tables.pluginRevisionManifest.pluginRevisionId, tables.pluginRevision.id),
							)
							.where(eq(tables.pluginRevision.id, installed.revisionId))
							.limit(1),
					);
					assert(revision);
					const expectedSandboxAuthority = {
						userBootstrapScriptSlugs: [],
						configSchema: pluginPackage.manifest.configSchema,
						packageId: pluginPackage.manifest.metadata.packageId,
						scriptKinds: Object.fromEntries(
							pluginPackage.manifest.scripts.map(({ kind, slug: scriptSlug }) => [
								scriptSlug,
								kind,
							]),
						),
						workflowScripts: Object.fromEntries(
							pluginPackage.manifest.workflows.map(({ scriptSlug, slug: workflowSlug }) => [
								workflowSlug,
								scriptSlug,
							]),
						),
						schemaScope: {
							entitySchemaSlugs: [entitySchema.slug, secondEntitySlug],
							relationshipSchemaSlugs: [relationshipSchema.slug, `${slug}-link-second`],
							signalSchemaSlugs: pluginPackage.manifest.signalSchemas.map(
								({ slug: signalSlug }) => signalSlug,
							),
							eventSchemas: [
								{ eventSchemaSlug: eventSchema.slug, entitySchemaSlug: entitySchema.slug },
								...secondEventSlugs.map((eventSchemaSlug) => ({
									eventSchemaSlug,
									entitySchemaSlug: secondEntitySlug,
								})),
							],
						},
					};
					expect(revision.sandboxAuthority).toEqual(expectedSandboxAuthority);
					expect(stableStringify(pluginSandboxAuthority(revision.manifest))).toBe(
						stableStringify(expectedSandboxAuthority),
					);
					expect(revision.manifest.providers[0]?.information.source.length).toBeGreaterThan(10_000);
					const savedViewSettings = revision.manifest.savedViews[0]?.settings;
					expect(stableStringify(savedViewSettings).length).toBeGreaterThan(10_000);
					expect(revision.sandboxAuthority).not.toHaveProperty("providers");
					expect(revision.sandboxAuthority).not.toHaveProperty("savedViews");
					const [row] = yield* session.run((db) =>
						db
							.select()
							.from(tables.sandboxScript)
							.where(eq(tables.sandboxScript.slug, `${slug}.details`)),
					);
					assert(row);
					expect(row.metadata).toMatchObject({
						providerOperation: "details",
						providerSlug: `${slug}-provider`,
					});
					const pin = yield* sandbox.getScriptPin(SandboxScriptId.make(row.id));
					assert(pin?.pluginRevision);
					expect(pin.pluginRevision.revisionId).toBe(installed.revisionId);
					expect(pin.pluginRevision).toMatchObject({
						userBootstrapScriptSlugs: [],
						schemaScope: expectedSandboxAuthority.schemaScope,
						configSchema: expectedSandboxAuthority.configSchema,
						workflowScripts: expectedSandboxAuthority.workflowScripts,
					});
					const principal = yield* principalFor(pin);
					expect(yield* authority.resolve(principal)).toBe("user");
					yield* assertRejected(authority, [
						{ ...principal, providerId: SandboxProviderId.make("foreign-provider") },
						{ ...principal, contentHash: "foreign-content" },
						{ ...principal, scriptSlug: "foreign-slug" },
						{ ...principal, kernelScript: true as const },
						{
							...principal,
							pluginRevision: { ...pin.pluginRevision, ownerId: UserId.make("recipient") },
						},
						{
							...principal,
							pluginRevision: { ...pin.pluginRevision, ownerId: null, scope: "system" as const },
						},
						{ ...principal, pluginRevision: { ...pin.pluginRevision, compiledHashes: {} } },
						{
							...principal,
							metadata: {
								...principal.metadata,
								runtimeImports: ["@ryot-app/plugin-backend-sdk/fflate"],
							},
						},
						{ ...principal, metadata: { ...principal.metadata, capabilities: ["httpCall"] } },
						{
							...principal,
							metadata: { ...principal.metadata, requiredPluginConfigKeys: ["token"] },
						},
						{
							...principal,
							metadata: { ...principal.metadata, optionalPluginConfigKeys: ["token"] },
						},
					]);
					yield* session.run((db) =>
						db
							.update(tables.sandboxScript)
							.set({
								metadata: sql`jsonb_set(${tables.sandboxScript.metadata}, '{runtimeImports}', '[42]'::jsonb)`,
							})
							.where(eq(tables.sandboxScript.id, row.id)),
					);
					yield* assertRejected(authority, [principal]);
					yield* session.run((db) =>
						db
							.update(tables.sandboxScript)
							.set({
								metadata: sql`jsonb_set(${tables.sandboxScript.metadata}, '{kind}', '"script"'::jsonb)`,
							})
							.where(eq(tables.sandboxScript.id, row.id)),
					);
					expect(yield* sandbox.getScriptPin(SandboxScriptId.make(row.id))).toBeNull();
				}),
		);
		test.effect(
			"rejects tampered, swapped and ownership-violating principals as an invalid pin",
			() =>
				Effect.gen(function* () {
					const authority = yield* SandboxExecutionAuthority;
					const sandbox = yield* SandboxRepository;
					const session = yield* DatabaseSession;
					const slug = `authority-negative-${crypto.randomUUID()}`;
					const installed = yield* installRevisionPackage(revisionPackage(slug), owner);
					const rows = yield* session.run((db) =>
						db
							.select({ id: tables.sandboxScript.id })
							.from(tables.sandboxScript)
							.where(eq(tables.sandboxScript.pluginRevisionId, installed.revisionId)),
					);
					const [first, second] = rows;
					assert(first && second);
					const pin = yield* sandbox.getScriptPin(SandboxScriptId.make(first.id));
					assert(pin?.pluginRevision);
					const principal = yield* principalFor(pin);
					expect(yield* authority.resolve(principal)).toBe("user");
					yield* assertRejected(authority, [
						{ ...principal, metadata: { ...principal.metadata, capabilities: ["httpCall"] } },
						{ ...principal, scriptId: SandboxScriptId.make(second.id) },
						{ ...principal, scriptId: SandboxScriptId.make("missing-script") },
						{ ...principal, subject: { type: "system" } },
						{
							...principal,
							subject: {
								type: "user",
								userId: UserId.make("recipient"),
								accountGeneration: { token: "other", userId: UserId.make("recipient") },
							},
						},
						{ ...principal, kernelScript: true as const },
					]);
				}),
		);

		test.effect("resolves stored kernel scripts as system-owned", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const authority = yield* SandboxExecutionAuthority;
					const plugins = yield* PluginRepository;
					const runtime = yield* PluginRuntimeResolver;
					const sandbox = yield* SandboxRepository;
					const session = yield* DatabaseSession;
					const script = persistedScript(`runtime-authority-kernel-${crypto.randomUUID()}`);
					yield* addScriptCleanup(session, script.slug);

					yield* plugins.persistKernelScript(script);
					const kernelScript = yield* runtime.findKernelScript(script.slug);
					assert(kernelScript);
					const pin = yield* sandbox.getScriptPin(kernelScript.id);
					assert(pin);
					expect(pin).toMatchObject({ kernelScript: true });

					const principal = {
						...pin,
						subject: { type: "system" },
					} satisfies ScriptExecutionPrincipal;
					expect(yield* authority.resolve(principal)).toBe("system");
				}),
			),
		);

		test.effect("authority_rejects_scripts_that_are_neither_plugin_nor_kernel", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const authority = yield* SandboxExecutionAuthority;
					const sandbox = yield* SandboxRepository;
					const session = yield* DatabaseSession;
					const script = persistedScript(`runtime-authority-unpinned-${crypto.randomUUID()}`);
					yield* addScriptCleanup(session, script.slug);

					const [stored] = yield* session.run((db) =>
						db
							.insert(tables.sandboxScript)
							.values({ ...script, pluginRevisionId: null })
							.returning({ id: tables.sandboxScript.id }),
					);
					assert(stored);
					const pin = yield* sandbox.getScriptPin(SandboxScriptId.make(stored.id));
					assert(pin);
					expect(pin).not.toHaveProperty("kernelScript");

					yield* assertRejected(authority, [
						{ ...pin, subject: { type: "system" } },
						{ ...pin, subject: ownerSubject },
					]);
				}),
			),
		);
	});

	layer(
		Layer.mergeAll(
			nativeRecoveryLayer,
			SandboxExecutionAuthorityLive.pipe(Layer.provideMerge(revisionDatabaseLayer)),
		),
		{ excludeTestServices: true },
	)((test) => {
		test.effect("user_revisions_and_unverified_null_principals_cannot_reach_system_sidecars", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const plugins = yield* PluginRepository;
					const runtime = yield* PluginRuntimeResolver;
					const sandbox = yield* SandboxRepository;
					const session = yield* DatabaseSession;
					const supervisor = yield* SandboxSidecarSupervisor.make;
					const scriptPin = Effect.fnUntraced(function* (scriptSlug: string) {
						const [row] = yield* session.run((db) =>
							db
								.select({ id: tables.sandboxScript.id })
								.from(tables.sandboxScript)
								.where(eq(tables.sandboxScript.slug, scriptSlug)),
						);
						assert(row);
						const pin = yield* sandbox.getScriptPin(SandboxScriptId.make(row.id));
						assert(pin);
						return pin;
					});
					const locatesTo = Effect.fnUntraced(function* (
						principal: ScriptExecutionPrincipal,
						instance: string,
					) {
						expect(yield* supervisor.locate(principal)).toMatchObject({ instance });
					});
					const rejected = Effect.fnUntraced(function* (principal: ScriptExecutionPrincipal) {
						assertExitFails(yield* Effect.exit(supervisor.locate(principal)), missingArtifact());
					});

					const userSlug = `runtime-authority-user-${crypto.randomUUID()}`;
					yield* installRevisionPackage(revisionPackage(userSlug), owner);
					const userPin = yield* scriptPin(`${userSlug}.details`);
					assert(userPin.pluginRevision);
					const userRevision = { ...userPin, subject: ownerSubject };
					yield* locatesTo(userRevision, "user/core");
					yield* rejected({ ...userPin, subject: { type: "system" } });
					yield* rejected({
						...userRevision,
						pluginRevision: { ...userPin.pluginRevision, ownerId: null, scope: "system" },
					});
					yield* rejected({ ...userRevision, kernelScript: true });

					const unpinned = persistedScript(`runtime-authority-null-${crypto.randomUUID()}`);
					yield* addScriptCleanup(session, unpinned.slug);
					const [stored] = yield* session.run((db) =>
						db
							.insert(tables.sandboxScript)
							.values({ ...unpinned, pluginRevisionId: null })
							.returning({ id: tables.sandboxScript.id }),
					);
					assert(stored);
					const nullPin = yield* sandbox.getScriptPin(SandboxScriptId.make(stored.id));
					assert(nullPin);
					expect(nullPin.pluginRevision).toBeNull();
					yield* rejected({ ...nullPin, subject: { type: "system" } });
					yield* rejected({ ...nullPin, kernelScript: true, subject: { type: "system" } });

					const kernel = persistedScript(`runtime-authority-source-zero-${crypto.randomUUID()}`);
					yield* addScriptCleanup(session, kernel.slug);
					yield* plugins.persistKernelScript(kernel);
					const kernelScript = yield* runtime.findKernelScript(kernel.slug);
					assert(kernelScript);
					const kernelPin = yield* sandbox.getScriptPin(kernelScript.id);
					assert(kernelPin);
					yield* locatesTo({ ...kernelPin, subject: { type: "system" } }, "system/core");

					const firstPartySlug = `runtime-authority-first-party-${crypto.randomUUID()}`;
					const firstPartyPackage = revisionPackage(firstPartySlug);
					const bootstrapScriptSlug = `${firstPartySlug}.task`;
					yield* installRevisionPackage({
						...firstPartyPackage,
						manifest: {
							...firstPartyPackage.manifest,
							userBootstrap: [
								{
									scriptSlug: bootstrapScriptSlug,
									slug: `${firstPartySlug}-bootstrap`,
									description: "First-party bootstrap",
								},
							],
						},
					});
					const firstPartyPin = yield* scriptPin(`${firstPartySlug}.details`);
					expect(firstPartyPin.pluginRevision?.userBootstrapScriptSlugs).toEqual([
						bootstrapScriptSlug,
					]);
					yield* locatesTo({ ...firstPartyPin, subject: ownerSubject }, "system/core");
				}),
			),
		);
	});

	layer(
		Layer.mergeAll(
			nativeRecoveryLayer,
			SandboxExecutionAuthorityLive,
			SandboxWorkflowPinning.layer.pipe(
				Layer.provide(
					Layer.mock(SandboxPluginScriptResolver)({
						findActiveScriptById: () => Effect.die("Exact pins must not resolve active scripts"),
					}),
				),
			),
		).pipe(Layer.provideMerge(revisionDatabaseLayer)),
		{ excludeTestServices: true },
	)((test) => {
		test.effect("locates the principal that the workflow pinning step produces", () =>
			Effect.scoped(
				Effect.gen(function* () {
					const pinning = yield* SandboxWorkflowPinning;
					const session = yield* DatabaseSession;
					const supervisor = yield* SandboxSidecarSupervisor.make;
					const slug = `authority-workflow-${crypto.randomUUID()}`;
					yield* installRevisionPackage(revisionPackage(slug), owner);
					const [row] = yield* session.run((db) =>
						db
							.select({ id: tables.sandboxScript.id })
							.from(tables.sandboxScript)
							.where(eq(tables.sandboxScript.slug, `${slug}.details`))
							.limit(1),
					);
					assert(row);
					const executionId = `authority-workflow-${crypto.randomUUID()}`;
					const payload = yield* Schema.decodeEffect(ScriptExecutionWorkflowPayload)({
						input: {},
						executionId,
						lane: "interactive",
						subject: ownerSubject,
						resolutionMode: "exact",
						scriptId: SandboxScriptId.make(row.id),
					});
					const { principal } = yield* pinning.establish(payload, executionId);
					expect(principal.metadata).toHaveProperty("providerOperation", "details");
					expect(yield* supervisor.locate(principal)).toMatchObject({ instance: "user/core" });
				}),
			),
		);
	});
});
