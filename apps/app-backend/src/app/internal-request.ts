import { setInternalRequestAuth } from "./internal-auth";

const internalAppOrigin = "http://ryot.internal";

type AppRequestHandler = (request: Request) => Promise<Response> | Response;

export type InternalAppRequestInput = {
	path: string;
	body?: unknown;
	userId: string;
	method: string;
	headers?: Record<string, string>;
};

let appRequestHandler: AppRequestHandler | null = null;

export const registerInternalAppRequestHandler = (
	handler: AppRequestHandler | null,
) => {
	appRequestHandler = handler;
};

export const normalizeBaseAppPath = (path: string) => {
	const trimmedPath = path.trim();
	if (!trimmedPath) {
		throw new Error("appApiCall expects a non-empty path string");
	}

	let requestUrl: URL;
	try {
		requestUrl = new URL(trimmedPath, internalAppOrigin);
	} catch {
		throw new Error("appApiCall path is invalid");
	}

	if (requestUrl.origin !== internalAppOrigin) {
		throw new Error("appApiCall expects a base-app path, not a full URL");
	}

	let decodedPathname: string;
	try {
		decodedPathname = requestUrl.pathname
			.split("/")
			.map((segment) => decodeURIComponent(segment))
			.join("/");
	} catch {
		throw new Error("appApiCall path is invalid");
	}

	const pathname =
		decodedPathname === "/api"
			? "/"
			: decodedPathname.startsWith("/api/")
				? decodedPathname.slice(4)
				: decodedPathname;

	if (pathname === "/auth" || pathname.startsWith("/auth/")) {
		throw new Error("appApiCall cannot target /api/auth routes");
	}

	if (pathname === "/sandbox" || pathname.startsWith("/sandbox/")) {
		throw new Error("appApiCall cannot target /api/sandbox routes");
	}

	return `${pathname}${requestUrl.search}`;
};

export const executeInternalAppRequest = async (
	input: InternalAppRequestInput,
) => {
	if (!appRequestHandler) {
		throw new Error("Internal app request handler is not registered");
	}

	const normalizedPath = normalizeBaseAppPath(input.path);
	const headers = new Headers(input.headers);
	const body =
		input.body === undefined ? undefined : JSON.stringify(input.body);

	if (body !== undefined && !headers.has("content-type")) {
		headers.set("content-type", "application/json");
	}

	const request = setInternalRequestAuth(
		new Request(new URL(normalizedPath, internalAppOrigin), {
			body,
			headers,
			method: input.method,
		}),
		{ userId: input.userId },
	);

	return await appRequestHandler(request);
};
