// oxlint-disable typescript-eslint/no-unsafe-type-assertion

type RequestHeaders = Record<string, string>;

type LegacyRequest = {
	body?: any;
	headers?: RequestHeaders;
	params?: {
		path?: any;
		query?: any;
	};
};

type LegacyResponse = Promise<{
	data?: any;
	error?: { error: { message: string } };
	response: { status: number };
}>;

type RouteMethod = (request?: LegacyRequest) => LegacyResponse;

type LegacyRouteHandler = (
	client: LegacyCapableBackendClient,
	request?: LegacyRequest,
) => LegacyResponse;

type LegacyCapableBackendClient = {
	collections: {
		create: RouteMethod;
		createMembership: RouteMethod;
		deleteMembership: RouteMethod;
	};
	entities: {
		clearUserState: RouteMethod;
		create: RouteMethod;
		get: RouteMethod;
		getImportResult: RouteMethod;
		import: RouteMethod;
	};
	"entity-schemas": {
		create: RouteMethod;
		get: RouteMethod;
		getSearchResult: RouteMethod;
		list: RouteMethod;
		search: RouteMethod;
	};
	"event-schemas": {
		create: RouteMethod;
		list: RouteMethod;
	};
	events: {
		create: RouteMethod;
		list: RouteMethod;
	};
	"god-mode": {
		listUsers: RouteMethod;
		resetUserPassword: RouteMethod;
		setUserBan: RouteMethod;
	};
	imports: {
		createRun: RouteMethod;
		deleteRun: RouteMethod;
		getRun: RouteMethod;
		listRuns: RouteMethod;
	};
	integrations: {
		create: RouteMethod;
		get: RouteMethod;
		getRuns: RouteMethod;
		update: RouteMethod;
	};
	"query-engine": {
		execute: RouteMethod;
	};
	"saved-views": {
		clone: RouteMethod;
		create: RouteMethod;
		delete: RouteMethod;
		get: RouteMethod;
		reorder: RouteMethod;
		update: RouteMethod;
	};
	sandbox: {
		enqueue: RouteMethod;
		getResult: RouteMethod;
	};
	system: {
		config: RouteMethod;
	};
	trackers: {
		list: RouteMethod;
	};
	uploads: {
		createPresigned: RouteMethod;
		createPresignedDownload: RouteMethod;
	};
};

type LegacyBackendClient = {
	GET: (path: string, request?: LegacyRequest) => LegacyResponse;
	POST: (path: string, request?: LegacyRequest) => LegacyResponse;
	PATCH: (path: string, request?: LegacyRequest) => LegacyResponse;
	PUT: (path: string, request?: LegacyRequest) => LegacyResponse;
	DELETE: (path: string, request?: LegacyRequest) => LegacyResponse;
};

const unsupportedRoute = (method: string, path: string) => {
	throw new Error(`Unsupported legacy backend client route: ${method} ${path}`);
};

const directPayloadPaths = new Set(["/query-engine/execute"]);

const toLegacyResponse = async (path: string, response: LegacyResponse): LegacyResponse => {
	const result = await response;
	if (result.error) {
		return result;
	}

	return {
		data:
			result.data === undefined
				? undefined
				: directPayloadPaths.has(path)
					? result.data
					: { data: result.data },
		response: { status: 200 },
	};
};

// TODO(Task 22): Remove these legacy path-string test client methods once the
// remaining tests call the contract client methods directly.
const getHandlers: Record<string, LegacyRouteHandler> = {
	"/entity-schemas/{entitySchemaId}": (client, request) =>
		client["entity-schemas"].get(request as never),
	"/entity-schemas/search/{jobId}": (client, request) =>
		client["entity-schemas"].getSearchResult(request as never),
	"/entities/{entityId}": (client, request) => client.entities.get(request as never),
	"/entities/import/{jobId}": (client, request) =>
		client.entities.getImportResult(request as never),
	"/events": (client, request) => client.events.list(request as never),
	"/god-mode/users": (client, request) => client["god-mode"].listUsers(request as never),
	"/imports/runs": (client, request) => client.imports.listRuns(request as never),
	"/imports/runs/{runId}": (client, request) => client.imports.getRun(request as never),
	"/integrations/{integrationId}": (client, request) => client.integrations.get(request as never),
	"/integrations/{integrationId}/runs": (client, request) =>
		client.integrations.getRuns(request as never),
	"/sandbox/result/{jobId}": (client, request) => client.sandbox.getResult(request as never),
	"/saved-views/{viewSlug}": (client, request) => client["saved-views"].get(request as never),
	"/system/config": (client, request) => client.system.config(request as never),
	"/trackers": (client, request) => client.trackers.list(request as never),
};

const postHandlers: Record<string, LegacyRouteHandler> = {
	"/collections": (client, request) => client.collections.create(request as never),
	"/collections/memberships": (client, request) =>
		client.collections.createMembership(request as never),
	"/entity-schemas": (client, request) => client["entity-schemas"].create(request as never),
	"/entity-schemas/list": (client, request) => client["entity-schemas"].list(request as never),
	"/entity-schemas/search": (client, request) => client["entity-schemas"].search(request as never),
	"/entities": (client, request) => client.entities.create(request as never),
	"/entities/import": (client, request) => client.entities.import(request as never),
	"/event-schemas": (client, request) => client["event-schemas"].create(request as never),
	"/events": (client, request) => client.events.create(request as never),
	"/god-mode/users/{userId}/ban/set": (client, request) =>
		client["god-mode"].setUserBan(request as never),
	"/god-mode/users/{userId}/reset-password": (client, request) =>
		client["god-mode"].resetUserPassword(request as never),
	"/imports/runs": (client, request) => client.imports.createRun(request as never),
	"/integrations": (client, request) => client.integrations.create(request as never),
	"/query-engine/execute": (client, request) => client["query-engine"].execute(request as never),
	"/sandbox/enqueue": (client, request) => client.sandbox.enqueue(request as never),
	"/saved-views": (client, request) => client["saved-views"].create(request as never),
	"/saved-views/{viewSlug}/clone": (client, request) =>
		client["saved-views"].clone(request as never),
	"/saved-views/reorder": (client, request) => client["saved-views"].reorder(request as never),
	"/uploads/presigned": (client, request) => client.uploads.createPresigned(request as never),
	"/uploads/presigned/download": (client, request) =>
		client.uploads.createPresignedDownload(request as never),
};

const patchHandlers: Record<string, LegacyRouteHandler> = {
	"/integrations/{integrationId}": (client, request) =>
		client.integrations.update(request as never),
};

const putHandlers: Record<string, LegacyRouteHandler> = {
	"/saved-views/{viewSlug}": (client, request) => client["saved-views"].update(request as never),
};

const deleteHandlers: Record<string, LegacyRouteHandler> = {
	"/collections/memberships": (client, request) =>
		client.collections.deleteMembership(request as never),
	"/entities/{entityId}/user-state": (client, request) =>
		client.entities.clearUserState(request as never),
	"/imports/runs/{runId}": (client, request) => client.imports.deleteRun(request as never),
	"/saved-views/{viewSlug}": (client, request) => client["saved-views"].delete(request as never),
};

export function withLegacyBackendClientMethods<T extends LegacyCapableBackendClient>(
	client: T,
): T & LegacyBackendClient {
	return Object.assign(client, {
		GET: (path: string, request?: LegacyRequest) =>
			toLegacyResponse(path, (getHandlers[path] ?? unsupportedRoute("GET", path))(client, request)),
		POST: (path: string, request?: LegacyRequest) =>
			toLegacyResponse(
				path,
				(postHandlers[path] ?? unsupportedRoute("POST", path))(client, request),
			),
		PATCH: (path: string, request?: LegacyRequest) =>
			toLegacyResponse(
				path,
				(patchHandlers[path] ?? unsupportedRoute("PATCH", path))(client, request),
			),
		PUT: (path: string, request?: LegacyRequest) =>
			toLegacyResponse(path, (putHandlers[path] ?? unsupportedRoute("PUT", path))(client, request)),
		DELETE: (path: string, request?: LegacyRequest) =>
			toLegacyResponse(
				path,
				(deleteHandlers[path] ?? unsupportedRoute("DELETE", path))(client, request),
			),
	});
}

export type { LegacyBackendClient };
