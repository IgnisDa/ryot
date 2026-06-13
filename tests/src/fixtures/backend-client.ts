import { FetchHttpClient } from "@effect/platform";
import { Either, Effect } from "effect";

import { withLegacyBackendClientMethods } from "./backend-client-legacy";
import type { LegacyBackendClient } from "./backend-client-legacy";
import { withClient } from "./backend-client-support";
import type { ContractClient, RequestHeaders } from "./backend-client-support";

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type GroupKey = keyof ContractClient;
type AnyEffectMethod = (...args: any[]) => Effect.Effect<any, any, any>;
type MethodKey<G extends GroupKey> = Extract<
	{
		[K in keyof ContractClient[G]]: ContractClient[G][K] extends AnyEffectMethod ? K : never;
	}[keyof ContractClient[G]],
	string
>;
type ContractMethod<
	G extends GroupKey,
	M extends MethodKey<G>,
> = ContractClient[G][M] extends AnyEffectMethod ? ContractClient[G][M] : never;
type NormalizeSuccess<T> = T extends readonly [infer Data, unknown] ? Data : T;
type ContractRequest<G extends GroupKey, M extends MethodKey<G>> = Parameters<
	ContractMethod<G, M>
>[0];
type ContractSuccess<G extends GroupKey, M extends MethodKey<G>> = NormalizeSuccess<
	Effect.Effect.Success<ReturnType<ContractMethod<G, M>>>
>;
type LegacyParams<Request> = Simplify<
	(Request extends { path: infer Path } ? { path?: Path } : {}) &
		(Request extends { urlParams: infer Query } ? { query?: Query } : {})
>;
type LegacyRequest<Request> = Simplify<
	{ headers?: RequestHeaders } & ([Request] extends [undefined]
		? {}
		: (Request extends { payload: infer Body } ? { body?: Body } : {}) &
				(keyof LegacyParams<Request> extends never ? {} : { params?: LegacyParams<Request> }))
>;
type BackendResult<Data> = Promise<{
	data?: Data;
	error?: { error: { message: string } };
	response: { status: number };
}>;
type BackendMethod<G extends GroupKey, M extends MethodKey<G>> = (
	request?: LegacyRequest<ContractRequest<G, M>>,
) => BackendResult<ContractSuccess<G, M>>;
type BackendClientCore = {
	[G in GroupKey]: {
		[M in MethodKey<G>]: BackendMethod<G, M>;
	};
};
type BackendClient = BackendClientCore & LegacyBackendClient;

const statusByTag = {
	BadRequest: 400,
	Conflict: 409,
	InternalError: 500,
	MultipartError: 413,
	NotFound: 404,
	NotImplemented: 501,
	ParseError: 400,
	Unauthorized: 401,
} as const;

const successStatus = {
	collections: {
		create: 201,
		createMembership: 201,
		deleteMembership: 200,
	},
	entities: {
		clearUserState: 200,
		create: 201,
		get: 200,
		getImportResult: 200,
		import: 200,
	},
	"entity-schemas": {
		create: 201,
		get: 200,
		getSearchResult: 200,
		list: 200,
		search: 200,
	},
	"event-schemas": {
		create: 201,
		list: 200,
	},
	events: {
		create: 201,
		list: 200,
	},
	"god-mode": {
		listUsers: 200,
		provisionUser: 201,
		resetUserPassword: 200,
		setUserBan: 200,
	},
	imports: {
		createRun: 201,
		deleteRun: 200,
		getRun: 200,
		listRuns: 200,
	},
	integrations: {
		create: 201,
		delete: 200,
		get: 200,
		getRuns: 200,
		list: 200,
		update: 200,
		webhook: 202,
	},
	"query-engine": {
		execute: 200,
	},
	"saved-views": {
		clone: 201,
		create: 201,
		delete: 200,
		get: 200,
		list: 200,
		reorder: 200,
		update: 200,
	},
	sandbox: {
		createScript: 201,
		enqueue: 200,
		getResult: 200,
	},
	system: {
		config: 200,
		health: 200,
	},
	trackers: {
		create: 201,
		list: 200,
		reorder: 200,
		update: 200,
	},
	uploads: {
		createPresigned: 200,
		createPresignedDownload: 200,
		uploadTemporary: 201,
	},
} as const satisfies { [G in GroupKey]: { [M in MethodKey<G>]: number } };

const hasStatusTag = (value: string): value is keyof typeof statusByTag => value in statusByTag;

function getStatus(error: unknown) {
	if (typeof error !== "object" || error === null) {
		return 500;
	}

	if ("response" in error) {
		const response = error.response;
		if (typeof response === "object" && response !== null && "status" in response) {
			const status = response.status;
			if (typeof status === "number") {
				return status;
			}
		}
	}

	const tag = Reflect.get(error, "_tag");
	if (typeof tag === "string" && hasStatusTag(tag)) {
		return statusByTag[tag];
	}

	return 500;
}

function getMessage(error: unknown) {
	if (typeof error === "string") {
		return error;
	}

	if (typeof error === "object" && error !== null && "message" in error) {
		const message = error.message;
		if (typeof message === "string") {
			return message;
		}
	}

	return "Request failed";
}

function toContractRequest(request: unknown) {
	if (typeof request !== "object" || request === null) {
		return { headers: {}, request: undefined };
	}

	const { body, headers, params } = request as {
		body?: unknown;
		headers?: RequestHeaders;
		params?: { path?: unknown; query?: unknown };
	};
	const contractRequest: Record<string, unknown> = {};

	if (body !== undefined) {
		contractRequest.payload = body;
	}

	if (params?.path !== undefined) {
		contractRequest.path = params.path;
	}

	if (params?.query !== undefined) {
		contractRequest.urlParams = params.query;
	}

	return {
		headers: headers ?? {},
		request: Object.keys(contractRequest).length > 0 ? contractRequest : undefined,
	};
}

function normalizeSuccessResult(result: unknown) {
	if (!Array.isArray(result) || result.length !== 2) {
		return { data: result, status: undefined };
	}

	const [data, response] = result;
	if (typeof response !== "object" || response === null || !("status" in response)) {
		return { data: result, status: undefined };
	}

	const status = response.status;
	return {
		data,
		status: typeof status === "number" ? status : undefined,
	};
}

async function executeRequest<G extends GroupKey, M extends MethodKey<G>>(
	baseUrl: string,
	group: G,
	method: M,
	status: number,
	request?: LegacyRequest<ContractRequest<G, M>>,
): BackendResult<ContractSuccess<G, M>> {
	const runtime = toContractRequest(request);
	const program = withClient(baseUrl, runtime.headers, (client) => {
		const handler = client[group][method] as ContractMethod<G, M>;
		return runtime.request === undefined ? handler() : handler(runtime.request);
	}).pipe(Effect.provide(FetchHttpClient.layer), Effect.either) as Effect.Effect<
		Either.Either<unknown, ContractSuccess<G, M>>
	>;

	try {
		const result = await Effect.runPromise(program);
		if (Either.isRight(result)) {
			const normalized = normalizeSuccessResult(result.right);
			return {
				data: normalized.data as ContractSuccess<G, M>,
				response: { status: normalized.status ?? status },
			};
		}

		return {
			error: { error: { message: getMessage(result.left) } },
			response: { status: getStatus(result.left) },
		};
	} catch (error) {
		return {
			error: { error: { message: getMessage(error) } },
			response: { status: getStatus(error) },
		};
	}
}

export function createBackendClient(baseUrl: string): BackendClient {
	const coreClient: BackendClientCore = {
		collections: {
			create: (request) =>
				executeRequest(baseUrl, "collections", "create", successStatus.collections.create, request),
			createMembership: (request) =>
				executeRequest(
					baseUrl,
					"collections",
					"createMembership",
					successStatus.collections.createMembership,
					request,
				),
			deleteMembership: (request) =>
				executeRequest(
					baseUrl,
					"collections",
					"deleteMembership",
					successStatus.collections.deleteMembership,
					request,
				),
		},
		entities: {
			clearUserState: (request) =>
				executeRequest(
					baseUrl,
					"entities",
					"clearUserState",
					successStatus.entities.clearUserState,
					request,
				),
			create: (request) =>
				executeRequest(baseUrl, "entities", "create", successStatus.entities.create, request),
			get: (request) =>
				executeRequest(baseUrl, "entities", "get", successStatus.entities.get, request),
			getImportResult: (request) =>
				executeRequest(
					baseUrl,
					"entities",
					"getImportResult",
					successStatus.entities.getImportResult,
					request,
				),
			import: (request) =>
				executeRequest(baseUrl, "entities", "import", successStatus.entities.import, request),
		},
		"entity-schemas": {
			create: (request) =>
				executeRequest(
					baseUrl,
					"entity-schemas",
					"create",
					successStatus["entity-schemas"].create,
					request,
				),
			get: (request) =>
				executeRequest(
					baseUrl,
					"entity-schemas",
					"get",
					successStatus["entity-schemas"].get,
					request,
				),
			getSearchResult: (request) =>
				executeRequest(
					baseUrl,
					"entity-schemas",
					"getSearchResult",
					successStatus["entity-schemas"].getSearchResult,
					request,
				),
			list: (request) =>
				executeRequest(
					baseUrl,
					"entity-schemas",
					"list",
					successStatus["entity-schemas"].list,
					request,
				),
			search: (request) =>
				executeRequest(
					baseUrl,
					"entity-schemas",
					"search",
					successStatus["entity-schemas"].search,
					request,
				),
		},
		"event-schemas": {
			create: (request) =>
				executeRequest(
					baseUrl,
					"event-schemas",
					"create",
					successStatus["event-schemas"].create,
					request,
				),
			list: (request) =>
				executeRequest(
					baseUrl,
					"event-schemas",
					"list",
					successStatus["event-schemas"].list,
					request,
				),
		},
		events: {
			create: (request) =>
				executeRequest(baseUrl, "events", "create", successStatus.events.create, request),
			list: (request) =>
				executeRequest(baseUrl, "events", "list", successStatus.events.list, request),
		},
		"god-mode": {
			listUsers: (request) =>
				executeRequest(
					baseUrl,
					"god-mode",
					"listUsers",
					successStatus["god-mode"].listUsers,
					request,
				),
			provisionUser: (request) =>
				executeRequest(
					baseUrl,
					"god-mode",
					"provisionUser",
					successStatus["god-mode"].provisionUser,
					request,
				),
			resetUserPassword: (request) =>
				executeRequest(
					baseUrl,
					"god-mode",
					"resetUserPassword",
					successStatus["god-mode"].resetUserPassword,
					request,
				),
			setUserBan: (request) =>
				executeRequest(
					baseUrl,
					"god-mode",
					"setUserBan",
					successStatus["god-mode"].setUserBan,
					request,
				),
		},
		imports: {
			createRun: (request) =>
				executeRequest(baseUrl, "imports", "createRun", successStatus.imports.createRun, request),
			deleteRun: (request) =>
				executeRequest(baseUrl, "imports", "deleteRun", successStatus.imports.deleteRun, request),
			getRun: (request) =>
				executeRequest(baseUrl, "imports", "getRun", successStatus.imports.getRun, request),
			listRuns: (request) =>
				executeRequest(baseUrl, "imports", "listRuns", successStatus.imports.listRuns, request),
		},
		integrations: {
			create: (request) =>
				executeRequest(
					baseUrl,
					"integrations",
					"create",
					successStatus.integrations.create,
					request,
				),
			delete: (request) =>
				executeRequest(
					baseUrl,
					"integrations",
					"delete",
					successStatus.integrations.delete,
					request,
				),
			get: (request) =>
				executeRequest(baseUrl, "integrations", "get", successStatus.integrations.get, request),
			getRuns: (request) =>
				executeRequest(
					baseUrl,
					"integrations",
					"getRuns",
					successStatus.integrations.getRuns,
					request,
				),
			list: (request) =>
				executeRequest(baseUrl, "integrations", "list", successStatus.integrations.list, request),
			update: (request) =>
				executeRequest(
					baseUrl,
					"integrations",
					"update",
					successStatus.integrations.update,
					request,
				),
			webhook: (request) =>
				executeRequest(
					baseUrl,
					"integrations",
					"webhook",
					successStatus.integrations.webhook,
					request,
				),
		},
		"query-engine": {
			execute: (request) =>
				executeRequest(
					baseUrl,
					"query-engine",
					"execute",
					successStatus["query-engine"].execute,
					request,
				),
		},
		"saved-views": {
			clone: (request) =>
				executeRequest(
					baseUrl,
					"saved-views",
					"clone",
					successStatus["saved-views"].clone,
					request,
				),
			create: (request) =>
				executeRequest(
					baseUrl,
					"saved-views",
					"create",
					successStatus["saved-views"].create,
					request,
				),
			delete: (request) =>
				executeRequest(
					baseUrl,
					"saved-views",
					"delete",
					successStatus["saved-views"].delete,
					request,
				),
			get: (request) =>
				executeRequest(baseUrl, "saved-views", "get", successStatus["saved-views"].get, request),
			list: (request) =>
				executeRequest(baseUrl, "saved-views", "list", successStatus["saved-views"].list, request),
			reorder: (request) =>
				executeRequest(
					baseUrl,
					"saved-views",
					"reorder",
					successStatus["saved-views"].reorder,
					request,
				),
			update: (request) =>
				executeRequest(
					baseUrl,
					"saved-views",
					"update",
					successStatus["saved-views"].update,
					request,
				),
		},
		sandbox: {
			createScript: (request) =>
				executeRequest(
					baseUrl,
					"sandbox",
					"createScript",
					successStatus.sandbox.createScript,
					request,
				),
			enqueue: (request) =>
				executeRequest(baseUrl, "sandbox", "enqueue", successStatus.sandbox.enqueue, request),
			getResult: (request) =>
				executeRequest(baseUrl, "sandbox", "getResult", successStatus.sandbox.getResult, request),
		},
		system: {
			config: (request) =>
				executeRequest(baseUrl, "system", "config", successStatus.system.config, request),
			health: (request) =>
				executeRequest(baseUrl, "system", "health", successStatus.system.health, request),
		},
		trackers: {
			create: (request) =>
				executeRequest(baseUrl, "trackers", "create", successStatus.trackers.create, request),
			list: (request) =>
				executeRequest(baseUrl, "trackers", "list", successStatus.trackers.list, request),
			reorder: (request) =>
				executeRequest(baseUrl, "trackers", "reorder", successStatus.trackers.reorder, request),
			update: (request) =>
				executeRequest(baseUrl, "trackers", "update", successStatus.trackers.update, request),
		},
		uploads: {
			createPresigned: (request) =>
				executeRequest(
					baseUrl,
					"uploads",
					"createPresigned",
					successStatus.uploads.createPresigned,
					request,
				),
			createPresignedDownload: (request) =>
				executeRequest(
					baseUrl,
					"uploads",
					"createPresignedDownload",
					successStatus.uploads.createPresignedDownload,
					request,
				),
			uploadTemporary: (request) =>
				executeRequest(
					baseUrl,
					"uploads",
					"uploadTemporary",
					successStatus.uploads.uploadTemporary,
					request,
				),
		},
	};

	return withLegacyBackendClientMethods(coreClient);
}

type MethodRequest<
	G extends keyof BackendClientCore,
	M extends keyof BackendClientCore[G],
> = Parameters<BackendClientCore[G][M]>[0];
type MethodResult<
	G extends keyof BackendClientCore,
	M extends keyof BackendClientCore[G],
> = Awaited<ReturnType<BackendClientCore[G][M]>>;

export type ClientBody<G extends keyof BackendClientCore, M extends keyof BackendClientCore[G]> =
	NonNullable<MethodRequest<G, M>> extends { body?: infer Body } ? Body : never;
export type ClientPath<G extends keyof BackendClientCore, M extends keyof BackendClientCore[G]> =
	NonNullable<MethodRequest<G, M>> extends { params?: infer Params }
		? Params extends { path?: infer Path }
			? Path
			: never
		: never;
export type ClientQuery<G extends keyof BackendClientCore, M extends keyof BackendClientCore[G]> =
	NonNullable<MethodRequest<G, M>> extends { params?: infer Params }
		? Params extends { query?: infer Query }
			? Query
			: never
		: never;
export type ClientSuccess<
	G extends keyof BackendClientCore,
	M extends keyof BackendClientCore[G],
> = Exclude<MethodResult<G, M>["data"], undefined>;

export type { BackendClient };
