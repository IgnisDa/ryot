import type { paths } from "@ryot/generated/openapi/app-backend";

type ApiJsonContent<TValue> = TValue extends {
	content: { "application/json": infer TContent };
}
	? TContent
	: never;

type ApiResponseContent<TResponses> = {
	[TStatus in keyof TResponses]: ApiJsonContent<TResponses[TStatus]>;
}[keyof TResponses];

type ApiDataValue<TValue> = TValue extends { data: infer TData } ? TData : never;

export type ApiRequestBody<TOperation> = TOperation extends {
	requestBody?: infer TRequestBody;
}
	? ApiJsonContent<NonNullable<TRequestBody>>
	: never;

export type ApiResponseData<TOperation> = TOperation extends {
	responses: infer TResponses;
}
	? ApiDataValue<ApiResponseContent<TResponses>>
	: never;

export type ApiGetResponseData<TPath extends keyof paths> = ApiResponseData<
	NonNullable<paths[TPath]["get"]>
>;

export type ApiPostResponseData<TPath extends keyof paths> = ApiResponseData<
	NonNullable<paths[TPath]["post"]>
>;

export type ApiPostRequestBody<TPath extends keyof paths> = ApiRequestBody<
	NonNullable<paths[TPath]["post"]>
>;

export type ApiPatchRequestBody<TPath extends keyof paths> = ApiRequestBody<
	NonNullable<paths[TPath]["patch"]>
>;
