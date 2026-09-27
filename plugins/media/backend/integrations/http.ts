import { Option, Schema } from "@ryot-app/sandbox-sdk/effect";

import { MediaSandboxError } from "../lib/failures";

const HttpFailure = Schema.Struct({ data: Schema.Struct({ status: Schema.Finite }) });

export const httpFailureStatus = (error: unknown) =>
	Option.getOrUndefined(Schema.decodeUnknownOption(HttpFailure)(error))?.data.status;

export const integrationRequestFailure = (label: string, status?: number) =>
	new MediaSandboxError({
		message:
			status === undefined
				? `${label} request failed`
				: `${label} request returned status ${status}`,
	});
