import type { ComponentType } from "react";

const wrappedComponentTypes = new Set<unknown>([
	Symbol.for("react.forward_ref"),
	Symbol.for("react.memo"),
]);

export const isComponentType = (value: unknown): value is ComponentType =>
	typeof value === "function" ||
	(typeof value === "object" &&
		value !== null &&
		"$$typeof" in value &&
		wrappedComponentTypes.has(value.$$typeof));
