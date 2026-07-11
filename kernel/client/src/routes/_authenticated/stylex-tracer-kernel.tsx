import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";

const enabled = typeof __RYOT_STYLEX_TRACER__ !== "undefined" && __RYOT_STYLEX_TRACER__;

export function requireStylexTracer(value: boolean) {
	if (!value) {
		// oxlint-disable-next-line typescript/only-throw-error -- TanStack Router uses thrown not-found results.
		throw notFound();
	}
}

const enabledComponent = enabled
	? { component: lazyRouteComponent(() => import("./-stylex-tracer-screen"), "StyleXTracerScreen") }
	: {};

export const Route = createFileRoute("/_authenticated/stylex-tracer-kernel")({
	...enabledComponent,
	beforeLoad: () => requireStylexTracer(enabled),
});
