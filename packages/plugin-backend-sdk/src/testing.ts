import type { CoreSandboxHostMethodMap } from "./core/host-contracts";
import type { PolicyHost, ScriptHost } from "./core/script-host";
import type { ExecutionMetadata, SandboxManifest } from "./core/script-manifest";
import { Effect, Schema } from "./effect";
import { configureSandboxFilesystem, type SandboxFilesystemBinding } from "./filesystem";
import {
	type WorkflowReplayEnvelope,
	type WorkflowReplayHost,
	type WorkflowReplayJournal,
	type WorkflowReplayJournalEntry,
	workflowReplayJournalEntrySchema,
} from "./workflow/protocol";

type SandboxTestHost<Host extends object> = Partial<Omit<Host, "getPluginConfig">> &
	("getPluginConfig" extends keyof Host
		? { readonly getPluginConfig?: CoreSandboxHostMethodMap["getPluginConfig"] }
		: object);

type HostForManifest<Manifest extends SandboxManifest> = Manifest extends {
	readonly kind: "workflow";
}
	? WorkflowReplayHost
	: Manifest extends { readonly kind: "automation"; readonly automationType: "policy" }
		? PolicyHost
		: ScriptHost;

export function defineSandboxTestHost<const Manifest extends SandboxManifest>(
	_manifest: Manifest,
	host: SandboxTestHost<HostForManifest<Manifest>>,
): HostForManifest<Manifest>;
export function defineSandboxTestHost(_manifest: SandboxManifest, host: unknown): unknown {
	return host;
}

export const makeWorkflowReplayHost = (entries: ReadonlyArray<unknown>): WorkflowReplayHost => ({
	settleInline: () => Effect.succeed(null),
	replayJournal: () =>
		Effect.succeed({
			length: entries.length,
			read: (index): ReturnType<WorkflowReplayJournal["read"]> =>
				Schema.decodeUnknownEffect(workflowReplayJournalEntrySchema)(entries[index]).pipe(
					Effect.mapError((error) => ({ message: String(error) })),
				),
		}),
});

let testFilesystem: undefined | SandboxFilesystemBinding;
let testFilesystemConfigured = false;

export const installSandboxTestFilesystem = (binding: undefined | SandboxFilesystemBinding) => {
	if (!testFilesystemConfigured) {
		configureSandboxFilesystem(() => testFilesystem);
		testFilesystemConfigured = true;
	}
	testFilesystem = binding;
};

export const driveWorkflowReplay = <Input, Failure>(
	run: (
		input: Input,
		host: WorkflowReplayHost,
		execution: ExecutionMetadata,
	) => Effect.Effect<WorkflowReplayEnvelope, Failure>,
	input: Input,
	resolve: (
		request: WorkflowReplayEnvelope["requests"][number],
	) => WorkflowReplayJournalEntry["value"],
) =>
	Effect.gen(function* () {
		const journal: WorkflowReplayJournalEntry[] = [];
		for (;;) {
			const envelope = yield* run(input, makeWorkflowReplayHost(journal), {
				metadata: {},
				sandboxScriptId: "workflow-test",
			});
			const request = envelope.state === "pending" ? envelope.requests[journal.length] : undefined;
			if (request === undefined) {
				return envelope;
			}
			journal.push({ request, value: resolve(request) });
		}
	});

export const runSandboxTestScript = <
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.ConstraintDecoder<unknown>,
	Host,
	Failure,
>(
	script: {
		readonly input: Input;
		readonly output: Output;
		readonly run: (
			input: Input["Type"],
			host: Host,
			execution: ExecutionMetadata,
		) => Effect.Effect<Output["Type"], Failure>;
	},
	input: Schema.Codec.Encoded<Input>,
	host: NoInfer<Host>,
	execution: ExecutionMetadata,
) => {
	return Schema.decodeEffect(script.input)(input).pipe(
		Effect.flatMap((parsedInput) => script.run(parsedInput, host, execution)),
		Effect.flatMap(Schema.decodeUnknownEffect(script.output)),
	);
};
