import type { FieldValue } from "../language";

// count is never null (COUNT(*) ≥ 0); sum/average/minimum/maximum over an empty numeric set are
// NULL, which becomes the `null` kind.
export const reconstructMeasureValue = (raw: unknown): FieldValue =>
	raw === null || raw === undefined
		? { kind: "null", value: null }
		: { kind: "number", value: Number(raw) };

// Maps a compiled output field's (value, kind) column pair back to a FieldValue. The `kind` column
// is produced by compileValue (a literal or a runtime CASE); a null value or 'null' kind → null.
export const reconstructOutputValue = (value: unknown, kind: unknown): FieldValue => {
	if (value === null || value === undefined) {
		return { kind: "null", value: null };
	}
	switch (kind) {
		case "text":
			return { kind: "text", value };
		case "number":
			return { kind: "number", value };
		case "boolean":
			return { kind: "boolean", value };
		case "date":
			return { kind: "date", value };
		case "json":
			return { kind: "json", value };
		default:
			return { kind: "null", value: null };
	}
};
