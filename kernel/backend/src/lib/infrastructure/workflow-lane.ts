import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { type Effect, Layer, type Schema } from "effect";
import { ClusterSchema } from "effect/cluster";
import { Workflow } from "effect/workflow";

import { implementWorkflow } from "./workflow-scope";

export const interactiveShardGroup = "interactive";

export const laneWorkflow = <
	const Tag extends string,
	Payload extends Schema.Struct.Fields | Workflow.AnyStructSchema,
	Success extends Schema.Top = Schema.Void,
	Error extends Schema.Top = Schema.Never,
>(
	tag: Tag,
	options: Parameters<typeof Workflow.make<Tag, Payload, Success, Error>>[1],
) => {
	const background = Workflow.make(tag, options);
	const interactive = Workflow.make(`${tag}Interactive`, options).annotate(
		ClusterSchema.ShardGroup,
		() => interactiveShardGroup,
	);
	const forLane = (lane: ExecutionLane) => (lane === "interactive" ? interactive : background);
	return { forLane, background, interactive };
};

export const implementLaneWorkflow = <
	Payload extends Workflow.AnyStructSchema,
	Success extends Schema.Top,
	Error extends Schema.Top,
	R,
>(
	workflow: {
		readonly background: Workflow.Workflow<string, Payload, Success, Error>;
		readonly interactive: Workflow.Workflow<string, Payload, Success, Error>;
	},
	execute: (
		payload: Payload["Type"],
		executionId: string,
	) => Effect.Effect<Success["Type"], Error["Type"], R>,
) =>
	Layer.mergeAll(
		implementWorkflow(workflow.background, execute),
		implementWorkflow(workflow.interactive, execute),
	);
