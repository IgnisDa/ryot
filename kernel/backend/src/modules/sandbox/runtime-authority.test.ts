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
					const owner = UserId.make("owner");
					const installed = yield* installRevisionPackage(revisionPackage(slug), owner);
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
					const principal = yield* Schema.decodeEffect(SandboxExecutionPrincipal)({
						...pin,
						subject: {
							type: "user",
							userId: owner,
							accountGeneration: { userId: owner, token: "test-account-generation" },
						},
					});
					expect(yield* authority.resolve(principal)).toBe("user");
					for (const changed of [
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
					] satisfies ReadonlyArray<SandboxExecutionPrincipal>) {
						assertExitFails(yield* Effect.exit(authority.resolve(changed)), missingArtifact());
					}
					yield* session.run((db) =>
						db
							.update(tables.sandboxScript)
							.set({
								metadata: sql`jsonb_set(${tables.sandboxScript.metadata}, '{runtimeImports}', '[42]'::jsonb)`,
							})
							.where(eq(tables.sandboxScript.id, row.id)),
					);
					assertExitFails(yield* Effect.exit(authority.resolve(principal)), missingArtifact());
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

					const owner = UserId.make("owner");
					for (const principal of [
						{ ...pin, subject: { type: "system" } },
						{
							...pin,
							subject: {
								type: "user",
								userId: owner,
								accountGeneration: { userId: owner, token: "test-account-generation" },
							},
						},
					] satisfies ReadonlyArray<SandboxExecutionPrincipal>) {
						assertExitFails(yield* Effect.exit(authority.resolve(principal)), missingArtifact());
					}
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
					const owner = UserId.make("owner");
					const ownerSubject = {
						type: "user",
						userId: owner,
						accountGeneration: { userId: owner, token: "test-account-generation" },
					} as const;
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
					yield* installRevisionPackage(revisionPackage(firstPartySlug));
					const firstPartyPin = yield* scriptPin(`${firstPartySlug}.details`);
					yield* locatesTo({ ...firstPartyPin, subject: ownerSubject }, "system/core");
				}),
			),
		);
	});
});
