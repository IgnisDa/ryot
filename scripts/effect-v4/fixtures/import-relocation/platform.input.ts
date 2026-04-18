import { Logger } from "effect";

/* keep platform import context */
import {
	FileSystem as Fs,
	Path,
	PlatformLogger,
	FetchHttpClient,
	type Headers as PlatformHeaders,
	HttpApp,
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
	HttpMiddleware,
	HttpServer,
	HttpServerRequest,
	HttpServerResponse,
	Multipart,
	HttpApi,
	HttpApiBuilder,
	HttpApiClient,
	HttpApiEndpoint,
	type HttpApiError,
	HttpApiGroup,
	HttpApiMiddleware,
	HttpApiScalar,
	HttpApiSchema,
	HttpApiSecurity,
	OpenApi,
	Command,
	CommandExecutor,
} from "@effect/platform";
import type { Multipart as UploadPart } from "@effect/platform";
import {
	type PlatformError as ErrorType,
	isPlatformError as checkPlatformError,
} from "@effect/platform/Error";
import { isHttpMethod as checkHttpMethod } from "@effect/platform/HttpMethod";
import * as KeyValueStore from "@effect/platform/KeyValueStore";

declare const error: unknown;
declare const handler: unknown;
declare const method: string;
declare const Match: { when: (predicate: unknown, handler: unknown) => unknown };

export type RequestParts = PlatformHeaders | UploadPart | ErrorType | HttpApiError;
export const logger = PlatformLogger.toFile;
export const logged = { PlatformLogger };
export const app = HttpApp.toWebHandler;
export const command = Command.make;
export const spawner = CommandExecutor.CommandExecutor;
export const platformError = checkPlatformError(error);
export const httpMethod = Match.when(checkHttpMethod, handler);
export const directHttpMethod = checkHttpMethod(method);
export const store = KeyValueStore.layer;
export const shadowedHttpMethod = (checkHttpMethod: string) => checkHttpMethod;

export const shadowed = (
	PlatformLogger: string,
	HttpApp: string,
	Command: string,
	CommandExecutor: string,
) => [PlatformLogger, HttpApp, Command, CommandExecutor];

export const relocated = [
	Fs,
	Path,
	FetchHttpClient,
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
	HttpMiddleware,
	HttpServer,
	HttpServerRequest,
	HttpServerResponse,
	Multipart,
	HttpApi,
	HttpApiBuilder,
	HttpApiClient,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiMiddleware,
	HttpApiScalar,
	HttpApiSchema,
	HttpApiSecurity,
	OpenApi,
	Logger,
];
