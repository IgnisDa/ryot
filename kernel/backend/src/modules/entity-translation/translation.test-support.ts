import {
	AutomationExecutionId,
	EntityId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { makeUserPluginRevision } from "#lib/test-utils/sandbox-runtime";

import type {
	TranslateEntityWorkflowPayload,
	TranslationExecution,
} from "./entity-translation-workflow";

const userId = UserId.make("user-1");
const accountGeneration = { userId, token: "test-account-generation" };

export const translationPayload = {
	userId,
	language: "es",
	accountGeneration,
	lane: "interactive",
	externalId: "ext-1",
	executionId: "exec-1",
	entitySchemaSlug: "record",
	entityId: EntityId.make("entity-1"),
	properties: { title: "Test Record" },
	entitySchemaPluginId: "translation-plugin",
	providerId: SandboxProviderId.make("provider-1"),
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
	entityScopeUserId: userId,
	properties: { title: "Stored Record" },
	principal: {
		scriptSlug: "translate",
		contentHash: "translation-hash",
		providerId: translationPayload.providerId,
		metadata: { kind: "provider", runtimeImports: [] },
		scriptId: SandboxScriptId.make("translation-script"),
		subject: { userId, type: "user", accountGeneration },
		pluginRevision: makeUserPluginRevision({
			ownerId: userId,
			slug: "translation-plugin",
			compiledHashes: { translate: "translation-hash" },
		}),
	},
} satisfies TranslationExecution;
