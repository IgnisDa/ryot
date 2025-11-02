import type { FileSystem } from "@effect/platform";
import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { Effect } from "effect";

import type { AppConfig } from "~/lib/config";
import type { DbRunner } from "~/lib/db";
import type { DbError } from "~/lib/errors";
import type { CollectionsService } from "~/modules/collections/service";
import type { EntitiesRepository } from "~/modules/entities/repository";
import type { EntitiesService } from "~/modules/entities/service";
import type { EntitySchemasRepository } from "~/modules/entity-schemas/repository";
import type { EventSchemasRepository } from "~/modules/event-schemas/repository";
import type { EventsService } from "~/modules/events/service";
import type { RelationshipSchemasRepository } from "~/modules/relationship-schemas/repository";

import { processOpenScaleImport } from "../measurement/processor";
import { processMediaTextFileImport } from "../media/file-processor";
import type { ImportsRepository } from "../repository";
import { adaptGoodreadsCsv } from "../sources/goodreads/adapter";
import { adaptGrouveeCsv } from "../sources/grouvee/adapter";
import { adaptHardcoverCsv } from "../sources/hardcover/adapter";
import { adaptHevyCsv } from "../sources/hevy/adapter";
import { adaptImdbCsv } from "../sources/imdb/adapter";
import { adaptStorygraphCsv } from "../sources/storygraph/adapter";
import { adaptStrongAppCsv } from "../sources/strong-app/adapter";
import { adaptWatcharrExport } from "../sources/watcharr/adapter";
import { processWorkoutCsvImport } from "../workout/import-processor";

type FileSourceProcessorInput = { runId: string; userId: string; filePath: string };

type ImportProcessRequirements =
	| DbRunner
	| AppConfig
	| EventsService
	| WorkflowEngine
	| EntitiesService
	| ImportsRepository
	| CollectionsService
	| EntitiesRepository
	| FileSystem.FileSystem
	| EventSchemasRepository
	| EntitySchemasRepository
	| RelationshipSchemasRepository;

type ImportSourceProcessorConfig = {
	inputKind: "file";
	process: (
		input: FileSourceProcessorInput,
	) => Effect.Effect<void, DbError, ImportProcessRequirements>;
};

const importSourceProcessors: Partial<Record<string, ImportSourceProcessorConfig>> = {
	open_scale: { inputKind: "file", process: (input) => processOpenScaleImport(input) },
	hevy: {
		inputKind: "file",
		process: (input) =>
			processWorkoutCsvImport({ ...input, sourceName: "Hevy", adapt: adaptHevyCsv }),
	},
	strong_app: {
		inputKind: "file",
		process: (input) =>
			processWorkoutCsvImport({ ...input, sourceName: "StrongApp", adapt: adaptStrongAppCsv }),
	},
	imdb: {
		inputKind: "file",
		process: (input) =>
			processMediaTextFileImport({ ...input, sourceName: "IMDb", loadAdapterResult: adaptImdbCsv }),
	},
	grouvee: {
		inputKind: "file",
		process: (input) =>
			processMediaTextFileImport({
				...input,
				sourceName: "Grouvee",
				loadAdapterResult: adaptGrouveeCsv,
			}),
	},
	watcharr: {
		inputKind: "file",
		process: (input) =>
			processMediaTextFileImport({
				...input,
				sourceName: "Watcharr",
				loadAdapterResult: adaptWatcharrExport,
			}),
	},
	hardcover: {
		inputKind: "file",
		process: (input) =>
			processMediaTextFileImport({
				...input,
				sourceName: "Hardcover",
				loadAdapterResult: adaptHardcoverCsv,
			}),
	},
	goodreads: {
		inputKind: "file",
		process: (input) =>
			processMediaTextFileImport({
				...input,
				sourceName: "Goodreads",
				loadAdapterResult: adaptGoodreadsCsv,
			}),
	},
	storygraph: {
		inputKind: "file",
		process: (input) =>
			processMediaTextFileImport({
				...input,
				sourceName: "StoryGraph",
				loadAdapterResult: adaptStorygraphCsv,
			}),
	},
};

export const getImportSourceProcessor = (source: string): ImportSourceProcessorConfig | undefined =>
	importSourceProcessors[source];
