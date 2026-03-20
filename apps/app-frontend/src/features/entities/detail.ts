import type { AppPropertyDefinition, AppSchema } from "@ryot/ts-utils";

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

	switch (propertyDef.type) {
		case "boolean":
			return typeof value === "boolean" ? (value ? "Yes" : "No") : null;
		case "integer":
		case "number":
			return typeof value === "number" ? value.toLocaleString() : null;
		case "string":
			return typeof value === "string" && value.trim() !== "" ? value : null;
		case "date": {
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
		}
		case "array": {
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
		}
		case "object": {
			if (value && typeof value === "object" && !Array.isArray(value)) {
				const entries = Object.entries(value).filter(
					([, val]) => val !== null && val !== undefined,
				);
				if (entries.length > 0) {
					return entries.map(([k, v]) => `${k}: ${String(v)}`).join(", ");
				}
			}
			return null;
		}
	}
}

export function getEntityDetailProperties(
	propertiesSchema: AppSchema,
	properties: Record<string, unknown>,
): EntityDetailProperty[] {
	return Object.entries(propertiesSchema)
		.map(([key, propertyDef]) => {
			const rawValue = properties[key];
			const value = formatEntityDetailPropertyValue(propertyDef, rawValue);
			if (value === null) {
				return null;
			}

			return {
				key,
				value,
				rawValue,
				label: key,
				type: propertyDef.type,
			};
		})
		.filter((property): property is EntityDetailProperty => !!property);
}
