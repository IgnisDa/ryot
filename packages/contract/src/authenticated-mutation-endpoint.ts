import { HttpApiEndpoint } from "effect/http-api";

import { MutationPolicy } from "./http-annotations";

const withMutationPolicy =
	<Method extends "PUT" | "POST" | "PATCH" | "DELETE">(method: Method) =>
	(policy: MutationPolicy) =>
		new Proxy(HttpApiEndpoint.make(method), {
			apply(target, thisArg, args) {
				const endpoint: unknown = Reflect.apply(target, thisArg, args);
				if (!HttpApiEndpoint.isHttpApiEndpoint(endpoint)) {
					throw new TypeError("Expected an HTTP API endpoint");
				}
				return endpoint.annotate(MutationPolicy, policy);
			},
		});

export const AuthenticatedMutationEndpoint = {
	put: withMutationPolicy("PUT"),
	post: withMutationPolicy("POST"),
	patch: withMutationPolicy("PATCH"),
	delete: withMutationPolicy("DELETE"),
};
