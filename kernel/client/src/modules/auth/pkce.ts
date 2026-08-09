import { sha256 } from "@noble/hashes/sha2.js";

const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

export const encodeBase64Url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");

export const generateOAuthRandomValue = () => encodeBase64Url(randomBytes(32));

// `crypto.subtle` is undefined on the plain-HTTP origins self-hosters run, even
// though the DOM types declare it as always present.
const resolveSubtleCrypto = (): SubtleCrypto | undefined => crypto.subtle;

const digestSha256 = async (input: Uint8Array<ArrayBuffer>) => {
	const subtle = resolveSubtleCrypto();
	return subtle ? new Uint8Array(await subtle.digest("SHA-256", input)) : sha256(input);
};

export const deriveCodeChallenge = async (codeVerifier: string) =>
	encodeBase64Url(await digestSha256(new TextEncoder().encode(codeVerifier)));
