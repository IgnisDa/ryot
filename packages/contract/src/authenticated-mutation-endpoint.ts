import { HttpApiEndpoint } from "effect/http-api";

import { DemoAccessPolicy } from "./http-annotations";

const withDemoAccessPolicy =
	<Method extends "POST" | "PUT" | "PATCH" | "DELETE">(method: Method) =>
	(policy: DemoAccessPolicy) =>
		new Proxy(HttpApiEndpoint.make(method), {
			apply(target, thisArg, args) {
				const endpoint: unknown = Reflect.apply(target, thisArg, args);
				if (!HttpApiEndpoint.isHttpApiEndpoint(endpoint)) {
					throw new TypeError("Expected an HTTP API endpoint");
				}
				return endpoint.annotate(DemoAccessPolicy, policy);
			},
		});

export const AuthenticatedMutationEndpoint = {
	put: withDemoAccessPolicy("PUT"),
	post: withDemoAccessPolicy("POST"),
	patch: withDemoAccessPolicy("PATCH"),
	delete: withDemoAccessPolicy("DELETE"),
};
