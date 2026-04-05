import type { AppPropertyDefinition, AppSchema } from "@ryot/ts-utils";
import { match } from "ts-pattern";

export interface EntityDetailProperty {
	key: string;
	label: string;
	value: string;
	rawValue: unknown;
	type: AppPropertyDefinition["type"];
}

function formatEntityDetailPropertyValue(
	propertyDef: AppPropertyDefinition,
	value: unknown,
): string | null {
	if (value === null || value === undefined) {
		return null;
	}

	return match(propertyDef.type)
		.with("boolean", () =>
			typeof value === "boolean" ? (value ? "Yes" : "No") : null,
		)
		.with("integer", () =>
			typeof value === "number" ? value.toLocaleString() : null,
		)
		.with("number", () =>
			typeof value === "number" ? value.toLocaleString() : null,
		)
		.with("string", () =>
			typeof value === "string" && value.trim() !== "" ? value : null,
		)
		.with("date", () => {
			if (typeof value === "string" && value.trim() !== "") {
				try {
					const date = new Date(value);
					if (!Number.isNaN(date.getTime())) {
						return date.toLocaleDateString(undefined, {
							year: "numeric",
							month: "long",
							day: "numeric",
						});
					}
				} catch {
					return value;
				}
			}
			return null;
		})
		.with("datetime", () => {
			if (typeof value === "string" && value.trim() !== "") {
				try {
					const date = new Date(value);
					if (!Number.isNaN(date.getTime())) {
						return date.toLocaleString(undefined, {
							month: "long",
							day: "numeric",
							hour: "numeric",
							year: "numeric",
							minute: "2-digit",
						});
					}
				} catch {
					return value;
				}
			}
			return null;
		})
		.with("array", () => {
			if (Array.isArray(value) && value.length > 0) {
				const items = value
					.map((item) => {
						if (typeof item === "string") {
							return item;
						}
						if (typeof item === "number") {
							return item.toString();
						}
						if (typeof item === "boolean") {
							return item ? "Yes" : "No";
						}
						return null;
					})
					.filter((item): item is string => item !== null);

				if (items.length > 0) {
					return items.length <= 5
						? items.join(", ")
						: `${items.slice(0, 5).join(", ")}... (${items.length} total)`;
				}
			}
			return null;
		})
		.with("object", () => {
			if (value && typeof value === "object" && !Array.isArray(value)) {
				const entries = Object.entries(value).filter(
					([, val]) => val !== null && val !== undefined,
				);
				if (entries.length > 0) {
					return entries.map(([k, v]) => `${k}: ${String(v)}`).join(", ");
				}
			}
			return null;
		})
		.exhaustive();
}

export function getEntityDetailProperties(
	propertiesSchema: AppSchema,
	properties: Record<string, unknown>,
): EntityDetailProperty[] {
	return Object.entries(propertiesSchema.fields)
		.map(([key, propertyDef]) => {
			const rawValue = properties[key];
			const value = formatEntityDetailPropertyValue(propertyDef, rawValue);
			if (value === null) {
				return null;
			}

			return { key, value, rawValue, label: key, type: propertyDef.type };
		})
		.filter((property): property is EntityDetailProperty => !!property);
}
