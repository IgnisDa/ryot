import { z } from "@hono/zod-openapi";
import {
	nonEmptyStringSchema,
	stringUnknownRecordSchema,
} from "~/lib/zod/base";

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

export interface SandboxEnqueueOptions {
	code: string;
	userId: string;
	scriptId?: string;
	driverName?: string;
	context?: Record<string, unknown>;
	apiFunctionDescriptors?: Array<ApiFunctionDescriptor>;
}

export interface SandboxResult {
	logs?: string;
	error?: string;
	value?: unknown;
	success: boolean;
}

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
