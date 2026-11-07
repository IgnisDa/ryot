import {
	AutomationExecutionId,
	EntityId,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import type { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { makeUserPluginRevision } from "#modules/scripts/authorization/principal.test-support";

import type { TranslationExecution, TranslationRequestPayload } from "./translation-request";

const userId = UserId.make("user-1");
const accountUserId = userId;
const providerId = SandboxProviderId.make("provider-1");

export const translationPrincipal = {
	providerId,
	scriptSlug: "translate",
	contentHash: "translation-hash",
	subject: { userId, type: "user" },
	scriptId: SandboxScriptId.make("translation-script"),
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
			accountUserId,
			lane: "interactive",
			itemIdentity: "translation",
			occurredAt: "2026-10-13T00:00:00.000Z",
			initiator: { id: userId, kind: "user" },
			executionId: AutomationExecutionId.make("exec-1"),
		}),
		writeContext: null,
	},
} satisfies TranslationRequestPayload;

export const translationExecution = {
	contentGeneration: 1,
	name: "Stored Record",
	entityScopeUserId: userId,
	principal: translationPrincipal,
	properties: { title: "Stored Record" },
} satisfies TranslationExecution;
