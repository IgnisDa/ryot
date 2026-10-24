import { expect, it } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { ExecutionFileStore } from "@ryot-app/sandbox/host/execution-files";
import { Effect, Layer } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import {
	makeUserPluginRevision,
	makeUserPrincipal,
} from "#modules/scripts/authorization/principal.test-support";
import { KernelWorkflowReferences } from "#modules/scripts/registry/kernel-workflow-references";
import { makeWorkflowEngine } from "#testing/effect";

import { performSandboxWorkflowChild, ScriptExecutionWorkflow } from "./workflow";
import type { ScriptExecutionWorkflowPayload } from "./workflow-payload";

it.effect("pins trusted suppression on workflow children and refuses kernel workflow escapes", () =>
	Effect.scoped(
		Effect.gen(function* () {
			const userId = UserId.make("child-owner");
			const subject = {
				userId,
				type: "user" as const,
				accountGeneration: { userId, token: "test-account-generation" },
			};
			const pluginRevision = makeUserPluginRevision({
				slug: "plugin",
				ownerId: userId,
				compiledHashes: {},
			});
			const principal = makeUserPrincipal({
				pluginRevision,
				subject: { ...subject, afterHooks: "skip" },
			});
			const payload: ScriptExecutionWorkflowPayload = {
				subject,
				input: {},
				pluginRevision,
				lane: "background",
				executionId: "parent",
				resolutionMode: "exact",
				scriptId: principal.scriptId,
			};
			const children: unknown[] = [];
			const artifacts: string[] = [];
			const kernelCalls: string[] = [];
			const dependencies = Layer.mergeAll(
				mutationAdmissionTestLayer,
				Layer.succeed(
					WorkflowInstance,
					WorkflowInstance.initial(ScriptExecutionWorkflow, "parent"),
				),
				Layer.succeed(
					WorkflowEngine,
					makeWorkflowEngine({
						activityExecute: (activity) =>
							Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
						execute: (_workflow, options) =>
							Effect.sync(() => {
								children.push(options.payload);
								return null;
							}),
					}),
				),
				Layer.succeed(ExecutionFileStore, {
					resolveOutputs: () => Effect.die("Unused output resolution"),
					materializeInputs: () => Effect.die("Unused input materialization"),
					materializeOutputs: () => Effect.die("Unused output materialization"),
					retain: () =>
						Effect.sync(() => {
							artifacts.push("retain");
						}),
					release: () =>
						Effect.sync(() => {
							artifacts.push("release");
						}),
				}),
				Layer.succeed(KernelWorkflowReferences, {
					resolveArtifactGrants: () => Effect.die("Unused artifact grant"),
					execute: (slug) =>
						Effect.sync(() => {
							kernelCalls.push(slug);
							return null;
						}),
				}),
			);
			const context = yield* Layer.build(dependencies);
			yield* Effect.gen(function* () {
				yield* performSandboxWorkflowChild(
					{
						index: 0,
						name: "child",
						kind: "workflow-child",
						args: { workflowSlug: "child", input: { afterHooks: "normal" } },
					},
					SandboxScriptId.make("child-script"),
					payload,
					"parent",
					principal,
				);
				const failure = yield* Effect.flip(
					performSandboxWorkflowChild(
						{
							index: 1,
							name: "kernel",
							kind: "workflow-child",
							args: { input: {}, workflowSlug: "kernel:entity-import" },
						},
						undefined,
						payload,
						"parent",
						principal,
					),
				);
				expect(failure.message).toBe(
					"Kernel workflow references are not available when after hooks are skipped",
				);
			}).pipe(Effect.provide(context));
			expect(children).toMatchObject([
				{
					pluginRevision,
					lane: "background",
					resolutionMode: "exact",
					input: { afterHooks: "normal" },
					subject: { ...subject, afterHooks: "skip" },
				},
			]);
			expect(artifacts).toEqual(["retain", "release"]);
			expect(kernelCalls).toEqual([]);
		}),
	),
);
