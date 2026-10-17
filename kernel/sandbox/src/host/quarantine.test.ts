import { expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Effect, Layer } from "effect";

import { sandboxProtectionKeys } from "./crash-store";
import { makeUserPluginRevision } from "./executor.test-support";
import {
	deleteRedisKeysOnExit,
	makeSandboxHostConfigLayer,
	testExecutionId,
	testSandboxRedisLayer,
} from "./host.test-support";
import type { SandboxPrincipal } from "./principal";
import { SandboxSidecarQuarantine } from "./quarantine";
import { makeUserPrincipal, makeUserSubject } from "./run-input.test-support";

const quarantineLayer = Layer.unwrap(
	Effect.sync(() =>
		SandboxSidecarQuarantine.layer.pipe(
			Layer.provideMerge(testSandboxRedisLayer),
			Layer.provide(makeSandboxHostConfigLayer()),
		),
	),
);

const makePrincipal = (
	ownerId: UserId,
	contentHash: string,
	compiledHashes: Readonly<Record<string, string>>,
): SandboxPrincipal =>
	makeUserPrincipal({
		contentHash,
		subject: makeUserSubject(ownerId),
		metadata: { kind: "script", runtimeImports: [] },
		scriptId: SandboxScriptId.make(testExecutionId("script")),
		pluginRevision: makeUserPluginRevision({ ownerId, compiledHashes }),
	});

const testHash = () => crypto.randomUUID().replaceAll("-", "").padEnd(64, "0");

const sessions = Effect.gen(function* () {
	const quarantine = yield* SandboxSidecarQuarantine;
	const identities = new Set<string>();
	yield* deleteRedisKeysOnExit(() => [...identities].flatMap(sandboxProtectionKeys));
	return Effect.fnUntraced(function* (principal: SandboxPrincipal, trust: "user" | "system") {
		const session = yield* quarantine.open(principal, trust);
		for (const identity of session.identities) {
			identities.add(identity);
		}
		return session;
	});
});

layer(quarantineLayer)((test) => {
	test.effect("charges the plugin owner and content identities", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const open = yield* sessions;
				const owner = UserId.make(testExecutionId("owner"));
				const hash = testHash();
				const crashing = makePrincipal(owner, hash, { entry: hash });
				const healthyOwner = UserId.make(testExecutionId("owner"));
				const healthyHash = testHash();
				const healthy = makePrincipal(healthyOwner, healthyHash, { entry: healthyHash });
				yield* open(healthy, "user");
				for (let index = 0; index < 3; index++) {
					const session = yield* open(crashing, "user");
					expect(session.identities[0]).toBe(`user:owner:${owner}`);
					yield* session.recordCrash;
				}
				assertExitFails(
					yield* Effect.exit(open(crashing, "user")),
					new SandboxRunError({
						kind: "resource-unavailable",
						message: "Sandbox execution is quarantined or awaiting exclusive probation",
					}),
				);
				expect((yield* open(healthy, "user")).probation).toBe(false);
			}),
		),
	);
	test.effect("rejects user-trust quarantine without a plugin revision", () =>
		Effect.gen(function* () {
			const quarantine = yield* SandboxSidecarQuarantine;
			const owner = UserId.make(testExecutionId("owner"));
			const hash = testHash();
			const principal = makePrincipal(owner, hash, { entry: hash });
			const revision = makeUserPluginRevision({ ownerId: owner, compiledHashes: { entry: hash } });
			for (const rejected of [
				{ ...principal, pluginRevision: null },
				{ ...principal, pluginRevision: { ...revision, ownerId: null } },
				{ ...principal, pluginRevision: { ...revision, scope: "system" as const } },
			]) {
				assertExitFails(
					yield* Effect.exit(quarantine.open(rejected, "user")),
					new SandboxRunError({
						kind: "resource-unavailable",
						message: "Sandbox crash protection unavailable",
					}),
				);
			}
		}),
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
