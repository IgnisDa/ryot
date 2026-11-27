type S3Image = { type: "s3"; key: string };
type RemoteImage = { type: "remote"; url: string };
export type EntityImage = S3Image | RemoteImage | null;

export function toEntityImage(raw: unknown): EntityImage {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	if ("type" in raw && raw.type === "s3" && "key" in raw && typeof raw.key === "string") {
		return { type: "s3", key: raw.key };
	}
	if ("type" in raw && raw.type === "remote" && "url" in raw && typeof raw.url === "string") {
		return { type: "remote", url: raw.url };
	}
	return null;
}
