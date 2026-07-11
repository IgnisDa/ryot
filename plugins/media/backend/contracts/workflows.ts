import { Schema } from "@ryot-app/sandbox-sdk/workflow";

export const MediaImportResolutionActivityInput = Schema.Struct({
	value: Schema.String,
	identifierType: Schema.String,
});

export const MediaImportResolutionActivityResult = Schema.Union([
	Schema.Struct({ status: Schema.Literal("completed"), externalId: Schema.NullOr(Schema.String) }),
	Schema.Struct({ message: Schema.String, status: Schema.Literal("failed") }),
]);

const MediaImportResolutionCandidate = Schema.Struct({
	scriptSlug: Schema.String,
	providerSlug: Schema.String,
});

export const MediaImportResolutionWorkflowInput = Schema.Struct({
	items: Schema.Array(
		Schema.Struct({
			index: Schema.Number,
			value: Schema.String,
			identifierType: Schema.String,
			candidates: Schema.Array(MediaImportResolutionCandidate),
		}),
	),
});

export const MediaImportResolutionWorkflowOutput = Schema.Struct({
	results: Schema.Array(
		Schema.Union([
			Schema.Struct({
				index: Schema.Number,
				externalId: Schema.String,
				providerSlug: Schema.String,
				status: Schema.Literal("resolved"),
			}),
			Schema.Struct({
				index: Schema.Number,
				errors: Schema.Array(Schema.String),
				status: Schema.Literal("unresolved"),
			}),
		]),
	),
});

const AutomationOrigin = Schema.Union([
	Schema.Struct({ importRunId: Schema.String, kind: Schema.Literal("import") }),
	Schema.Struct({
		importRunId: Schema.String,
		integrationId: Schema.String,
		kind: Schema.Literal("integration"),
	}),
]);

export const MediaImportPopulationWorkflowInput = Schema.Struct({
	items: Schema.Array(
		Schema.Union([
			Schema.Struct({
				index: Schema.Number,
				origin: AutomationOrigin,
				externalId: Schema.String,
				providerId: Schema.String,
				entitySchemaSlug: Schema.String,
				userId: Schema.optional(Schema.String),
			}),
			Schema.Struct({
				index: Schema.Number,
				origin: AutomationOrigin,
				externalId: Schema.String,
				providerSlug: Schema.String,
				entitySchemaSlug: Schema.String,
			}),
		]),
	),
});

export const KernelEntityImportResult = Schema.Union([
	Schema.Struct({
		status: Schema.Literal("completed"),
		entity: Schema.Struct({ id: Schema.String }),
	}),
	Schema.Struct({
		message: Schema.String,
		status: Schema.Literal("failed"),
		stage: Schema.Literal("population"),
	}),
]);

export const MediaImportPopulationWorkflowOutput = Schema.Struct({
	results: Schema.Array(
		Schema.Union([
			Schema.Struct({
				index: Schema.Number,
				entityId: Schema.String,
				status: Schema.Literal("completed"),
			}),
			Schema.Struct({
				index: Schema.Number,
				message: Schema.String,
				status: Schema.Literal("failed"),
				stage: Schema.Literal("population"),
			}),
		]),
	),
});

export const MediaMonitoringTarget = Schema.Struct({
	entityId: Schema.String,
	externalId: Schema.String,
	providerId: Schema.String,
	entitySchemaSlug: Schema.String,
});

export const MediaMonitoringTargetsActivityInput = Schema.Struct({
	after: Schema.optional(Schema.String),
	limit: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThan(0)),
		Schema.check(Schema.isLessThanOrEqualTo(100)),
	),
});

export const MediaMonitoringTargetsActivityOutput = Schema.Struct({
	nextCursor: Schema.NullOr(Schema.String),
	items: Schema.Array(MediaMonitoringTarget),
});

export const MediaMonitoringSweepWorkflowInput = Schema.Struct({});

export const MediaMonitoringSweepWorkflowOutput = Schema.Struct({
	batchCount: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
	targetCount: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
});
