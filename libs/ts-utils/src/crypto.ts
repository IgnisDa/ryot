type HashInput = string | Uint8Array;
type HashAlgorithm = "sha1" | "sha256";
type CryptoHasher = {
	update(value: HashInput): CryptoHasher;
	digest(): Uint8Array;
	digest(format: "base64url" | "hex"): string;
};
type BunCrypto = {
	CryptoHasher: new (algorithm: HashAlgorithm, secret?: HashInput) => CryptoHasher;
};

const bun = (globalThis as typeof globalThis & { Bun: BunCrypto }).Bun;

const createHasher = (algorithm: HashAlgorithm, secret?: HashInput) =>
	secret === undefined ? new bun.CryptoHasher(algorithm) : new bun.CryptoHasher(algorithm, secret);

export const createSha256Hasher = () => createHasher("sha256");

export const sha256Hex = (value: HashInput) => createSha256Hasher().update(value).digest("hex");

export const sha256Base64Url = (value: HashInput) =>
	createSha256Hasher().update(value).digest("base64url");

export const hmacDigest = (algorithm: HashAlgorithm, secret: HashInput, value: HashInput) =>
	Uint8Array.from(createHasher(algorithm, secret).update(value).digest());

export const hmacSha256Base64Url = (secret: HashInput, value: HashInput) =>
	createHasher("sha256", secret).update(value).digest("base64url");
