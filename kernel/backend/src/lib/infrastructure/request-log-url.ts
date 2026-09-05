import { AppContract } from "@ryot-app/contract/contract";
import { LogRouteTemplate } from "@ryot-app/contract/http-annotations";
import { Context, Effect, Layer } from "effect";
import type { HttpServerRequest } from "effect/unstable/http";
import { HttpApi } from "effect/unstable/httpapi";

const apiPrefix = "/api";
const routeTemplates: string[] = [];

HttpApi.reflect(AppContract, {
	onGroup: () => undefined,
	onEndpoint: ({ endpoint, mergedAnnotations }) => {
		if (Context.get(mergedAnnotations, LogRouteTemplate)) {
			routeTemplates.push(`${apiPrefix}${endpoint.path}`);
		}
	},
});

const matchesRouteTemplate = (pathname: string, template: string) => {
	const pathSegments = pathname.split("/");
	const templateSegments = template.split("/");
	const hasTerminalWildcard = templateSegments.at(-1) === "*";
	const matchedSegments = hasTerminalWildcard ? templateSegments.slice(0, -1) : templateSegments;
	return (
		(hasTerminalWildcard
			? pathSegments.length >= templateSegments.length
			: pathSegments.length === templateSegments.length) &&
		matchedSegments.every(
			(segment, index) => segment.startsWith(":") || segment === pathSegments[index],
		)
	);
};

export class RequestLogUrl extends Context.Service<
	RequestLogUrl,
	{ readonly resolve: (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<string> }
>()("RequestLogUrl") {
	static readonly layer = Layer.succeed(
		this,
		this.of({
			resolve: (request) =>
				Effect.sync(() => {
					const pathname = new URL(request.originalUrl).pathname;
					return (
						routeTemplates.find((template) => matchesRouteTemplate(pathname, template)) ??
						request.url
					);
				}),
		}),
	);
}
