import { expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { SandboxProviderId, SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { eq, sql } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { assert, describe } from "vitest";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	SandboxExecutionAuthority,
	SandboxExecutionPrincipal,
} from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { nativeRecoveryLayer } from "#lib/infrastructure/sandbox-runtime/sidecar-recovery-native.test-support";
import { SandboxSidecarSupervisor } from "#lib/infrastructure/sandbox-runtime/sidecar-supervisor";
import { assertExitFails } from "#lib/test-utils/assertions";
import { PluginRepository } from "#modules/plugins/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/revision.test-support";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { SandboxRepository } from "./repository";
import { SandboxExecutionAuthorityLive } from "./runtime-authority";

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
	Schema.decodeEffect(SandboxExecutionPrincipal)({ ...pin, subject: ownerSubject });

const assertRejected = Effect.fnUntraced(function* (
	authority: SandboxExecutionAuthority["Service"],
	principals: ReadonlyArray<SandboxExecutionPrincipal>,
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
									pluginSlug: slug,
									dataSources: null,
									name: "Large saved view",
									slug: `${slug}-saved-view`,
									renderer: { kind: "kernel", name: "results-table" },
									settings: { payload: "large saved view payload ".repeat(512) },
								},
							],
						},
					} satisfies typeof sourcePackage;
					const installed = yield* installRevisionPackage(pluginPackage, owner);
					const [revision] = yield* session.run((db) =>
						db
							.select({
								manifest: tables.pluginRevision.manifest,
								sandboxAuthority: tables.pluginRevisionSandboxAuthority.sandboxAuthority,
							})
							.from(tables.pluginRevision)
							.innerJoin(
								tables.pluginRevisionSandboxAuthority,
								eq(tables.pluginRevisionSandboxAuthority.id, tables.pluginRevision.id),
							)
							.where(eq(tables.pluginRevision.id, installed.revisionId))
							.limit(1),
					);
					assert(revision);
					const expectedSandboxAuthority = {
						userBootstrapScriptSlugs: [],
						configSchema: pluginPackage.manifest.configSchema,
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
					expect(revision.manifest.providers[0]?.information.source.length).toBeGreaterThan(10_000);
					const savedViewPayload = revision.manifest.savedViews[0]?.settings["payload"];
					assert(typeof savedViewPayload === "string");
					expect(savedViewPayload.length).toBeGreaterThan(10_000);
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
							metadata: { ...principal.metadata, runtimeImports: ["@ryot-app/sandbox-sdk/fflate"] },
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
					} satisfies SandboxExecutionPrincipal;
					expect(yield* authority.resolve(principal)).toBe("system");
				}),
			),
		);

		test.effect(
			"rejects malformed declarations and non-string workflow targets in persisted authority",
			() =>
				Effect.gen(function* () {
					const authority = yield* SandboxExecutionAuthority;
					const sandbox = yield* SandboxRepository;
					const session = yield* DatabaseSession;
					const pluginPackage = revisionPackage(`authority-declarations-${crypto.randomUUID()}`);
					const installed = yield* installRevisionPackage(pluginPackage, owner);
					const [script] = yield* session.run((db) =>
						db
							.select({ id: tables.sandboxScript.id })
							.from(tables.sandboxScript)
							.where(eq(tables.sandboxScript.pluginRevisionId, installed.revisionId))
							.limit(1),
					);
					assert(script);
					const pin = yield* sandbox.getScriptPin(SandboxScriptId.make(script.id));
					assert(pin);
					const principal = yield* principalFor(pin);
					for (const manifest of [
						sql`${tables.pluginRevision.manifest} - 'scripts'`,
						sql`${tables.pluginRevision.manifest} - 'workflows'`,
						sql`${tables.pluginRevision.manifest} - 'userBootstrap'`,
						sql`${tables.pluginRevision.manifest} - 'entitySchemas'`,
						sql`${tables.pluginRevision.manifest} - 'relationshipSchemas'`,
						sql`jsonb_set(${tables.pluginRevision.manifest}, '{scripts}', '{}'::jsonb)`,
						sql`jsonb_set(${tables.pluginRevision.manifest}, '{entitySchemas}', '{}'::jsonb)`,
						sql`jsonb_set(${tables.pluginRevision.manifest}, '{entitySchemas,0}', (${tables.pluginRevision.manifest}->'entitySchemas'->0) - 'eventSchemas')`,
						sql`jsonb_set(${tables.pluginRevision.manifest}, '{entitySchemas,0,eventSchemas}', 'null'::jsonb)`,
						sql`jsonb_set(${tables.pluginRevision.manifest}, '{workflows,0,scriptSlug}', '42'::jsonb)`,
					]) {
						yield* session.run((db) =>
							db
								.update(tables.pluginRevision)
								.set({ manifest: pluginPackage.manifest })
								.where(eq(tables.pluginRevision.id, installed.revisionId)),
						);
						yield* session.run((db) =>
							db
								.update(tables.pluginRevision)
								.set({ manifest })
								.where(eq(tables.pluginRevision.id, installed.revisionId)),
						);
						yield* assertRejected(authority, [principal]);
					}
				}),
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
						principal: SandboxExecutionPrincipal,
						instance: string,
					) {
						expect(yield* supervisor.locate(principal)).toMatchObject({ instance });
					});
					const rejected = Effect.fnUntraced(function* (principal: SandboxExecutionPrincipal) {
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
});
