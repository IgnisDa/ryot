export type EntityImage = { kind: "s3"; key: string } | { kind: "remote"; url: string } | null;

export function toEntityImage(raw: unknown): EntityImage {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	if ("kind" in raw && raw.kind === "s3" && "key" in raw && typeof raw.key === "string") {
		return { kind: "s3", key: raw.key };
	}
	if ("kind" in raw && raw.kind === "remote" && "url" in raw && typeof raw.url === "string") {
		return { kind: "remote", url: raw.url };
	}
	return null;
}
