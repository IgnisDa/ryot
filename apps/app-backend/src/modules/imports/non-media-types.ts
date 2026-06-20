import type { FileSystem } from "@effect/platform";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { ImportRunFailureStage } from "@ryot/contract/modules/imports/types";
import { Context, type Effect, Schema } from "effect";

import type { AppConfig } from "#lib/infrastructure/config/service";
import type { DbRunner } from "#lib/infrastructure/db/service";
import type { RedisService } from "#lib/infrastructure/redis";
import type { AutomationsRepository } from "#modules/automations/repository";
import type { EntitiesRepository } from "#modules/entities/repository";
import type { EntitiesService } from "#modules/entities/service";
import type { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import type { EventSchemasRepository } from "#modules/event-schemas/repository";
import type { EventsService } from "#modules/events/service";

import type { ImportRunJobData } from "./jobs";
import type { ImportRunError } from "./runtime/workflow-helpers";

export const NonMediaAdapterFailureSchema = Schema.Struct({
	message: Schema.String,
	itemIndex: Schema.Number,
	sourceLabel: Schema.String,
	sourceIdentifier: Schema.String,
});

export type NonMediaAdapterFailure = typeof NonMediaAdapterFailureSchema.Type;

export type NonMediaImportItem = Omit<NonMediaAdapterFailure, "message">;

export type NonMediaLoadError = {
	message: string;
	cleanupPaths: ReadonlyArray<string>;
};

export type NonMediaItemOutcome =
	| { _tag: "imported" }
	| {
			_tag: "failed";
			message: string;
			entitySchemaSlug?: string;
			stage: ImportRunFailureStage;
	  };

export type NonMediaWriteItem<Item, R> = (input: {
	item: Item;
	index: number;
}) => Effect.Effect<NonMediaItemOutcome, never, R>;

export type NonMediaPrepareResult<Item, R> =
	| { _tag: "failed"; message: string }
	| { _tag: "ready"; writeItem: NonMediaWriteItem<Item, R> };

export type NonMediaPrepareWritesEffect<Item, RWrite, RPrepare> = Effect.Effect<
	NonMediaPrepareResult<Item, RWrite>,
	ImportRunError,
	RPrepare
>;

export type NonMediaImportOperations<Item extends NonMediaImportItem, RLoad, RPrepare, RWrite> = {
	itemSchema: Schema.Schema<Item>;
	loadAdapterResult: (payload: ImportRunJobData) => Effect.Effect<
		{
			items: ReadonlyArray<Item>;
			cleanupPaths: ReadonlyArray<string>;
			failures: ReadonlyArray<NonMediaAdapterFailure>;
		},
		NonMediaLoadError,
		RLoad
	>;
	prepareWrites: (payload: ImportRunJobData) => NonMediaPrepareWritesEffect<Item, RWrite, RPrepare>;
};

type NonMediaImportRequirements =
	| DbRunner
	| AppConfig
	| RedisService
	| EventsService
	| WorkflowEngine
	| EntitiesService
	| WorkflowInstance
	| EntitiesRepository
	| FileSystem.FileSystem
	| AutomationsRepository
	| EventSchemasRepository
	| EntitySchemasRepository;

export type NonMediaImportOperationSet = {
	withOperations: <A, E, R>(
		run: <Item extends NonMediaImportItem>(
			operations: NonMediaImportOperations<
				Item,
				NonMediaImportRequirements,
				NonMediaImportRequirements,
				NonMediaImportRequirements
			>,
		) => Effect.Effect<A, E, R>,
	) => Effect.Effect<A, E, R>;
};

export const makeNonMediaImportOperationSet = <Item extends NonMediaImportItem>(
	operations: NonMediaImportOperations<
		Item,
		NonMediaImportRequirements,
		NonMediaImportRequirements,
		NonMediaImportRequirements
	>,
): NonMediaImportOperationSet => ({
	withOperations: (run) => run(operations),
});

export class NonMediaImportWorkflowOperations extends Context.Tag(
	"NonMediaImportWorkflowOperations",
)<
	NonMediaImportWorkflowOperations,
	{
		getOperations: (
			payload: ImportRunJobData,
		) => Effect.Effect<NonMediaImportOperationSet, ImportRunError>;
	}
>() {}
