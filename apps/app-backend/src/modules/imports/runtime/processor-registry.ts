import type { FileSystem } from "@effect/platform";
import type { Effect } from "effect";

import type { AppConfig } from "~/lib/config";
import type { DbRunner } from "~/lib/db";
import type { DbError } from "~/lib/errors";
import type { EntitiesRepository } from "~/modules/entities/repository";
import type { EntitiesService } from "~/modules/entities/service";
import type { EntitySchemasRepository } from "~/modules/entity-schemas/repository";
import type { EventSchemasRepository } from "~/modules/event-schemas/repository";
import type { EventsService } from "~/modules/events/service";

import { processOpenScaleImport } from "../measurement/processor";
import type { ImportsRepository } from "../repository";
import { adaptHevyCsv } from "../sources/hevy/adapter";
import { adaptStrongAppCsv } from "../sources/strong-app/adapter";
import { processWorkoutCsvImport } from "../workout/import-processor";

type FileSourceProcessorInput = { runId: string; userId: string; filePath: string };

type ImportProcessRequirements =
	| DbRunner
	| AppConfig
	| EventsService
	| EntitiesService
	| ImportsRepository
	| EntitiesRepository
	| FileSystem.FileSystem
	| EventSchemasRepository
	| EntitySchemasRepository;

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
};

export const getImportSourceProcessor = (source: string): ImportSourceProcessorConfig | undefined =>
	importSourceProcessors[source];
