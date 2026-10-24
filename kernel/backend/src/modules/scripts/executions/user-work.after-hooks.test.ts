import { expect, it } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";

import { BackgroundWorkInput } from "#modules/background-work/model";
import { BackgroundWorkService } from "#modules/background-work/service";
import { DomainLifecycleCommand, DomainWriteChecks } from "#modules/entities/write-context";
import {
	makeUserPluginRevision,
	makeUserRunInput,
} from "#modules/scripts/authorization/principal.test-support";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { fakeDatabaseSession } from "#testing/effect";

import { makeUserWorkScriptHost } from "./user-work";

it.effect(
	"inherits trusted suppression through persisted user-work descendants, never authored input",
	() =>
		Effect.scoped(
			Effect.gen(function* () {
				const userId = UserId.make("work-owner");
				const pin = makeUserPluginRevision({
					ownerId: userId,
					slug: "work-plugin",
					compiledHashes: { worker: "worker-hash" },
				});
				const admissions: BackgroundWorkInput[] = [];
				const commands: DomainLifecycleCommand[] = [];
				const dispatches: string[] = [];
				const subject = {
					userId,
					type: "user" as const,
					accountGeneration: { userId, token: "caller-generation" },
				};
				const input = makeUserRunInput({
					hostCallDiscriminator: 0,
					workflowExecutionId: "parent",
					principal: {
						subject,
						pluginRevision: pin,
						metadata: {
							kind: "script",
							runtimeImports: [],
							capabilities: ["requestUserWork"],
							executableDependencies: [{ slug: "worker", kind: "script" }],
						},
					},
				});
				const dependencies = Layer.mergeAll(
					fakeDatabaseSession({}),
					Layer.succeed(SandboxRepository, {
						getScript: () => Effect.die("Unused script read"),
						getScriptPin: () => Effect.die("Unused pin read"),
						isPluginScript: () => Effect.die("Unused ownership read"),
						resolveWorkflowCallScript: (revision) => {
							expect(revision).toEqual(pin);
							return Effect.succeed({
								kind: "script",
								scriptId: SandboxScriptId.make("worker-script"),
							});
						},
					}),
					Layer.succeed(DomainWriteChecks, {
						checkMany: () => Effect.die("Unused batch check"),
						checkProvider: () => Effect.die("Unused provider check"),
						findPinnedDeclaration: () => Effect.die("Unused declaration read"),
						resolvePinnedDeclaration: () => Effect.die("Unused declaration resolution"),
						check: (command, owner, scope, lock) => {
							expect(owner).toEqual({ kind: "plugin", pluginId: pin.id });
							expect(scope).toBe(userId);
							expect(lock).toBe(true);
							return Schema.decodeUnknownEffect(DomainLifecycleCommand)(command).pipe(
								Effect.orDie,
								Effect.tap((value) => Effect.sync(() => commands.push(value))),
								Effect.as(null),
							);
						},
					}),
					Layer.succeed(BackgroundWorkService, {
						start: () => Effect.die("Unused start"),
						recover: () => Effect.die("Unused recovery"),
						settle: () => Effect.die("Unused settlement"),
						finish: () => Effect.die("Unused completion"),
						pruneSettled: () => Effect.die("Unused retention"),
						dispatch: (id) =>
							Effect.sync(() => {
								dispatches.push(id);
							}),
						lockAccount: (account) => {
							expect(account).toEqual(subject.accountGeneration);
							return Effect.void;
						},
						admit: (job) =>
							Schema.decodeEffect(Schema.fromJsonString(BackgroundWorkInput))(
								JSON.stringify(job),
							).pipe(
								Effect.orDie,
								Effect.tap((persisted) => Effect.sync(() => admissions.push(persisted))),
								Effect.as(job.id),
							),
					}),
				);
				const context = yield* Layer.build(dependencies);
				const result = yield* Effect.gen(function* () {
					const host = yield* makeUserWorkScriptHost;
					const reference = { scriptSlug: "worker", referenceKind: "script" as const };
					const request = { scope: "scope", key: "same-key", input: { afterHooks: "skip" } };
					yield* host.requestUserWork(input, request, reference);
					const root = {
						...input,
						principal: { ...input.principal, subject: { ...subject, afterHooks: "skip" as const } },
					};
					const trustedRequest = {
						...request,
						key: "trusted-key",
						input: { afterHooks: "normal" },
					};
					const first = yield* host.requestUserWork(root, trustedRequest, reference);
					expect(yield* host.requestUserWork(root, trustedRequest, reference)).toEqual(first);
					const child = admissions[1];
					if (!child) {
						return yield* Effect.die("Missing child admission");
					}
					yield* host.requestUserWork(
						{ ...input, principal: { ...input.principal, subject: child.execution.subject } },
						{ ...trustedRequest, key: "grandchild-key" },
						reference,
					);
					return first;
				}).pipe(Effect.provide(context));
				expect(admissions).toHaveLength(4);
				expect(admissions[0]?.execution.subject).toEqual(subject);
				expect(admissions[2]).toEqual(admissions[1]);
				for (const admission of admissions.slice(1)) {
					expect(admission).toMatchObject({
						featureInput: null,
						purpose: "user-script",
						contentHash: "worker-hash",
						accountGeneration: subject.accountGeneration,
						execution: {
							lane: "background",
							pluginRevision: pin,
							resolutionMode: "exact",
							subject: { ...subject, afterHooks: "skip" },
						},
					});
				}
				expect(commands.map((command) => command.writeContext?.subject)).toEqual([
					subject,
					...Array.from({ length: 3 }, () => ({ ...subject, afterHooks: "skip" })),
				]);
				expect(dispatches).toEqual(admissions.map(({ id }) => id));
				expect(result.workId).toBe(admissions[1]?.id);
			}),
		),
);
