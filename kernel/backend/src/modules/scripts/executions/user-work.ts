import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { UserId } from "@ryot-app/contract/schema/brands";
import { sandboxHostEffect } from "@ryot-app/sandbox/host/invocation";
import { sandboxContextError } from "@ryot-app/sandbox/protocol/limits";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect } from "effect";

import { BackgroundWorkService } from "#modules/background-work/service";
import { DomainWriteChecks } from "#modules/entities/write-context";
import { requireSandboxCapabilityInput } from "#modules/scripts/authorization/capabilities";
import { isDeclaredExecutableCall } from "#modules/scripts/authorization/executable-dependencies";
import { sandboxLifecycleCommand, sandboxRunUserId } from "#modules/scripts/host/execution-context";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";

import type { AdditionalScriptHostImplementationMap } from "../authorization/capabilities";

export const makeUserWorkScriptHost = Effect.gen(function* () {
	const work = yield* BackgroundWorkService;
	const scripts = yield* SandboxRepository;
	const session = yield* DatabaseSession;
	const writes = yield* DomainWriteChecks;
	const requestUserWork: AdditionalScriptHostImplementationMap["requestUserWork"] = (
		rawInput,
		request,
		reference,
	) =>
		sandboxHostEffect(
			Effect.gen(function* () {
				const input = yield* requireSandboxCapabilityInput(rawInput, "requestUserWork");
				const userId = sandboxRunUserId(input);
				const pin = input.principal.pluginRevision;
				const account = input.principal.subject.accountGeneration;
				if (userId === null || !pin || !account || account.userId !== userId) {
					return yield* Effect.fail("User work requires a pinned user execution");
				}
				const contextError = sandboxContextError(request.input);
				if (contextError) {
					return yield* Effect.fail(contextError);
				}
				const dependency = {
					index: 0,
					name: "user-work",
					kind: "activity" as const,
					args: { input: request.input, scriptSlug: reference.scriptSlug },
				};
				if (!isDeclaredExecutableCall(input.principal.metadata, dependency)) {
					return yield* Effect.fail("User work target is not a declared dependency");
				}
				const target = yield* scripts.resolveWorkflowCallScript(pin, dependency);
				const contentHash = pin.compiledHashes[reference.scriptSlug];
				if (target?.kind !== "script" || !contentHash) {
					return yield* Effect.fail("User work target is unavailable");
				}
				const id = `user-work-${sha256Hex(stableStringify([account, pin.id, target.scriptId, request.key]))}`;
				const execution = {
					pluginRevision: pin,
					input: request.input,
					scriptId: target.scriptId,
					executionId: `${id}-script`,
					lane: "background" as const,
					resolutionMode: "exact" as const,
					subject: {
						type: "user" as const,
						accountGeneration: account,
						userId: UserId.make(userId),
					},
				};
				const command = yield* sandboxLifecycleCommand(input, "api", "requestUserWork");
				yield* session.transaction(
					Effect.gen(function* () {
						yield* work.lockAccount(account);
						yield* writes.check(command, definitionOwner(pin.id), UserId.make(userId), true);
						yield* work.admit({
							id,
							execution,
							contentHash,
							key: request.key,
							featureInput: null,
							scope: request.scope,
							purpose: "user-script",
							accountGeneration: account,
						});
					}),
				);
				yield* work.dispatch(id);
				return { workId: id };
			}),
		);
	return { requestUserWork };
});
