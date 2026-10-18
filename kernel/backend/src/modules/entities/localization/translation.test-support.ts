import {
	AutomationExecutionId,
	EntityId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import type { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { makeUserPluginRevision } from "#modules/scripts/authorization/principal.test-support";

import type {
	TranslateEntityWorkflowPayload,
	TranslationExecution,
} from "./entity-translation-workflow";

const userId = UserId.make("user-1");
const accountGeneration = { userId, token: "test-account-generation" };
const providerId = SandboxProviderId.make("provider-1");

export const translationPrincipal = {
	providerId,
	scriptSlug: "translate",
	contentHash: "translation-hash",
	scriptId: SandboxScriptId.make("translation-script"),
	subject: { userId, type: "user", accountGeneration },
	metadata: { kind: "provider", runtimeImports: [], translationInputs: { record: ["title"] } },
	pluginRevision: makeUserPluginRevision({
		ownerId: userId,
		slug: "translation-plugin",
		compiledHashes: { translate: "translation-hash" },
	}),
} satisfies ScriptExecutionPrincipal;

export const translationPayload = {
	userId,
	providerId,
	language: "es",
	accountGeneration,
	lane: "interactive",
	externalId: "ext-1",
	contentGeneration: 1,
	executionId: "exec-1",
	entityScopeUserId: userId,
	entitySchemaSlug: "record",
	principal: translationPrincipal,
	entityId: EntityId.make("entity-1"),
	entitySchemaPluginId: "translation-plugin",
	command: {
		...rootLifecycleCommand({
			source: "api",
			accountGeneration,
			lane: "interactive",
			itemIdentity: "translation",
			occurredAt: "2026-10-13T00:00:00.000Z",
			initiator: { id: userId, kind: "user" },
			executionId: AutomationExecutionId.make("exec-1"),
		}),
		writeContext: null,
	},
} satisfies TranslateEntityWorkflowPayload;

export const translationExecution = {
	contentGeneration: 1,
	name: "Stored Record",
	entityScopeUserId: userId,
	principal: translationPrincipal,
	properties: { title: "Stored Record" },
} satisfies TranslationExecution;

export const translationRequestRow = (
	input: Parameters<EnrichmentRequests["Service"]["ensure"]>[0],
) => ({
	...input,
	attempt: 0,
	sequence: 1,
	failureKind: null,
	completedAt: null,
	nextAttemptAt: null,
	createdAt: new Date(0),
	observedAt: new Date(0),
	state: "queued" as const,
	registrationReleasedAt: null,
	retryOf: input.retryOf ?? null,
	dispatchRoot: input.dispatchRoot ?? false,
	requesterUserId: input.requester?.userId ?? null,
	requesterGeneration: input.requester?.token ?? null,
	sourceContentGeneration: input.sourceContentGeneration ?? null,
});
