import { Logger, FileSystem as Fs, Path, PlatformError } from "effect";

/* keep platform import context */
import {
    FetchHttpClient,
    HttpEffect,
    HttpClient,
    HttpClientRequest,
    HttpClientResponse,
    HttpMiddleware,
    HttpServer,
    HttpServerRequest,
    HttpServerResponse,
    Multipart,
} from "effect/unstable/http";

import type { Headers as PlatformHeaders } from "effect/unstable/http";

import {
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
} from "effect/unstable/httpapi";

import type { HttpApiError } from "effect/unstable/httpapi";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type { Multipart as UploadPart } from "effect/unstable/http";
import type { PlatformError as ErrorType } from "effect/PlatformError";
import { HttpMethod } from "effect/unstable/http";
import { KeyValueStore } from "effect/unstable/persistence";

declare const error: unknown;
declare const handler: unknown;
declare const method: string;
declare const Match: { when: (predicate: unknown, handler: unknown) => unknown };

export type RequestParts = PlatformHeaders | UploadPart | ErrorType | HttpApiError;
export const logger = Logger.toFile;
export const logged = { PlatformLogger: Logger };
export const app = HttpEffect.toWebHandler;
export const command = ChildProcess.make;
export const spawner = ChildProcessSpawner.CommandExecutor;
export const platformError = error instanceof PlatformError.PlatformError;
export const httpMethod = Match.when(HttpMethod.isHttpMethod, handler);
export const directHttpMethod = HttpMethod.isHttpMethod(method);
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
