import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { SandboxRunError } from "@ryot/contract/errors";
import type {
	EntityId,
	EntitySchemaId,
	IntegrationId,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Context, type Effect } from "effect";

import type { EntitySearchItem } from "#modules/entity-import/population";

import type { ImportRunJobData } from "../jobs";
import type { LoadedMediaImportAdapterResult } from "./file-processor";
import type { LoadedMediaImportAdapterSuccess } from "./source-loaders";

type MediaSandboxRequirements = WorkflowEngine | WorkflowInstance;

export type MediaImportWorkflowOperationsValue = {
	loadAdapterResult: (
		payload: ImportRunJobData,
	) => Effect.Effect<
		LoadedMediaImportAdapterSuccess | LoadedMediaImportAdapterResult,
		{ cleanupPaths: ReadonlyArray<string>; message: string }
	>;
	resolveExternalId: (input: {
		value: string;
		userId: UserId;
		executionId: string;
		identifierType: string;
		scriptId: SandboxScriptId;
	}) => Effect.Effect<{ externalId: string | null }, SandboxRunError, MediaSandboxRequirements>;
	searchEntities?: (input: {
		query: string;
		userId: UserId;
		executionId: string;
		scriptId: SandboxScriptId;
	}) => Effect.Effect<ReadonlyArray<EntitySearchItem>, SandboxRunError, MediaSandboxRequirements>;
	importEntity: (input: {
		userId: UserId;
		externalId: string;
		executionId: string;
		scriptId: SandboxScriptId;
		entitySchemaId: EntitySchemaId;
	}) => Effect.Effect<{ id: EntityId }, SandboxRunError, MediaSandboxRequirements>;
};

export class MediaImportWorkflowOperations extends Context.Tag("MediaImportWorkflowOperations")<
	MediaImportWorkflowOperations,
	MediaImportWorkflowOperationsValue
>() {}

export type MediaImportWorkflowOptions = {
	integrationId?: IntegrationId;
};
