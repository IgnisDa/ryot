import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { DbError, SandboxRunError } from "@ryot/contract/errors";
import type { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import type {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot/contract/schema/brands";
import type { ProviderSearchItem } from "@ryot/sandbox-sdk/provider";
import { Context, type Effect } from "effect";

import type { AddEntityToCollectionWorkflowError } from "#modules/collections/add-entity-to-collection-workflow";
import type { LibraryEntityImportError } from "#modules/library-membership/library-entity-import-workflow";

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
		providerId: SandboxProviderId;
		executionId: string;
		identifierType: string;
	}) => Effect.Effect<{ externalId: string | null }, SandboxRunError, MediaSandboxRequirements>;
	searchEntities?: (input: {
		query: string;
		userId: UserId;
		providerId: SandboxProviderId;
		executionId: string;
	}) => Effect.Effect<ReadonlyArray<ProviderSearchItem>, SandboxRunError, MediaSandboxRequirements>;
	resolveProvider: (providerSlug: string) => Effect.Effect<
		{
			providerId: SandboxProviderId;
			entitySchemaSlug: EntitySchemaSlug;
		} | null,
		DbError
	>;
	importEntity: (input: {
		userId: UserId;
		externalId: string;
		providerId: SandboxProviderId;
		executionId: string;
		origin: AutomationOrigin;
		entitySchemaSlug: EntitySchemaSlug;
	}) => Effect.Effect<{ id: EntityId }, LibraryEntityImportError, MediaSandboxRequirements>;
	writeCollectionMembership: (input: {
		userId: UserId;
		entityId: EntityId;
		executionId: string;
		collectionId: EntityId;
	}) => Effect.Effect<void, AddEntityToCollectionWorkflowError, MediaSandboxRequirements>;
};

export class MediaImportWorkflowOperations extends Context.Tag("MediaImportWorkflowOperations")<
	MediaImportWorkflowOperations,
	MediaImportWorkflowOperationsValue
>() {}
