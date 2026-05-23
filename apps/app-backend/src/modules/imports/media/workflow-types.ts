import type { Effect } from "effect";

import type { SandboxRunError } from "#lib/errors";
import type {
	EntityId,
	EntitySchemaId,
	IntegrationId,
	SandboxScriptId,
	UserId,
} from "#lib/schema/brands";
import type { EntitySearchItem } from "#modules/entity-import/population";

import type { ImportRunJobData } from "../jobs";
import type { LoadedMediaImportAdapterResult } from "./file-processor";
import type { LoadedMediaImportAdapterSuccess } from "./source-loaders";

export type MediaImportWorkflowOperations<
	RLoad,
	RResolve,
	RImport,
	RSearch = never,
	RCleanup = never,
> = {
	cleanupArtifacts: (input: {
		cleanupPaths: ReadonlyArray<string>;
		sourcePayloadKey?: string;
	}) => Effect.Effect<void, unknown, RCleanup>;
	loadAdapterResult: (
		payload: ImportRunJobData,
	) => Effect.Effect<
		LoadedMediaImportAdapterSuccess | LoadedMediaImportAdapterResult,
		{ cleanupPaths: ReadonlyArray<string>; message: string },
		RLoad
	>;
	resolveExternalId: (input: {
		value: string;
		userId: UserId;
		scriptId: SandboxScriptId;
		executionId: string;
		identifierType: string;
	}) => Effect.Effect<{ externalId: string | null }, SandboxRunError, RResolve>;
	searchEntities?: (input: {
		query: string;
		userId: UserId;
		scriptId: SandboxScriptId;
		executionId: string;
	}) => Effect.Effect<ReadonlyArray<EntitySearchItem>, SandboxRunError, RSearch>;
	importEntity: (input: {
		userId: UserId;
		scriptId: SandboxScriptId;
		externalId: string;
		executionId: string;
		entitySchemaId: EntitySchemaId;
		activityPrefix: string;
	}) => Effect.Effect<{ id: EntityId }, SandboxRunError, RImport>;
};

export type MediaImportWorkflowOptions = {
	integrationId?: IntegrationId;
	skipMarkStarted?: boolean;
};
