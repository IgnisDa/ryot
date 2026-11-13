import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot-app/contract/errors";
import type { PageDraftBuildIdentity } from "@ryot-app/contract/modules/pages/identity";
import type { AuthorizationContext, WriteAccess } from "@ryot-app/contract/oauth";
import {
	type AgentToolDescriptor,
	AgentToolName,
	agentTools,
	DiscoveryInput,
	ExecuteInput,
	PageEditInput,
	PagePublishInput,
	PageReadInput,
	PageWriteInput,
	ReadDocsInput,
} from "@ryot-app/contract/schema/agent-tool";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import type { AgentToolResult } from "@ryot-app/contract/schema/tool-result";
import { toSandboxHostError } from "@ryot-app/sandbox/host/invocation";
import { Context, Effect, Layer, Schema } from "effect";
import type { Headers as PlatformHeaders } from "effect/http";

import { AuthService } from "#modules/accounts/auth/service";
import { PageAuthoringService } from "#modules/pages/authoring/service";
import { AgentRunSuspended, AgentScriptService } from "#modules/scripts/agent/service";
import {
	defaultResultByteBudget,
	minimumResultByteBudget,
	truncateJsonResult,
} from "#platform/tool-result";

import { type AgentAccount, CapabilityCatalog, capabilityNamespaces } from "./catalog";
import { AgentDocs, listAgentDocs, readAgentDocs } from "./docs";
import {
	credentialWriteGate,
	executeSource,
	referencedCapabilities,
	type WriteGate,
} from "./execute";
import { applyPageEdits, readPageDraft } from "./page-files";
import { searchCapabilities } from "./search";

export type AgentToolOutcome =
	| { readonly state: "suspended" }
	| {
			readonly state: "completed";
			readonly result: AgentToolResult;
			readonly preview?: PageDraftBuildIdentity;
	  };
type AgentToolCall = {
	readonly name: string;
	readonly byteBudget?: number;
	readonly arguments: JsonValue;
	readonly idempotencyKey?: string;
};
type AgentToolInvocation = AgentToolCall & {
	readonly resource?: string;
	readonly confirm: null | WriteGate;
	readonly headers?: PlatformHeaders.Headers;
};

const decode = <A, I>(schema: Schema.Codec<A, I>, value: unknown) =>
	Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(value).pipe(
		Effect.mapError((error) => new BadRequest({ message: error.message })),
	);
const decodeToolInput = (name: AgentToolName, value: JsonValue) => {
	if (name === "search") {
		return decode(DiscoveryInput, value).pipe(
			Effect.map((input) => ({ input, name: "search" as const })),
		);
	}
	if (name === "execute") {
		return decode(ExecuteInput, value).pipe(
			Effect.map((input) => ({ input, name: "execute" as const })),
		);
	}
	if (name === "read_docs") {
		return decode(ReadDocsInput, value).pipe(
			Effect.map((input) => ({ input, name: "read_docs" as const })),
		);
	}
	if (name === "page_read") {
		return decode(PageReadInput, value).pipe(
			Effect.map((input) => ({ input, name: "page_read" as const })),
		);
	}
	if (name === "page_edit") {
		return decode(PageEditInput, value).pipe(
			Effect.map((input) => ({ input, name: "page_edit" as const })),
		);
	}
	if (name === "page_write") {
		return decode(PageWriteInput, value).pipe(
			Effect.map((input) => ({ input, name: "page_write" as const })),
		);
	}
	return decode(PagePublishInput, value).pipe(
		Effect.map((input) => ({ input, name: "page_publish" as const })),
	);
};
const keyed = (key: string | undefined, suffix: string) =>
	key === undefined ? undefined : `${key}:${suffix}`;

type ToolAuthority = Pick<AuthorizationContext, "accessClass" | "writeAccess">;

const writesDirectly = (tool: AgentToolDescriptor) =>
	!tool.hints.readOnly && tool.approval !== "per-write";

export const availableAgentTools = (authority: ToolAuthority): readonly AgentToolDescriptor[] =>
	AgentToolName.literals
		.map((name) => agentTools[name])
		.filter(
			(tool) =>
				(authority.accessClass !== "demo" && authority.writeAccess !== "none") ||
				!writesDirectly(tool),
		);

export const requiresCallConfirmation = (tool: AgentToolDescriptor, writeAccess: WriteAccess) =>
	tool.approval === "call" && writeAccess === "confirm";

export const agentToolHints = (tool: AgentToolDescriptor, writeAccess: WriteAccess) => ({
	idempotent: tool.hints.idempotent,
	readOnly: tool.hints.readOnly || writeAccess === "none",
	destructive: tool.hints.destructive && writeAccess === "unattended",
});

export class AgentToolsService extends Context.Service<AgentToolsService>()(
	"@ryot-app/kernel-backend/modules/agent-tools/service/AgentToolsService",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthService;
			const catalog = yield* CapabilityCatalog;
			const scripts = yield* AgentScriptService;
			const pages = yield* PageAuthoringService;
			const docs = yield* AgentDocs;
			const validateForAccount = Effect.fn("AgentToolsService.validate")(function* (
				account: AgentAccount,
				call: AgentToolCall,
			) {
				const name = yield* decode(AgentToolName, call.name).pipe(
					Effect.mapError(() => new NotFound({ message: `Unknown agent tool: ${call.name}` })),
				);
				const tool = availableAgentTools(account.authorization).find(
					(candidate) => candidate.name === name,
				);
				if (!tool) {
					return yield* new DemoOperationProtected({
						reason: { code: "demo-operation-protected" },
					});
				}
				const decoded = yield* decodeToolInput(name, call.arguments);
				return {
					tool,
					decoded,
					requiresApproval: requiresCallConfirmation(tool, account.authorization.writeAccess),
				};
			});
			const execute = Effect.fn("AgentToolsService.execute")(function* (
				account: AgentAccount,
				code: string,
				invocation: AgentToolInvocation,
			) {
				const capabilities = yield* catalog.list(account);
				const gate = credentialWriteGate(account.authorization.writeAccess, invocation.confirm);
				const run = yield* scripts.run({
					userId: account.user.id,
					accessClass: account.authorization.accessClass,
					source: executeSource(code, referencedCapabilities(code, capabilities)),
					...(invocation.idempotencyKey === undefined
						? {}
						: { idempotencyKey: invocation.idempotencyKey }),
					invokeCapability: (request, hostCall) =>
						Effect.gen(function* () {
							const entry = yield* catalog.resolve(account, request.id);
							const options = {
								idempotencyKey: hostCall.key,
								...(invocation.headers === undefined ? {} : { headers: invocation.headers }),
								...(invocation.resource === undefined ? {} : { resource: invocation.resource }),
							};
							if (entry.capability.hints.readOnly) {
								return yield* catalog.invoke(account, entry, request.input, options);
							}
							const write = {
								input: request.input,
								index: hostCall.index,
								capability: entry.capability,
							};
							const decision = yield* gate.authorize(write);
							if (!decision.approved) {
								return yield* new BadRequest({ message: decision.reason });
							}
							return yield* catalog.invoke(account, entry, request.input, options).pipe(
								Effect.tapError((error) =>
									gate.settle(write, { state: "failure", message: error.message }),
								),
								Effect.tap((value) => gate.settle(write, { value, state: "success" })),
							);
						}).pipe(
							Effect.mapError((error) =>
								error instanceof AgentRunSuspended ? error : toSandboxHostError(error),
							),
						),
				});
				return run;
			});
			const pageWrite = Effect.fn("AgentToolsService.pageWrite")(function* (
				account: AgentAccount,
				input: PageWriteInput,
				idempotencyKey: string | undefined,
			) {
				const actor = { userId: account.user.id, kind: "assistant" as const };
				const draftKey = keyed(idempotencyKey, "draft");
				let draft: { readonly pageId: string; readonly draftRevision: number };
				if (input.pageId != null && input.expectedDraftRevision != null) {
					draft = yield* pages.replaceDraft(
						actor,
						{
							pageId: input.pageId,
							definition: input.definition,
							expectedDraftRevision: input.expectedDraftRevision,
						},
						draftKey,
					);
				} else if (input.name != null && input.slug != null) {
					draft = yield* pages.create(
						actor,
						{ name: input.name, slug: input.slug, definition: input.definition },
						draftKey,
					);
				} else {
					return yield* new BadRequest({
						message:
							"Supply name and slug to create a page, or pageId and expectedDraftRevision to replace a draft",
					});
				}
				return yield* compileDraft(account, draft, idempotencyKey);
			});
			const pageEdit = Effect.fn("AgentToolsService.pageEdit")(function* (
				account: AgentAccount,
				input: PageEditInput,
				idempotencyKey: string | undefined,
			) {
				const draft = yield* pages.editDraft(
					{ kind: "assistant", userId: account.user.id },
					{ pageId: input.pageId, expectedDraftRevision: input.expectedDraftRevision },
					{ request: input, apply: (definition) => applyPageEdits(definition, input) },
					keyed(idempotencyKey, "draft"),
				);
				return yield* compileDraft(account, draft, idempotencyKey);
			});
			const compileDraft = Effect.fn(function* (
				account: AgentAccount,
				draft: { readonly pageId: string; readonly draftRevision: number },
				idempotencyKey: string | undefined,
			) {
				return yield* pages
					.compile(
						account.user.id,
						{ pageId: draft.pageId, expectedDraftRevision: draft.draftRevision },
						keyed(idempotencyKey, "compile"),
					)
					.pipe(
						Effect.map((preview) => ({ preview, value: preview })),
						Effect.catchTag("PageAuthoringError", (error) =>
							error.reason.code === "build-failed" || error.reason.code === "definition-invalid"
								? Effect.succeed({
										preview: undefined,
										value: {
											...draft,
											error: error.reason,
											instruction: "Repair the page with page_edit using this draftRevision.",
										},
									})
								: Effect.fail(error),
						),
					);
			});
			const callForAccount = Effect.fn("AgentToolsService.call")(function* (
				account: AgentAccount,
				invocation: AgentToolInvocation,
			) {
				const byteBudget = invocation.byteBudget ?? defaultResultByteBudget;
				if (!Number.isSafeInteger(byteBudget) || byteBudget < minimumResultByteBudget) {
					return yield* new BadRequest({
						message: `Result byte budget must be an integer of at least ${minimumResultByteBudget}`,
					});
				}
				const { decoded } = yield* validateForAccount(account, invocation);
				const completed = (value: unknown, preview?: PageDraftBuildIdentity) =>
					Schema.decodeUnknownEffect(JsonValue)(value).pipe(
						Effect.orDie,
						Effect.map((json): AgentToolOutcome => ({
							state: "completed",
							result: truncateJsonResult(json, byteBudget),
							...(preview === undefined ? {} : { preview }),
						})),
					);
				if (decoded.name === "search") {
					const capabilities = yield* catalog.list(account);
					return yield* completed(
						searchCapabilities(capabilities, capabilityNamespaces(capabilities), decoded.input),
					);
				}
				if (decoded.name === "execute") {
					const run = yield* execute(account, decoded.input.code, invocation);
					if (run.state === "suspended") {
						return run;
					}
					return yield* completed(run.result.truncated ? run.result : run.result.value);
				}
				if (decoded.name === "read_docs") {
					const { page, topic } = decoded.input;
					return yield* completed(
						topic == null
							? listAgentDocs(docs)
							: yield* readAgentDocs(docs, topic, page ?? undefined),
					);
				}
				if (decoded.name === "page_read") {
					const draft = yield* pages.readDraft(account.user.id, decoded.input.pageId);
					return yield* completed(
						yield* Effect.fromResult(readPageDraft(draft, decoded.input)).pipe(
							Effect.mapError((message) => new BadRequest({ message })),
						),
					);
				}
				if (decoded.name === "page_edit") {
					const edited = yield* pageEdit(account, decoded.input, invocation.idempotencyKey);
					return yield* completed(edited.value, edited.preview);
				}
				if (decoded.name === "page_write") {
					const written = yield* pageWrite(account, decoded.input, invocation.idempotencyKey);
					return yield* completed(written.value, written.preview);
				}
				return yield* completed(
					yield* pages.publish(account.user.id, decoded.input, invocation.idempotencyKey),
				);
			});
			const list = (headers: PlatformHeaders.Headers, resource?: string) =>
				auth
					.resolveRequestCredential(new Headers(headers), resource)
					.pipe(Effect.map((account) => availableAgentTools(account.authorization)));
			const call = (input: AgentToolInvocation & { readonly headers: PlatformHeaders.Headers }) =>
				auth
					.resolveRequestCredential(new Headers(input.headers), input.resource)
					.pipe(Effect.flatMap((account) => callForAccount(account, input)));
			const listTrusted = (userId: UserId) =>
				auth
					.resolveTrustedAccount(userId)
					.pipe(Effect.map((account) => availableAgentTools(account.authorization)));
			const validateTrusted = (userId: UserId, input: AgentToolCall) =>
				auth.resolveTrustedAccount(userId).pipe(
					Effect.flatMap((account) => validateForAccount(account, input)),
					Effect.map(({ tool, requiresApproval }) => ({ tool, requiresApproval })),
				);
			const callTrusted = (
				userId: UserId,
				input: AgentToolInvocation & { readonly idempotencyKey: string },
			) =>
				auth
					.resolveTrustedAccount(userId)
					.pipe(Effect.flatMap((account) => callForAccount(account, input)));
			return { list, call, listTrusted, callTrusted, validateTrusted };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
