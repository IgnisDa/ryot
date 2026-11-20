import { API_URL, getAuthorizationCookie } from "~/lib/utilities.server";
import type { Route } from "./+types/api.graphql";

export const action = async ({ request }: Route.ActionArgs) => {
	if (request.method !== "POST")
		return new Response(null, { status: 405, headers: { Allow: "POST" } });
	if (request.headers.get("origin") !== new URL(request.url).origin)
		return new Response(null, { status: 403 });
	const contentType = request.headers.get("content-type");
	if (contentType?.split(";")[0].trim().toLowerCase() !== "application/json")
		return new Response(null, { status: 415 });
	const token = getAuthorizationCookie(request);
	if (!token) return new Response(null, { status: 401 });

	const upstreamRequest = {
		method: "POST",
		duplex: "half",
		redirect: "error",
		body: request.body,
		signal: request.signal,
		headers: {
			"Content-Type": contentType,
			Authorization: `Bearer ${token}`,
		},
	} as const;
	const response = await fetch(`${API_URL}/graphql`, upstreamRequest);
	return new Response(response.body, {
		status: response.status,
		headers: {
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			"Content-Type": response.headers.get("content-type") || "text/plain",
		},
	});
};
