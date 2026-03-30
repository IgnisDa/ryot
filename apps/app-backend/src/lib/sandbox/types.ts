import { z } from "@hono/zod-openapi";
import {
	nonEmptyStringSchema,
	stringUnknownRecordSchema,
} from "~/lib/zod/base";
import type { sandboxRunJobData, sandboxRunJobResult } from "./jobs";

export type HostFunction<TContext extends Record<string, unknown>> = (
	context: TContext,
	...args: Array<unknown>
) => Promise<unknown>;

export type HostFunctionFactory = (
	context: Record<string, unknown>,
) => (...args: Array<unknown>) => Promise<unknown>;

export const apiFunctionDescriptorSchema = z.object({
	functionKey: nonEmptyStringSchema,
	context: stringUnknownRecordSchema,
});

export type ApiFunctionDescriptor = z.infer<typeof apiFunctionDescriptorSchema>;

export type SandboxEnqueueOptions = Pick<
	z.infer<typeof sandboxRunJobData>,
	| "code"
	| "userId"
	| "context"
	| "scriptId"
	| "driverName"
	| "apiFunctionDescriptors"
>;

export type SandboxResult = z.infer<typeof sandboxRunJobResult>;

export type ApiSuccess<T> = { data: T; success: true };

export type ApiFailure = {
	error: string;
	success: false;
};

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export const apiSuccess = <T>(data: T) => ({
	data,
	success: true as const,
});

export const apiFailure = (error: string) => ({
	error,
	success: false as const,
});

export type HttpCallOptions = {
	body?: string;
	headers?: Record<string, string>;
};

export type HttpCallSuccessData = {
	body: string;
	status: number;
	statusText: string;
	headers: Record<string, string>;
};

export type HttpCallErrorData = {
	status?: number;
};

export type HttpCallResult =
	| ApiSuccess<HttpCallSuccessData>
	| (ApiFailure & { data?: HttpCallErrorData });

export type ConfigValueResult = ApiResult<unknown>;
