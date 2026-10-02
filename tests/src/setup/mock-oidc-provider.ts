import {
	createHash,
	generateKeyPairSync,
	randomBytes,
	sign,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const CLIENT_ID = "test-client";
const CLIENT_SECRET = "test-secret";

type FailureMode =
	| "wrong_nonce"
	| "wrong_issuer"
	| "wrong_audience"
	| "expired"
	| "bad_signature"
	| "missing_id_token";

interface AuthorizationCode {
	challenge: string;
	challengeMethod: string;
	redirectUri: string;
	nonce: string;
	subject: string;
	email: string;
	failureMode?: FailureMode;
}

export interface StartedMockOidcProvider {
	issuerUrl: string;
	clientId: string;
	clientSecret: string;
	close: () => Promise<void>;
}

const encodeBase64Url = (value: string | Buffer) =>
	Buffer.from(value).toString("base64url");

const sendJson = (
	response: ServerResponse,
	status: number,
	body: Record<string, unknown>,
) => {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
};

async function readBody(request: IncomingMessage) {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf8");
}

export async function startMockOidcProvider(): Promise<StartedMockOidcProvider> {
	const signingKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const invalidSigningKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const keyId = randomBytes(12).toString("hex");
	const publicJwk = signingKey.publicKey.export({ format: "jwk" });
	const server = createServer((request, response) => {
		void handleRequest(request, response).catch(() => {
			sendJson(response, 500, { error: "server_error" });
		});
	});
	const codes = new Map<string, AuthorizationCode>();
	let issuerUrl = "";

	async function handleRequest(
		request: IncomingMessage,
		response: ServerResponse,
	) {
		const url = new URL(request.url ?? "/", issuerUrl);
		if (
			request.method === "GET" &&
			url.pathname === "/.well-known/openid-configuration"
		) {
			return sendJson(response, 200, {
				issuer: issuerUrl,
				authorization_endpoint: `${issuerUrl}/authorize`,
				token_endpoint: `${issuerUrl}/token`,
				jwks_uri: `${issuerUrl}/jwks`,
				response_types_supported: ["code"],
				subject_types_supported: ["public"],
				id_token_signing_alg_values_supported: ["RS256"],
				token_endpoint_auth_methods_supported: ["client_secret_basic"],
				grant_types_supported: ["authorization_code"],
				scopes_supported: ["openid", "email"],
			});
		}
		if (request.method === "GET" && url.pathname === "/jwks") {
			return sendJson(response, 200, {
				keys: [
					{
						...publicJwk,
						alg: "RS256",
						kid: keyId,
						key_ops: ["verify"],
						use: "sig",
					},
				],
			});
		}
		if (request.method === "GET" && url.pathname === "/authorize") {
			const redirectUri = url.searchParams.get("redirect_uri");
			const state = url.searchParams.get("state");
			const nonce = url.searchParams.get("nonce");
			const challenge = url.searchParams.get("code_challenge");
			const challengeMethod = url.searchParams.get("code_challenge_method");
			const failureMode = url.searchParams.get(
				"test_mode",
			) as FailureMode | null;
			const supportedFailureModes: FailureMode[] = [
				"wrong_nonce",
				"wrong_issuer",
				"wrong_audience",
				"expired",
				"bad_signature",
				"missing_id_token",
			];
			if (
				url.searchParams.get("client_id") !== CLIENT_ID ||
				url.searchParams.get("response_type") !== "code" ||
				!redirectUri ||
				!state ||
				!nonce ||
				!challenge ||
				challengeMethod !== "S256" ||
				(failureMode && !supportedFailureModes.includes(failureMode))
			) {
				return sendJson(response, 400, { error: "invalid_request" });
			}
			const code = randomBytes(32).toString("base64url");
			codes.set(code, {
				challenge,
				challengeMethod,
				redirectUri,
				nonce,
				subject: url.searchParams.get("test_subject") ?? `subject-${code}`,
				email: url.searchParams.get("test_email") ?? `user-${code}@example.com`,
				failureMode: failureMode ?? undefined,
			});
			const callback = new URL(redirectUri);
			callback.searchParams.set("code", code);
			callback.searchParams.set("state", state);
			response.writeHead(302, { location: callback.toString() });
			return response.end();
		}
		if (request.method === "POST" && url.pathname === "/token") {
			const authorization = request.headers.authorization ?? "";
			const basicCredentials =
				authorization.slice(0, 6).toLowerCase() === "basic "
					? authorization.slice(6).trim()
					: "";
			const credentials = basicCredentials
				? Buffer.from(basicCredentials, "base64").toString("utf8")
				: "";
			if (credentials !== `${CLIENT_ID}:${CLIENT_SECRET}`) {
				return sendJson(response, 401, { error: "invalid_client" });
			}
			const form = new URLSearchParams(await readBody(request));
			const code = form.get("code") ?? "";
			const authorizationCode = codes.get(code);
			codes.delete(code);
			if (
				form.get("grant_type") !== "authorization_code" ||
				!authorizationCode ||
				form.get("redirect_uri") !== authorizationCode.redirectUri
			) {
				return sendJson(response, 400, { error: "invalid_grant" });
			}
			const verifier = form.get("code_verifier") ?? "";
			const actualChallenge = createHash("sha256")
				.update(verifier)
				.digest("base64url");
			if (
				authorizationCode.challengeMethod !== "S256" ||
				actualChallenge !== authorizationCode.challenge
			) {
				return sendJson(response, 400, { error: "invalid_grant" });
			}
			const now = Math.floor(Date.now() / 1000);
			const mode = authorizationCode.failureMode;
			const tokenResponse: Record<string, unknown> = {
				access_token: randomBytes(24).toString("base64url"),
				expires_in: 3600,
				token_type: "Bearer",
			};
			if (mode !== "missing_id_token") {
				const claims = {
					aud: mode === "wrong_audience" ? "wrong-client" : CLIENT_ID,
					email: authorizationCode.email,
					email_verified: true,
					exp: mode === "expired" ? now - 3600 : now + 300,
					iat: now,
					iss: mode === "wrong_issuer" ? `${issuerUrl}/wrong` : issuerUrl,
					nonce:
						mode === "wrong_nonce"
							? randomBytes(18).toString("base64url")
							: authorizationCode.nonce,
					sub: authorizationCode.subject,
				};
				const signingKeyToUse =
					mode === "bad_signature"
						? invalidSigningKey.privateKey
						: signingKey.privateKey;
				const unsignedToken = [
					encodeBase64Url(
						JSON.stringify({ alg: "RS256", kid: keyId, typ: "JWT" }),
					),
					encodeBase64Url(JSON.stringify(claims)),
				].join(".");
				tokenResponse.id_token = `${unsignedToken}.${sign(
					"RSA-SHA256",
					Buffer.from(unsignedToken),
					signingKeyToUse,
				).toString("base64url")}`;
			}
			return sendJson(response, 200, tokenResponse);
		}
		return sendJson(response, 404, { error: "not_found" });
	}

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address() as AddressInfo;
	issuerUrl = `http://127.0.0.1:${address.port}`;
	let closePromise: Promise<void> | undefined;
	return {
		issuerUrl,
		clientId: CLIENT_ID,
		clientSecret: CLIENT_SECRET,
		close: () => {
			closePromise ??= new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
			return closePromise;
		},
	};
}
