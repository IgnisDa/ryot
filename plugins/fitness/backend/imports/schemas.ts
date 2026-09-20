import { sandboxScratchManifestSchema } from "@ryot-app/sandbox-sdk/filesystem";
import {
	genericImportWriteItemSchema,
	genericImportFailureSchema,
	ingestionArtifactsSchema,
	LifecycleCommand,
	genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { Schema } from "@ryot-app/sandbox-sdk/workflow";

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const FitnessSortedRun = Schema.Struct({ pages: count, prefix: Schema.String });
export type FitnessSortedRun = typeof FitnessSortedRun.Type;

export const FitnessRecord = Schema.Struct({
	itemIndex: count,
	key: Schema.String,
	failures: Schema.Array(genericImportFailureSchema),
	item: Schema.optional(genericImportWriteItemSchema),
	row: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type FitnessRecord = typeof FitnessRecord.Type;

export const FitnessStageInput = Schema.Union([
	Schema.Struct({
		offset: count,
		itemIndex: count,
		header: Schema.String,
		size: Schema.NullOr(count),
		action: Schema.Literal("collect"),
		carry: Schema.NullOr(Schema.String),
		ingestionArtifacts: Schema.optional(ingestionArtifactsSchema),
	}),
	Schema.Struct({
		leftOffset: count,
		rightOffset: count,
		leftFinal: Schema.Boolean,
		rightFinal: Schema.Boolean,
		action: Schema.Literal("merge"),
		ingestionArtifacts: ingestionArtifactsSchema,
	}),
	Schema.Struct({
		offset: count,
		final: Schema.Boolean,
		timezone: Schema.String,
		action: Schema.Literal("normalize"),
		carry: Schema.NullOr(Schema.String),
		ingestionArtifacts: ingestionArtifactsSchema,
	}),
	Schema.Struct({
		offset: count,
		action: Schema.Literal("application"),
		ingestionArtifacts: ingestionArtifactsSchema,
	}),
]);

export const FitnessStageOutput = Schema.Struct({
	...sandboxScratchManifestSchema.fields,
	offset: count,
	itemIndex: count,
	totalSize: count,
	leftOffset: count,
	rightOffset: count,
	done: Schema.Boolean,
	header: Schema.String,
	leftDone: Schema.Boolean,
	rightDone: Schema.Boolean,
	advancedAt: Schema.String,
	carryFile: Schema.NullOr(Schema.String),
});

const { chunkFiles: _chunkFiles, ...stageResultFields } = FitnessStageOutput.fields;
export const FitnessStageResult = Schema.Struct({
	...stageResultFields,
	chunkHandles: Schema.Array(Schema.String),
});

export const FitnessApplicationInput = Schema.Struct({
	page: count,
	batch: count,
	offset: count,
	ordinal: count,
	completed: count,
	issueLimit: count,
	runId: Schema.String,
	run: FitnessSortedRun,
	command: LifecycleCommand,
	unit: Schema.Literals(["workouts", "measurements"]),
	parser: Schema.Literals(["import.hevy", "import.open-scale", "import.strong-app"]),
});

export const FitnessApplicationOutput = Schema.Struct({
	page: count,
	batch: count,
	offset: count,
	ordinal: count,
	completed: count,
	done: Schema.Boolean,
	advancedAt: Schema.String,
	issues: genericImportWorkflowResultSchema.fields.issues,
});

export const FitnessMergeInput = Schema.Struct({
	page: count,
	ordinal: count,
	leftPage: count,
	rightPage: count,
	leftOffset: count,
	rightOffset: count,
	prefix: Schema.String,
	left: FitnessSortedRun,
	right: FitnessSortedRun,
	runId: FitnessApplicationInput.fields.runId,
	parser: FitnessApplicationInput.fields.parser,
	command: FitnessApplicationInput.fields.command,
});

export const FitnessMergeOutput = Schema.Struct({
	page: count,
	ordinal: count,
	leftPage: count,
	rightPage: count,
	leftOffset: count,
	rightOffset: count,
	done: Schema.Boolean,
	advancedAt: Schema.String,
});
