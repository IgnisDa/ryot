type RequestHeaders = Record<string, string>;

type LegacyRequest = {
	// oxlint-disable-next-line typescript-eslint/no-explicit-any
	body?: any;
	headers?: RequestHeaders;
	params?: {
		// oxlint-disable-next-line typescript-eslint/no-explicit-any
		path?: any;
		// oxlint-disable-next-line typescript-eslint/no-explicit-any
		query?: any;
	};
};

type LegacyResponse = Promise<{
	// oxlint-disable-next-line typescript-eslint/no-explicit-any
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
	entitySchemas: {
		create: RouteMethod;
		get: RouteMethod;
		getSearchResult: RouteMethod;
		list: RouteMethod;
		search: RouteMethod;
	};
	eventSchemas: {
		create: RouteMethod;
		list: RouteMethod;
	};
	events: {
		create: RouteMethod;
		list: RouteMethod;
	};
	godMode: {
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
	queryEngine: {
		execute: RouteMethod;
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

// TODO(Task 22/23): Remove these legacy path-string test client methods once the
// remaining tests call the contract client methods directly.
// Saved-views entries were removed as part of Task 23.
const getHandlers: Record<string, LegacyRouteHandler> = {
	"/entity-schemas/{entitySchemaId}": (client, request) => client.entitySchemas.get(request),
	"/entity-schemas/search/{jobId}": (client, request) =>
		client.entitySchemas.getSearchResult(request),
	"/entities/{entityId}": (client, request) => client.entities.get(request),
	"/entities/import/{jobId}": (client, request) => client.entities.getImportResult(request),
	"/events": (client, request) => client.events.list(request),
	"/god-mode/users": (client, request) => client.godMode.listUsers(request),
	"/imports/runs": (client, request) => client.imports.listRuns(request),
	"/imports/runs/{runId}": (client, request) => client.imports.getRun(request),
	"/integrations/{integrationId}": (client, request) => client.integrations.get(request),
	"/integrations/{integrationId}/runs": (client, request) => client.integrations.getRuns(request),
	"/sandbox/result/{jobId}": (client, request) => client.sandbox.getResult(request),
	"/system/config": (client, request) => client.system.config(request),
	"/trackers": (client, request) => client.trackers.list(request),
};

const postHandlers: Record<string, LegacyRouteHandler> = {
	"/collections": (client, request) => client.collections.create(request),
	"/collections/memberships": (client, request) => client.collections.createMembership(request),
	"/entity-schemas": (client, request) => client.entitySchemas.create(request),
	"/entity-schemas/list": (client, request) => client.entitySchemas.list(request),
	"/entity-schemas/search": (client, request) => client.entitySchemas.search(request),
	"/entities": (client, request) => client.entities.create(request),
	"/entities/import": (client, request) => client.entities.import(request),
	"/event-schemas": (client, request) => client.eventSchemas.create(request),
	"/events": (client, request) => client.events.create(request),
	"/god-mode/users/{userId}/ban/set": (client, request) => client.godMode.setUserBan(request),
	"/god-mode/users/{userId}/reset-password": (client, request) =>
		client.godMode.resetUserPassword(request),
	"/imports/runs": (client, request) => client.imports.createRun(request),
	"/integrations": (client, request) => client.integrations.create(request),
	"/query-engine/execute": (client, request) => client.queryEngine.execute(request),
	"/sandbox/enqueue": (client, request) => client.sandbox.enqueue(request),
	"/uploads/presigned": (client, request) => client.uploads.createPresigned(request),
	"/uploads/presigned/download": (client, request) =>
		client.uploads.createPresignedDownload(request),
};

const patchHandlers: Record<string, LegacyRouteHandler> = {
	"/integrations/{integrationId}": (client, request) => client.integrations.update(request),
};

const putHandlers: Record<string, LegacyRouteHandler> = {};

const deleteHandlers: Record<string, LegacyRouteHandler> = {
	"/collections/memberships": (client, request) => client.collections.deleteMembership(request),
	"/entities/{entityId}/user-state": (client, request) => client.entities.clearUserState(request),
	"/imports/runs/{runId}": (client, request) => client.imports.deleteRun(request),
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
