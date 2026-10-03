import { expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import {
	PluginId,
	PluginRevisionId,
	PluginConfigRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer, Redacted } from "effect";

import { RedisService } from "#lib/infrastructure/redis";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import {
	deleteRedisKeysOnExit,
	sandboxProtectionKeys,
	testExecutionId,
	testRedisUrl,
} from "#lib/test-utils/redis";

import type { SandboxExecutionPrincipal } from "./execution-principal";
import { SandboxSidecarQuarantine } from "./sidecar-quarantine";

const quarantineLayer = Layer.unwrap(
	Effect.sync(() =>
		SandboxSidecarQuarantine.layer.pipe(
			Layer.provideMerge(RedisService.layer),
			Layer.provide(makeAppConfigLayer({ redisUrl: Redacted.make(testRedisUrl()) })),
		),
	),
);

const makePrincipal = (
	ownerId: UserId,
	contentHash: string,
	compiledHashes: Readonly<Record<string, string>>,
): SandboxExecutionPrincipal => ({
	contentHash,
	providerId: null,
	scriptSlug: "entry",
	metadata: { kind: "script", runtimeImports: [] },
	scriptId: SandboxScriptId.make(testExecutionId("script")),
	subject: {
		type: "user",
		userId: ownerId,
		accountGeneration: { userId: ownerId, token: "generation" },
	},
	pluginRevision: {
		ownerId,
		scope: "user",
		compiledHashes,
		workflowScripts: {},
		userBootstrapScriptSlugs: [],
		slug: testExecutionId("plugin"),
		id: PluginId.make(testExecutionId("plugin")),
		configSchema: { fields: {}, unknownKeys: "strict" },
		revisionId: PluginRevisionId.make(testExecutionId("revision")),
		configRevisionId: PluginConfigRevisionId.make(testExecutionId("config")),
		schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
	},
});

const testHash = () => crypto.randomUUID().replaceAll("-", "").padEnd(64, "0");

const sessions = Effect.gen(function* () {
	const quarantine = yield* SandboxSidecarQuarantine;
	const identities = new Set<string>();
	yield* deleteRedisKeysOnExit(() => [...identities].flatMap(sandboxProtectionKeys));
	return Effect.fnUntraced(function* (
		principal: SandboxExecutionPrincipal,
		trust: "user" | "system",
	) {
		const session = yield* quarantine.open(principal, trust);
		for (const identity of session.identities) {
			identities.add(identity);
		}
		return session;
	});
});

layer(quarantineLayer)((test) => {
	test.effect("charges the pinned standalone uploader rather than the executing user", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const open = yield* sessions;
				const uploader = UserId.make(testExecutionId("uploader"));
				const executingUser = UserId.make(testExecutionId("executor"));
				const hash = testHash();
				const uploaded = {
					...makePrincipal(executingUser, hash, { entry: hash }),
					pluginRevision: null,
					standaloneUploaderId: uploader,
				};
				const healthyHash = testHash();
				const healthy = {
					...uploaded,
					contentHash: healthyHash,
					standaloneUploaderId: executingUser,
				};
				yield* open(healthy, "user");
				for (let index = 0; index < 3; index++) {
					const session = yield* open(uploaded, "user");
					expect(session.identities[0]).toBe(`user:uploader:${uploader}`);
					yield* session.recordCrash;
				}
				assertExitFails(
					yield* Effect.exit(open(uploaded, "user")),
					new SandboxRunError({
						kind: "resource-unavailable",
						message: "Sandbox execution is quarantined or awaiting exclusive probation",
					}),
				);
				expect((yield* open(healthy, "user")).probation).toBe(false);
			}),
		),
	);
	test.effect("does not substitute the executing user for a missing standalone uploader pin", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const quarantine = yield* SandboxSidecarQuarantine;
				const owner = UserId.make(testExecutionId("owner"));
				const hash = testHash();
				const principal = { ...makePrincipal(owner, hash, { entry: hash }), pluginRevision: null };
				assertExitFails(
					yield* Effect.exit(quarantine.open(principal, "user")),
					new SandboxRunError({
						kind: "resource-unavailable",
						message: "Sandbox standalone upload has no pinned uploader identity",
					}),
				);
			}),
		),
	);
	test.effect(
		"content quarantine follows the executable set across accounts and renamed modules",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const open = yield* sessions;
					const firstOwner = UserId.make(testExecutionId("owner"));
					const secondOwner = UserId.make(testExecutionId("owner"));
					const firstHash = testHash();
					const secondHash = testHash();
					const first = makePrincipal(firstOwner, firstHash, {
						first: firstHash,
						second: secondHash,
					});
					const repacked = makePrincipal(secondOwner, firstHash, {
						renamedA: firstHash,
						renamedB: secondHash,
					});
					const rotatedHash = testHash();
					const rotated = makePrincipal(firstOwner, rotatedHash, { different: rotatedHash });
					const healthyHash = testHash();
					const healthy = makePrincipal(secondOwner, healthyHash, { healthy: healthyHash });
					yield* open(repacked, "user");
					yield* open(rotated, "user");
					yield* open(healthy, "user");
					for (let index = 0; index < 3; index++) {
						yield* (yield* open(first, "user")).recordCrash;
					}
					for (const principal of [repacked, rotated]) {
						assertExitFails(
							yield* Effect.exit(open(principal, "user")),
							new SandboxRunError({
								kind: "resource-unavailable",
								message: "Sandbox execution is quarantined or awaiting exclusive probation",
							}),
						);
					}
					expect((yield* open(healthy, "user")).probation).toBe(false);
				}),
			),
	);
	test.effect(
		"user-attributed system crashes do not quarantine the first-party plugin globally",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const open = yield* sessions;
					const owner = UserId.make(testExecutionId("owner"));
					const otherOwner = UserId.make(testExecutionId("owner"));
					const hash = testHash();
					const base = makePrincipal(owner, hash, { entry: hash });
					const firstParty = { ...base, pluginRevision: null };
					const otherUser = {
						...firstParty,
						subject: {
							...base.subject,
							userId: otherOwner,
							type: "user" as const,
							accountGeneration: { userId: otherOwner, token: "other-generation" },
						},
					};
					const userless = { ...firstParty, subject: { type: "system" as const } };
					yield* open(otherUser, "system");
					yield* open(userless, "system");
					for (let index = 0; index < 3; index++) {
						yield* (yield* open(firstParty, "system")).recordCrash;
					}
					assertExitFails(
						yield* Effect.exit(open(firstParty, "system")),
						new SandboxRunError({
							kind: "resource-unavailable",
							message: "Sandbox execution is quarantined or awaiting exclusive probation",
						}),
					);
					expect((yield* open(otherUser, "system")).probation).toBe(false);
					expect((yield* open(userless, "system")).probation).toBe(false);
				}),
			),
	);
});
