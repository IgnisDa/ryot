import { Schema } from "effect";

import { CanonicalBase64 } from "../../schema/base64";
import {
	EntitySchemaSlug,
	ImportRunId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	PluginSlug,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import { PluginManifest } from "../plugins/manifest";
import { EnqueueSandboxBody } from "../sandbox/schemas";

const TestSupportDiagnosticReason = Schema.Union([
	Schema.Struct({ diagnostic: Schema.String, code: Schema.Literal("invalid-request") }),
	Schema.Struct({ diagnostic: Schema.String, code: Schema.Literal("operation-failed") }),
	Schema.Struct({ diagnostic: Schema.String, code: Schema.Literal("resource-conflict") }),
	Schema.Struct({ diagnostic: Schema.String, code: Schema.Literal("resource-not-found") }),
]);

export class TestSupportBadRequest extends Schema.TaggedError<TestSupportBadRequest>()(
	"TestSupportBadRequest",
	{ reason: TestSupportDiagnosticReason },
) {}
export class TestSupportNotFound extends Schema.TaggedError<TestSupportNotFound>()(
	"TestSupportNotFound",
	{ reason: TestSupportDiagnosticReason },
) {}
export class TestSupportConflict extends Schema.TaggedError<TestSupportConflict>()(
	"TestSupportConflict",
	{ reason: TestSupportDiagnosticReason },
) {}
export class TestSupportOperationFailure extends Schema.TaggedError<TestSupportOperationFailure>()(
	"TestSupportOperationFailure",
	{ reason: TestSupportDiagnosticReason },
) {}

export const TestSupportInstallSystemPluginBodyBase64 = Schema.Struct({
	manifest: PluginManifest,
	files: Schema.Record(Schema.String, CanonicalBase64),
});

export type TestSupportInstallSystemPluginBodyBase64 =
	typeof TestSupportInstallSystemPluginBodyBase64.Type;

export const TestSupportPluginWriteResult = Schema.Struct({
	pluginId: PluginId,
	activePluginRevisionId: PluginRevisionId,
	installationId: Schema.NullOr(Schema.String),
	configRevisionId: Schema.NullOr(PluginConfigRevisionId),
	scripts: Schema.Array(Schema.Struct({ slug: Schema.String, id: SandboxScriptId })),
});

export const TestSupportEnqueueSandboxBody = strictStruct({
	...EnqueueSandboxBody.fields,
	executingUserId: UserId,
});

export type TestSupportEnqueueSandboxBody = typeof TestSupportEnqueueSandboxBody.Type;

export const TestSupportEnqueueSandboxResponse = Schema.Struct({
	jobId: Schema.String,
	executionId: Schema.String,
});

export const TestSupportSandboxReplayProjectionBody = Schema.Struct({ executionId: Schema.String });

export const TestSupportTriggerPluginCronBody = strictStruct({
	pluginSlug: PluginSlug,
	cronSlug: Schema.String,
});

export type TestSupportTriggerPluginCronBody = typeof TestSupportTriggerPluginCronBody.Type;

export const TestSupportPluginCronResult = Schema.Union([
	Schema.Struct({
		pluginSlug: PluginSlug,
		cronSlug: Schema.String,
		status: Schema.Literal("notFound"),
	}),
	Schema.Struct({
		result: Schema.Unknown,
		pluginSlug: PluginSlug,
		cronSlug: Schema.String,
		executionId: Schema.String,
		status: Schema.Literals(["executed", "failed"]),
	}),
]);

export type TestSupportPluginCronResult = typeof TestSupportPluginCronResult.Type;

export const TestSupportStartWorkflowLoadGateBody = strictStruct({
	source: Schema.String,
	pluginSlug: PluginSlug,
	executingUserId: UserId,
	workflowSlug: Schema.String,
	providerId: SandboxProviderId,
	identifierPrefix: Schema.String,
	entitySchemaSlug: EntitySchemaSlug,
	itemCount: Schema.Int.pipe(
		Schema.check(Schema.isGreaterThan(0)),
		Schema.check(Schema.isLessThanOrEqualTo(1_001)),
	),
});

export type TestSupportStartWorkflowLoadGateBody = typeof TestSupportStartWorkflowLoadGateBody.Type;

export const TestSupportWorkflowLoadGateExecution = Schema.Struct({
	executionId: Schema.String,
	error: Schema.optional(Schema.String),
	output: Schema.optional(Schema.Unknown),
	status: Schema.Literals(["pending", "completed", "failed"]),
});

export const TestSupportWorkflowLoadGateRun = Schema.Struct({
	runId: ImportRunId,
	executionIds: Schema.Array(Schema.String),
});

export const TestSupportWorkflowLoadGateResult = Schema.Struct({
	runId: ImportRunId,
	executions: Schema.Array(TestSupportWorkflowLoadGateExecution),
});

export const TestSupportOperationalPressure = Schema.Struct({
	locks: Schema.Struct({ advisoryLocks: Schema.Number, waitingAdvisoryLocks: Schema.Number }),
	redis: Schema.Struct({
		maxHighWater: Schema.Number,
		projectionCount: Schema.Number,
		projectionErrors: Schema.Number,
	}),
	sandbox: Schema.Struct({
		totalExecutions: Schema.Number,
		activeExecutions: Schema.Number,
		maxActiveExecutions: Schema.Number,
	}),
	database: Schema.Struct({
		deadlocks: Schema.Number,
		totalConnections: Schema.Number,
		activeConnections: Schema.Number,
		lockWaitingConnections: Schema.Number,
	}),
});

const OptionalCounter = Schema.NullOr(Schema.Number);

export const TestSupportSmapsRollup = Schema.Struct({
	rssBytes: OptionalCounter,
	pssBytes: OptionalCounter,
	swapBytes: OptionalCounter,
	pssAnonBytes: OptionalCounter,
	pssFileBytes: OptionalCounter,
	pssShmemBytes: OptionalCounter,
	anonymousBytes: OptionalCounter,
	sharedCleanBytes: OptionalCounter,
	sharedDirtyBytes: OptionalCounter,
	privateCleanBytes: OptionalCounter,
	privateDirtyBytes: OptionalCounter,
});

export const TestSupportSandboxRuntimeQuery = {
	/** Returns released-worker records with a sequence greater than this cursor. */
	completedAfterSequence: Schema.optional(Schema.NumberFromString),
	/** Reads `smaps_rollup` for the backend and every live worker; costly, so opt-in. */
	includeSmaps: Schema.optional(Schema.Literals(["true", "false"])),
};

export const TestSupportSandboxRuntimeMetrics = Schema.Struct({
	timestampMs: Schema.Number,
	totalSpawned: Schema.Number,
	totalCompleted: Schema.Number,
	workerRssBytes: Schema.Number,
	backendRssBytes: Schema.Number,
	activeProcessCount: Schema.Number,
	completedWorkerSequence: Schema.Number,
	runtime: Schema.Struct({ bunVersion: Schema.String, denoVersion: Schema.String }),
	executions: Schema.Struct({
		total: Schema.Number,
		active: Schema.Number,
		maxActive: Schema.Number,
	}),
	providerImports: Schema.Struct({
		executingBodies: Schema.Number,
		phaseSegmentSequence: Schema.Number,
	}),
	deno: Schema.Struct({
		rssBytes: Schema.Number,
		processCount: Schema.Number,
		userCpuTicks: OptionalCounter,
		systemCpuTicks: OptionalCounter,
	}),
	configuration: Schema.Struct({
		processMode: Schema.String,
		workerConcurrency: Schema.Number,
		benchmarkProfilingEnabled: Schema.Boolean,
		schedulerDispatchersDisabled: Schema.Boolean,
	}),
	replays: Schema.Struct({
		totalFailed: Schema.Number,
		totalStarted: Schema.Number,
		totalCompleted: Schema.Number,
		totalJournalBytes: Schema.Number,
		totalDurableRequests: Schema.Number,
	}),
	/** Workers released after the requested cursor, with their lifetime peak read before kill. */
	completedWorkers: Schema.Array(
		Schema.Struct({
			pid: Schema.Number,
			sequence: Schema.Number,
			spawnedAtMs: Schema.Number,
			releasedAtMs: Schema.Number,
			lifetimePeakRssBytes: OptionalCounter,
			executionKey: Schema.NullOr(Schema.String),
			outcome: Schema.Literals(["success", "failure"]),
		}),
	),
	backend: Schema.Struct({
		rssBytes: Schema.Number,
		hwmBytes: OptionalCounter,
		heapUsedBytes: Schema.Number,
		externalBytes: Schema.Number,
		heapTotalBytes: Schema.Number,
		userCpuMicros: OptionalCounter,
		arrayBuffersBytes: Schema.Number,
		systemCpuMicros: OptionalCounter,
		smapsRollup: Schema.NullOr(TestSupportSmapsRollup),
	}),
	workers: Schema.Array(
		Schema.Struct({
			pid: Schema.Number,
			rssBytes: Schema.Number,
			/** Kernel lifetime resident high-water mark (`VmHWM`) for this worker. */
			hwmBytes: OptionalCounter,
			userCpuTicks: OptionalCounter,
			systemCpuTicks: OptionalCounter,
			startTimeTicks: OptionalCounter,
			smapsRollup: Schema.NullOr(TestSupportSmapsRollup),
		}),
	),
	cgroup: Schema.NullOr(
		Schema.Struct({
			pidsCurrent: OptionalCounter,
			memoryMaxBytes: OptionalCounter,
			memoryPeakBytes: OptionalCounter,
			memoryCurrentBytes: OptionalCounter,
			cpu: Schema.Struct({
				userUsec: OptionalCounter,
				usageUsec: OptionalCounter,
				systemUsec: OptionalCounter,
			}),
			events: Schema.Struct({
				low: Schema.Number,
				max: Schema.Number,
				oom: Schema.Number,
				high: Schema.Number,
				oomKill: Schema.Number,
			}),
		}),
	),
});

export const TestSupportProviderImportPhaseSegments = Schema.Struct({
	segments: Schema.Array(
		Schema.Struct({
			sequence: Schema.Number,
			executionId: Schema.String,
			startedAtMs: Schema.Number,
			finishedAtMs: Schema.Number,
			outcome: Schema.Literals(["success", "failure", "interrupted"]),
			phase: Schema.Literals(["population", "provider-import-automation"]),
		}),
	),
});

/** Opaque benchmark-generated correlation token; also names the profile directory. */
export const BenchmarkProfileToken = Schema.String.pipe(
	Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/)),
);

export const TestSupportArmSandboxProfileBody = Schema.Struct({
	/** The persisted script slug whose next logical executions are profiled. */
	scriptSlug: Schema.String,
	cpuProfile: Schema.Boolean,
	token: BenchmarkProfileToken,
	executions: Schema.Int.pipe(
		Schema.check(Schema.isGreaterThanOrEqualTo(1)),
		Schema.check(Schema.isLessThanOrEqualTo(5)),
	),
	/** Every replay of a durable execution is a fresh Deno process; each one is an attempt. */
	maxAttemptsPerExecution: Schema.Int.pipe(
		Schema.check(Schema.isGreaterThanOrEqualTo(1)),
		Schema.check(Schema.isLessThanOrEqualTo(64)),
	),
	/** Heap snapshots are taken at checkpoints until this many have been written per attempt. */
	maxHeapSnapshotsPerAttempt: Schema.Int.pipe(
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
		Schema.check(Schema.isLessThanOrEqualTo(16)),
	),
});
export type TestSupportArmSandboxProfileBody = typeof TestSupportArmSandboxProfileBody.Type;

export const TestSupportSandboxProfileStatus = Schema.Struct({
	token: Schema.String,
	armed: Schema.Boolean,
	remainingExecutions: Schema.Number,
	executions: Schema.Array(
		Schema.Struct({
			executionId: Schema.String,
			attempts: Schema.Array(
				Schema.Struct({
					pid: Schema.Number,
					attempt: Schema.Number,
					finished: Schema.Boolean,
					directory: Schema.String,
					checkpointCount: Schema.Number,
					heapSnapshotCount: Schema.Number,
					error: Schema.NullOr(Schema.String),
				}),
			),
		}),
	),
});

export const TestSupportBackendProfileBody = Schema.Struct({
	token: BenchmarkProfileToken,
	label: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/))),
	action: Schema.Literals(["checkpoint", "heap-snapshot", "gc", "cpu-start", "cpu-stop"]),
});
export type TestSupportBackendProfileBody = typeof TestSupportBackendProfileBody.Type;

export const TestSupportBackendCheckpoint = Schema.Struct({
	label: Schema.String,
	action: Schema.String,
	timestampMs: Schema.Number,
	activeWorkflows: OptionalCounter,
	file: Schema.NullOr(Schema.String),
	cgroupMemoryCurrentBytes: OptionalCounter,
	smapsRollup: Schema.NullOr(TestSupportSmapsRollup),
	processMemory: Schema.Struct({
		rss: Schema.Number,
		external: Schema.Number,
		heapUsed: Schema.Number,
		heapTotal: Schema.Number,
		arrayBuffers: Schema.Number,
	}),
	jscHeap: Schema.Struct({
		heapSize: Schema.Number,
		objectCount: Schema.Number,
		heapCapacity: Schema.Number,
		extraMemorySize: Schema.Number,
		globalObjectCount: Schema.Number,
		protectedObjectCount: Schema.Number,
		topObjectTypes: Schema.Array(Schema.Struct({ type: Schema.String, count: Schema.Number })),
	}),
});
