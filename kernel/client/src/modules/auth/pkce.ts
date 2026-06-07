const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

export const encodeBase64Url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");

export const generateOAuthRandomValue = () => encodeBase64Url(randomBytes(32));

export const deriveCodeChallenge = async (codeVerifier: string) =>
	encodeBase64Url(
		new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier))),
	);
