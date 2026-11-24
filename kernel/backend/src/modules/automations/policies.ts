import { DbError, SandboxFailureKind, unknownToMessage } from "@ryot-app/contract/errors";
import {
	AutomationEntityDraft,
	AutomationPolicyBatchInput,
	AutomationPolicyBatchOutput,
	type AutomationPolicyReference,
	type AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	DEFAULT_POLICY_HOOK_POSITION,
	type PluginBeforeHook,
} from "@ryot-app/contract/modules/plugins/manifest";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { SandboxScriptManifest } from "@ryot-app/contract/modules/scripts/schemas";
import {
	AutomationHookSlug,
	EntityId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";
import { SecureRandom } from "effect/crypto";

import { automationRunSubject } from "#modules/automations/lifecycle/command";
import { lifecycleRunId } from "#modules/automations/lifecycle/planning";
import {
	AutomationPolicyExecutionError,
	LifecyclePolicies,
	type LifecyclePolicy,
	type LifecyclePolicyItem,
} from "#modules/automations/lifecycle/policies";
import { EntitiesRepository } from "#modules/entities/repository";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { ScriptCalls } from "#modules/scripts/executions/calls";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import type { WriteTransaction } from "#platform/db/write-transaction";

import { projectAutomationPolicyInput } from "./input-projection";
import { AutomationPlannerResolver, matchesTarget } from "./planner-resolver";

class PolicyCallFailed extends Schema.TaggedError<
	PolicyCallFailed,
	{ readonly brand: unique symbol }
>()("PolicyCallFailed", { message: Schema.String, kind: SandboxFailureKind }) {}

const comparePolicies = (left: LifecyclePolicy, right: LifecyclePolicy) =>
	left.position - right.position ||
	left.pluginId.localeCompare(right.pluginId) ||
	left.hook.slug.localeCompare(right.hook.slug);

export const LifecyclePoliciesLive = Layer.effect(
	LifecyclePolicies,
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const resolver = yield* AutomationPlannerResolver;
		const scripts = yield* SandboxRepository;
		const entities = yield* EntitiesRepository;
		const admission = yield* AccountAdmission.make;
		const calls = yield* ScriptCalls;
		const random = yield* SecureRandom.SecureRandom;

		const match = Effect.fn("LifecyclePolicies.match")(function* (
			trigger: AutomationTrigger,
			transaction: WriteTransaction,
		) {
			if (trigger.payload?.category !== "request") {
				return yield* new DbError({ message: "Policies match only request triggers" });
			}
			yield* resolver.lockCatalog([trigger.scopeUserId], transaction);
			const matches = yield* resolver.resolve(trigger, trigger.scopeUserId, transaction);
			const policies = yield* Effect.forEach(
				matches,
				({ hook, plugin, script, executionUserId }) => {
					if (hook.stage !== "before" || plugin?.pluginConfigRevisionId == null) {
						return Effect.fail(new DbError({ message: `Invalid policy ${hook.slug}` }));
					}
					const pluginId = PluginId.make(plugin.id);
					return Effect.succeed<LifecyclePolicy>({
						hook,
						pluginId,
						executionUserId,
						position: hook.position ?? DEFAULT_POLICY_HOOK_POSITION,
						script: {
							slug: script.slug,
							contentHash: script.contentHash,
							id: SandboxScriptId.make(script.id),
						},
						runId: lifecycleRunId({
							pluginId,
							executionUserId,
							triggerId: trigger.id,
							hookSlug: AutomationHookSlug.make(hook.slug),
						}),
						plugin: {
							revisionId: PluginRevisionId.make(plugin.pluginRevisionId),
							configRevisionId: PluginConfigRevisionId.make(plugin.pluginConfigRevisionId),
						},
					});
				},
			);
			return [...policies].sort(comparePolicies);
		});

		const prepare = Effect.fnUntraced(function* (input: {
			readonly policy: LifecyclePolicy;
			readonly trigger: AutomationTrigger;
			readonly items: ReadonlyArray<LifecyclePolicyItem>;
			readonly references: Readonly<Record<string, AutomationEntityDraft>>;
		}) {
			const { policy, trigger } = input;
			const fail = (message: string, kind: SandboxFailureKind = "invalid-input") =>
				new PolicyCallFailed({
					kind,
					message: `Policy '${policy.hook.slug}' of plugin '${policy.pluginId}' ${message}`,
				});
			const pin = yield* scripts
				.getScriptPin(policy.script.id, {
					id: policy.pluginId,
					revisionId: policy.plugin.revisionId,
					configRevisionId: policy.plugin.configRevisionId,
				})
				.pipe(
					Effect.catchTag("SandboxRunError", (error) =>
						Effect.fail(fail(error.message, error.kind)),
					),
				);
			if (!pin || pin.contentHash !== policy.script.contentHash) {
				return yield* fail("has no pinned script", "missing-artifact");
			}
			const manifest = yield* Schema.decodeUnknownEffect(SandboxScriptManifest)(pin.metadata).pipe(
				Effect.mapError(() => fail("has an invalid script declaration")),
			);
			if (manifest.kind !== "automation" || manifest.automationType !== "policy") {
				return yield* fail("has an incompatible script declaration");
			}
			const hook: typeof PluginBeforeHook.Type = policy.hook;
			const owner = definitionOwner(policy.pluginId);
			const subjects = new Set<string>();
			const selected = input.items.filter((item) => {
				if (
					!hook.targets.some((target) =>
						matchesTarget(owner, target, { ...trigger, payload: item.request }),
					)
				) {
					return false;
				}
				if (item.request.resource !== "event" || hook.batchFrequency !== "once-per-subject") {
					return true;
				}
				const subject = item.request.draft.entityId;
				if (subjects.has(subject)) {
					return false;
				}
				subjects.add(subject);
				return true;
			});
			const referenceIds = [
				...new Set(
					selected.flatMap(({ request }) =>
						request.resource === "event"
							? [request.draft.entityId, request.draft.sessionEntityId].flatMap((id) =>
									id === null || input.references[id] ? [] : [id],
								)
							: [],
					),
				),
			];
			const loaded =
				referenceIds.length === 0 || policy.executionUserId === null
					? []
					: yield* entities.getByIdsForUser({
							userId: policy.executionUserId,
							entityIds: referenceIds.map((id) => EntityId.make(id)),
						});
			const drafts: Record<string, AutomationEntityDraft> = { ...input.references };
			for (const [id, reference] of loaded) {
				drafts[id] = yield* Schema.decodeUnknownEffect(AutomationEntityDraft)({
					name: reference.name,
					properties: reference.properties,
					providerId: reference.providerId,
					externalId: reference.externalId,
					populatedAt: reference.populatedAt,
					entitySchemaSlug: reference.entitySchemaSlug,
					entitySchemaPluginId: reference.entitySchemaPluginId,
				}).pipe(Effect.mapError(() => fail("received an invalid reference")));
			}
			const items: Array<AutomationPolicyBatchInput["items"][number]> = [];
			const references: Record<string, typeof AutomationPolicyReference.Type> = {};
			for (const item of selected) {
				const request = projectAutomationPolicyInput(item.request, manifest.inputProjection);
				if (!request) {
					return yield* fail("does not project the request resource");
				}
				const projection = manifest.inputProjection[request.resource];
				if (request.resource === "event" && projection) {
					for (const [id, names] of [
						[request.draft.entityId, projection.entityProperties ?? []],
						[request.draft.sessionEntityId, projection.sessionEntityProperties ?? []],
					] as const) {
						const reference = id === null ? undefined : drafts[id];
						if (reference && id !== null) {
							references[id] = {
								entitySchemaSlug: reference.entitySchemaSlug,
								entitySchemaPluginId: reference.entitySchemaPluginId,
								properties: {
									...references[id]?.properties,
									...Object.fromEntries(
										names.flatMap((name) => {
											const value = reference.properties[name];
											return value === undefined ? [] : [[name, value]];
										}),
									),
								},
							};
						}
					}
				}
				items.push({ payload: request, itemIdentity: item.itemIdentity });
			}
			const accountUserId =
				policy.executionUserId === null
					? null
					: yield* admission.currentAccount(policy.executionUserId);
			const subject = automationRunSubject(
				{
					trigger,
					accountUserId,
					stage: "before",
					runId: policy.runId,
					executionUserId: policy.executionUserId,
				},
				{
					pluginId: policy.pluginId,
					pluginRevisionId: policy.plugin.revisionId,
					pluginConfigRevisionId: policy.plugin.configRevisionId,
				},
			);
			const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({
				...pin,
				subject,
			}).pipe(Effect.mapError(() => fail("does not produce a valid principal")));
			const invocation = yield* Schema.decodeEffect(AutomationPolicyBatchInput)({
				items,
				automation: {
					references,
					runId: policy.runId,
					hookSlug: hook.slug,
					triggerId: trigger.id,
					causation: trigger.causation,
					occurredAt: trigger.occurredAt,
					executionUserId: policy.executionUserId,
					...(hook.metadata === undefined ? {} : { hookMetadata: hook.metadata }),
				},
			}).pipe(Effect.mapError(() => fail("does not produce a valid invocation")));
			return { fail, principal, invocation };
		});

		const run = Effect.fn("LifecyclePolicies.run")(function* (
			input: Parameters<LifecyclePolicies["Service"]["run"]>[0],
		) {
			const { policy, trigger } = input;
			return yield* Effect.gen(function* () {
				const { fail, principal, invocation } = yield* session
					.transaction(prepare(input))
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
				if (invocation.items.length === 0) {
					return { items: [] };
				}
				const result = yield* calls.run({
					principal,
					input: invocation,
					lane: trigger.causation.lane,
					executionId: `policy-${yield* random.uuidV4()}`,
				});
				if (result.error) {
					return yield* fail(
						`failed with ${result.error.kind} during ${result.error.phase}: ${result.error.message}`,
						result.error.kind,
					);
				}
				const output = yield* Schema.decodeUnknownEffect(AutomationPolicyBatchOutput)(
					result.value,
				).pipe(
					Effect.mapError((error) => fail(`returned ${unknownToMessage(error)}`, "invalid-output")),
				);
				const expected = new Set(invocation.items.map((item) => item.itemIdentity));
				const actual = new Set(output.items.map((item) => item.itemIdentity));
				if (
					actual.size !== output.items.length ||
					actual.size !== expected.size ||
					[...actual].some((identity) => !expected.has(identity))
				) {
					return yield* fail("must decide each item exactly once", "invalid-output");
				}
				return output;
			}).pipe(
				Effect.catchTag("PolicyCallFailed", (error) =>
					Effect.logWarning("Policy call failed", error).pipe(
						Effect.andThen(
							new AutomationPolicyExecutionError({
								kind: error.kind,
								runId: policy.runId,
								code: "policy-execution-failed",
							}),
						),
					),
				),
			);
		});

		return LifecyclePolicies.of({ run, match });
	}),
);
