import type {
	CoreSandboxHostMethodMap,
	ExecutionMetadata,
	SandboxHost,
	SandboxManifest,
} from "./core.js";
import { Effect, Schema } from "./effect.js";

type SandboxTestHost<Manifest extends SandboxManifest> = Omit<
	SandboxHost<Manifest["capabilities"]>,
	"getAppConfigValue"
> &
	("getAppConfigValue" extends Manifest["capabilities"][number]
		? {
				readonly getAppConfigValue: (
					key: Parameters<SandboxHost<Manifest["capabilities"]>["getAppConfigValue"]>[0],
				) => ReturnType<CoreSandboxHostMethodMap["getAppConfigValue"]>;
			}
		: object);

export function defineSandboxTestHost<const Manifest extends SandboxManifest>(
	_manifest: Manifest,
	host: SandboxTestHost<Manifest>,
): SandboxHost<Manifest["capabilities"]>;
export function defineSandboxTestHost(_manifest: SandboxManifest, host: unknown): unknown {
	return host;
}

export const runSandboxTestScript = <
	Input extends Schema.Schema.AnyNoContext,
	Output extends Schema.Schema.AnyNoContext,
	Host,
>(
	script: {
		readonly input: Input;
		readonly output: Output;
		readonly run: (
			input: Schema.Schema.Type<Input>,
			host: Host,
			execution: ExecutionMetadata,
		) => Effect.Effect<Schema.Schema.Type<Output>, unknown>;
	},
	input: Schema.Schema.Encoded<Input>,
	host: NoInfer<Host>,
	execution: ExecutionMetadata,
) => {
	return Schema.decodeUnknown(script.input)(input).pipe(
		Effect.flatMap((parsedInput) => script.run(parsedInput, host, execution)),
		Effect.flatMap(Schema.decodeUnknown(script.output)),
	);
};
