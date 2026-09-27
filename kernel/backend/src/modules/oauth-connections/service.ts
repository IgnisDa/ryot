import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	type CreateOAuthConnectionBody,
	OAUTH_CONNECTION_RETURN_PATH,
	type OAuthConnectionCallbackQuery,
	type OAuthConnectionClient,
	OAuthConnectionNotFoundError,
	OAuthConnectionRequestError,
} from "@ryot-app/contract/modules/oauth-connections/schemas";
import { PluginOAuthProvider } from "@ryot-app/contract/modules/plugins/manifest";
import {
	type ImportRunId,
	type IntegrationId,
	OAuthConnectionId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { CryptoHasher } from "bun";
import { Context, Data, DateTime, Duration, Effect, Layer, Option, Result, Schema } from "effect";

import type { SubkeyCiphertext } from "#lib/infrastructure/config/plugin-config-encryption";
import { AppConfig } from "#lib/infrastructure/config/service";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { ProKeyService } from "#lib/infrastructure/pro-key";
import { resolveContextConfig } from "#lib/infrastructure/sandbox-runtime/app-config";
import { PluginConfigEncryptionKey } from "#modules/plugins/config-encryption-key";
import { PluginConfigRevisions } from "#modules/plugins/config-revisions";
import {
	IntegrationProviderCatalog,
	type RegisteredIntegrationProvider,
} from "#modules/plugins/integration-provider-catalog";

import { OAuthConnectionsRepository } from "./repository";
import { OAuthTokenClient } from "./token-client";

const TOKEN_CIPHER_INFO = "ryot/oauth-connection/token";
const PENDING_CONNECTION_TTL = Duration.minutes(10);
const UNBOUND_CONNECTION_TTL = Duration.hours(1);
const TOKEN_REQUEST_LEASE = Duration.seconds(30);
const ACCESS_TOKEN_REFRESH_WINDOW = Duration.seconds(60);
const REFRESH_POLL_INTERVAL = Duration.millis(250);
const REFRESH_POLL_ATTEMPTS = 40;

const MAX_OPEN_OAUTH_CONNECTIONS_PER_USER = 10;

export const OAUTH_ACCESS_TOKEN_MESSAGES = {
	failed: "OAuth token refresh failed",
	busy: "OAuth token refresh is in progress; retry later",
	expired: "OAuth connection expired; reconnect the integration",
	unavailable: "OAuth connection is not available to this integration run",
} as const;

class OAuthAccessTokenError extends Data.TaggedError("OAuthAccessTokenError")<{
	readonly message: (typeof OAUTH_ACCESS_TOKEN_MESSAGES)[keyof typeof OAUTH_ACCESS_TOKEN_MESSAGES];
}> {}

export class OAuthConnectionBindingError extends Data.TaggedError("OAuthConnectionBindingError")<{
	readonly field: string;
}> {}

type CipherColumn = "accessToken" | "code" | "codeVerifier" | "refreshToken";
type OAuthConfigAuthority = Pick<RegisteredIntegrationProvider, "configContext" | "installationId">;

type CipherOwner = { readonly id: string; readonly userId: string };

const randomToken = () =>
	Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

const sha256 = (value: string) => Buffer.from(new CryptoHasher("sha256").update(value).digest());

const hashSecret = (value: string) => sha256(value).toString("hex");

const plus = (date: Date, duration: Duration.Duration) =>
	new Date(date.getTime() + Duration.toMillis(duration));

const decodeOAuthProviders = Schema.decodeUnknownOption(Schema.Array(PluginOAuthProvider));

const oauthConnectionFieldProvider = (schema: AppSchema, field: string) => {
	const property = Object.hasOwn(schema.fields, field) ? schema.fields[field] : undefined;
	return property?.type === "string" && property.format?.kind === "oauth-connection"
		? property.format.provider
		: null;
};

const accessTokenError = (message: OAuthAccessTokenError["message"]) =>
	new OAuthAccessTokenError({ message });

const cipherAttribution = (owner: CipherOwner, column: CipherColumn) => ({
	column,
	userId: owner.userId,
	connectionId: owner.id,
	kind: "oauth-connection",
});

const oauthConnectionFields = (schema: AppSchema) =>
	Object.keys(schema.fields).filter(
		(field) => oauthConnectionFieldProvider(schema, field) !== null,
	);

export class OAuthConnectionsService extends Context.Service<OAuthConnectionsService>()(
	"OAuthConnectionsService",
	{
		make: Effect.gen(function* () {
			const database = yield* DatabaseSession;
			const proKey = yield* ProKeyService;
			const repository = yield* OAuthConnectionsRepository;
			const catalog = yield* IntegrationProviderCatalog;
			const configs = yield* PluginConfigRevisions;
			const encryptionKey = yield* PluginConfigEncryptionKey;
			const tokenClient = yield* OAuthTokenClient;
			const { frontendUrl } = yield* AppConfig;

			const now = DateTime.nowAsDate;
			const requireNoTransaction = Effect.flatMap(database.isTransactionActive, (active) =>
				active ? Effect.die("OAuth token requests cannot run inside a transaction") : Effect.void,
			);
			const notFound = new OAuthConnectionNotFoundError({
				reason: { code: "oauth-connection-not-found" },
			});
			const seal = (owner: CipherOwner, column: CipherColumn, plaintext: string) =>
				Effect.flatMap(encryptionKey.load, (encryption) =>
					encryption.encryptWithSubkey(
						TOKEN_CIPHER_INFO,
						plaintext,
						cipherAttribution(owner, column),
					),
				);
			const unseal = (owner: CipherOwner, column: CipherColumn, ciphertext: SubkeyCiphertext) =>
				Effect.flatMap(encryptionKey.load, (encryption) =>
					encryption.decryptWithSubkey(
						TOKEN_CIPHER_INFO,
						ciphertext,
						cipherAttribution(owner, column),
					),
				);

			const redirectUri = (pluginSlug: string, oauthProviderSlug: string) =>
				new URL(
					`/api/oauth-connections/providers/${encodeURIComponent(pluginSlug)}/${encodeURIComponent(oauthProviderSlug)}/callback`,
					frontendUrl,
				).toString();

			const returnLocation = (
				client: OAuthConnectionClient,
				parameters: Readonly<Record<string, string>>,
			) => {
				const fragment = new URLSearchParams(parameters).toString();
				return client.kind === "web"
					? `${new URL(OAUTH_CONNECTION_RETURN_PATH, frontendUrl).toString()}#${fragment}`
					: `${client.applicationId}:${OAUTH_CONNECTION_RETURN_PATH}#${fragment}`;
			};

			const findOAuthProvider = Effect.fn("OAuthConnectionsService.findOAuthProvider")(function* (
				registered: OAuthConfigAuthority,
				oauthProviderSlug: string,
			) {
				const declared = yield* repository.findOAuthProviders(
					registered.configContext.pluginRevisionId,
				);
				return (
					Option.getOrUndefined(decodeOAuthProviders(declared ?? []))?.find(
						({ slug }) => slug === oauthProviderSlug,
					) ?? null
				);
			});

			const resolveCredentials = Effect.fn("OAuthConnectionsService.resolveCredentials")(
				function* (registered: OAuthConfigAuthority, provider: PluginOAuthProvider) {
					const { configContext } = registered;
					const config =
						configContext.pluginConfigRevisionId === null
							? {}
							: yield* configs.read({
									ownerUserId: configContext.ownerUserId,
									id: configContext.pluginConfigRevisionId,
									pluginRevisionId: configContext.pluginRevisionId,
									pluginInstallationId:
										configContext.ownerUserId === null ? null : registered.installationId,
								});
					const parsed = yield* resolveContextConfig(
						{ config, kind: "installation", configSchema: configContext.configSchema },
						[provider.clientIdConfigKey, provider.clientSecretConfigKey],
					);
					const clientId = parsed[provider.clientIdConfigKey];
					const clientSecret = parsed[provider.clientSecretConfigKey];
					return typeof clientId === "string" &&
						clientId.length > 0 &&
						typeof clientSecret === "string" &&
						clientSecret.length > 0
						? { clientId, clientSecret }
						: null;
				},
				(effect) => effect.pipe(Effect.orElseSucceed(() => null)),
			);

			const create = Effect.fn("OAuthConnectionsService.create")(function* (
				user: CurrentUserValue,
				body: CreateOAuthConnectionBody,
			) {
				const providerNotFound = new OAuthConnectionRequestError({
					reason: { code: "provider-not-found", provider: body.integrationProvider },
				});
				let registered: RegisteredIntegrationProvider | null;
				if (body.integrationId === undefined) {
					registered = yield* catalog.findForUser(user.id, body.integrationProvider);
				} else {
					const integration = yield* repository.findIntegrationForUser(body.integrationId, user.id);
					if (!integration) {
						return yield* new OAuthConnectionRequestError({
							reason: { code: "integration-not-found", integrationId: body.integrationId },
						});
					}
					if (
						integration.provider !== body.integrationProvider ||
						integration.pluginInstallationId === null
					) {
						return yield* providerNotFound;
					}
					registered = yield* catalog.findOwnedForUser(
						user.id,
						integration.provider,
						integration.pluginInstallationId,
					);
				}
				if (!registered) {
					return yield* providerNotFound;
				}
				if (registered.requiresProKey && !(yield* proKey.isValidated)) {
					return yield* new OAuthConnectionRequestError({ reason: { code: "pro-key-required" } });
				}
				const oauthProviderSlug = oauthConnectionFieldProvider(
					registered.settingsSchema,
					body.field,
				);
				const provider =
					oauthProviderSlug === null
						? null
						: yield* findOAuthProvider(registered, oauthProviderSlug);
				if (!provider) {
					return yield* new OAuthConnectionRequestError({
						reason: { field: body.field, code: "oauth-field-not-found" },
					});
				}
				const credentials = yield* resolveCredentials(registered, provider);
				if (!credentials) {
					return yield* new OAuthConnectionRequestError({
						reason: { code: "oauth-client-not-configured" },
					});
				}
				const createdAt = yield* now;
				if (
					(yield* repository.countOpenForUser(user.id, createdAt)) >=
					MAX_OPEN_OAUTH_CONNECTIONS_PER_USER
				) {
					return yield* new OAuthConnectionRequestError({
						reason: { code: "too-many-pending-oauth-connections" },
					});
				}
				const id = OAuthConnectionId.make(randomToken());
				const state = randomToken();
				const verifier = provider.pkce === "S256" ? randomToken() : null;
				yield* repository.insertPending({
					id,
					userId: user.id,
					field: body.field,
					client: body.client,
					stateHash: hashSecret(state),
					oauthProviderSlug: provider.slug,
					pluginSlug: registered.pluginSlug,
					integrationProviderSlug: registered.slug,
					pluginInstallationId: registered.installationId,
					tokenUrlOrigin: new URL(provider.tokenUrl).origin,
					expiresAt: plus(createdAt, PENDING_CONNECTION_TTL),
					...(verifier === null
						? {}
						: {
								codeVerifier: yield* seal({ id, userId: user.id }, "codeVerifier", verifier).pipe(
									Effect.orDie,
								),
							}),
				});
				const authorizeUrl = new URL(provider.authorizeUrl);
				const parameters: Record<string, string> = {
					state,
					response_type: "code",
					client_id: credentials.clientId,
					redirect_uri: redirectUri(registered.pluginSlug, provider.slug),
				};
				if (verifier !== null) {
					parameters["code_challenge_method"] = "S256";
					parameters["code_challenge"] = sha256(verifier).toString("base64url");
				}
				if (provider.scopes.length > 0) {
					parameters["scope"] = provider.scopes.join(" ");
				}
				for (const [key, value] of Object.entries(parameters)) {
					authorizeUrl.searchParams.set(key, value);
				}
				return { connectionId: id, authorizeUrl: authorizeUrl.toString() };
			});

			const callback = Effect.fn("OAuthConnectionsService.callback")(
				function* (
					path: { readonly pluginSlug: string; readonly oauthProviderSlug: string },
					query: OAuthConnectionCallbackQuery,
				) {
					const receivedAt = yield* now;
					const stateHash = query.state === undefined ? null : hashSecret(query.state);
					const pending =
						stateHash === null
							? null
							: yield* repository.findPendingByStateHash(stateHash, receivedAt);
					if (!pending || stateHash === null) {
						return returnLocation({ kind: "web" }, { status: "failed" });
					}
					const id = OAuthConnectionId.make(pending.id);
					const failed = returnLocation(pending.client, { connection: id, status: "failed" });
					const fail = repository.markFailed({ id, from: "pending" }).pipe(Effect.as(failed));
					if (
						pending.pluginSlug !== path.pluginSlug ||
						pending.oauthProviderSlug !== path.oauthProviderSlug ||
						query.error !== undefined ||
						query.code === undefined ||
						query.code.length === 0
					) {
						return yield* fail;
					}
					const registered = yield* catalog.findOwnedForUser(
						UserId.make(pending.userId),
						pending.integrationProviderSlug,
						pending.pluginInstallationId,
					);
					const provider =
						registered?.pluginSlug === pending.pluginSlug
							? yield* findOAuthProvider(registered, pending.oauthProviderSlug)
							: null;
					if (!provider || (provider.issuer !== undefined && query.iss !== provider.issuer)) {
						return yield* fail;
					}
					const secret = randomToken();
					const authorized = yield* repository.authorize({
						id,
						stateHash,
						now: receivedAt,
						completionSecretHash: hashSecret(secret),
						code: yield* seal(pending, "code", query.code),
					});
					return authorized ? returnLocation(pending.client, { secret, connection: id }) : failed;
				},
				(effect) =>
					effect.pipe(
						Effect.catchCause((cause) =>
							Effect.logError("OAuth connection callback failed", cause).pipe(
								Effect.as(returnLocation({ kind: "web" }, { status: "failed" })),
							),
						),
					),
			);

			const complete = Effect.fn("OAuthConnectionsService.complete")(function* (
				user: CurrentUserValue,
				id: OAuthConnectionId,
				secret: string,
			) {
				yield* requireNoTransaction;
				const startedAt = yield* now;
				const claimed = yield* repository.claimCompletion({
					id,
					now: startedAt,
					userId: user.id,
					completionSecretHash: hashSecret(secret),
					leaseUntil: plus(startedAt, TOKEN_REQUEST_LEASE),
				});
				if (!claimed) {
					return yield* notFound;
				}
				const exchangeFailed = repository
					.markFailed({ id, from: "authorized" })
					.pipe(
						Effect.andThen(
							Effect.fail(
								new OAuthConnectionRequestError({
									reason: { code: "oauth-token-exchange-failed" },
								}),
							),
						),
					);
				const registered = yield* catalog.findOwnedForUser(
					user.id,
					claimed.integrationProviderSlug,
					claimed.pluginInstallationId,
				);
				const provider =
					registered?.pluginSlug === claimed.pluginSlug
						? yield* findOAuthProvider(registered, claimed.oauthProviderSlug)
						: null;
				if (
					!registered ||
					!provider ||
					claimed.code === null ||
					new URL(provider.tokenUrl).origin !== claimed.tokenUrlOrigin
				) {
					return yield* exchangeFailed;
				}
				const credentials = yield* resolveCredentials(registered, provider);
				if (!credentials) {
					return yield* exchangeFailed;
				}
				const code = yield* unseal(claimed, "code", claimed.code).pipe(Effect.orDie);
				let codeVerifier: string | undefined;
				if (provider.pkce === "S256") {
					if (claimed.codeVerifier === null) {
						return yield* exchangeFailed;
					}
					codeVerifier = yield* unseal(claimed, "codeVerifier", claimed.codeVerifier).pipe(
						Effect.orDie,
					);
				}
				const token = yield* tokenClient
					.requestToken(provider, credentials, {
						code,
						...(codeVerifier === undefined ? {} : { codeVerifier }),
						grantType: "authorization_code",
						redirectUri: redirectUri(claimed.pluginSlug, claimed.oauthProviderSlug),
					})
					.pipe(Effect.catchTag("OAuthTokenEndpointError", () => exchangeFailed));
				const connectedAt = yield* now;
				const stored = yield* repository.markConnected({
					id,
					expiresAt: plus(connectedAt, UNBOUND_CONNECTION_TTL),
					accessTokenExpiresAt: plus(connectedAt, Duration.seconds(token.expiresInSeconds)),
					accessToken: yield* seal(claimed, "accessToken", token.accessToken).pipe(Effect.orDie),
					refreshToken:
						token.refreshToken === null
							? null
							: yield* seal(claimed, "refreshToken", token.refreshToken).pipe(Effect.orDie),
				});
				if (!stored) {
					return yield* exchangeFailed;
				}
				return { id };
			});

			const status = Effect.fn("OAuthConnectionsService.status")(function* (
				user: CurrentUserValue,
				id: OAuthConnectionId,
			) {
				const connection = yield* repository.findForUser(id, user.id);
				if (!connection) {
					return yield* notFound;
				}
				const readAt = yield* now;
				const lapsed =
					connection.status !== "failed" &&
					connection.expiresAt !== null &&
					connection.expiresAt <= readAt;
				return { status: lapsed ? ("expired" as const) : connection.status };
			});

			const bindIntegrationSettings = Effect.fn("OAuthConnectionsService.bindIntegrationSettings")(
				function* (input: {
					readonly userId: UserId;
					readonly settingsSchema: AppSchema;
					readonly integrationId: IntegrationId;
					readonly integrationProvider: string;
					readonly pluginInstallationId: string;
					readonly settings: Readonly<Record<string, unknown>>;
				}) {
					yield* database.requireTransaction.pipe(Effect.orDie);
					const boundAt = yield* now;
					const bindField = (field: string) => {
						const value = input.settings[field];
						if (value === undefined) {
							return Effect.void;
						}
						const unbound = new OAuthConnectionBindingError({ field });
						if (typeof value !== "string") {
							return Effect.fail(unbound);
						}
						return repository
							.bindToIntegration({
								field,
								now: boundAt,
								userId: input.userId,
								id: OAuthConnectionId.make(value),
								integrationId: input.integrationId,
								pluginInstallationId: input.pluginInstallationId,
								integrationProviderSlug: input.integrationProvider,
							})
							.pipe(Effect.flatMap((bound) => (bound ? Effect.void : Effect.fail(unbound))));
					};
					yield* Effect.forEach(oauthConnectionFields(input.settingsSchema), bindField, {
						discard: true,
					});
				},
			);

			type ConnectionRow = NonNullable<Effect.Success<ReturnType<typeof repository.findById>>>;
			type IntegrationRunInput = {
				readonly field: string;
				readonly connectionId: OAuthConnectionId;
				readonly userId: UserId;
				readonly pluginId: string;
				readonly integrationId: IntegrationId;
				readonly integrationRunId: ImportRunId;
			};
			const unavailable = accessTokenError(OAUTH_ACCESS_TOKEN_MESSAGES.unavailable);

			const findIntegrationRunBinding = Effect.fn(
				"OAuthConnectionsService.findIntegrationRunBinding",
			)(function* (input: IntegrationRunInput) {
				yield* requireNoTransaction;
				const bound = yield* repository.findForIntegrationRun(input);
				if (
					!bound?.pins ||
					bound.id !== input.connectionId ||
					bound.pins.pluginRevisionId === null ||
					bound.pluginId !== input.pluginId ||
					(bound.pluginOwnerId !== null && bound.pluginOwnerId !== input.userId)
				) {
					return yield* unavailable;
				}
				const provider = bound.manifest.integrationProviders.find(
					({ slug }) => slug === bound.integrationProviderSlug,
				);
				if (
					!provider ||
					bound.installationPluginSlug !== bound.pluginSlug ||
					oauthConnectionFieldProvider(provider.settingsSchema, input.field) !==
						bound.oauthProviderSlug
				) {
					return yield* unavailable;
				}
				const registered: OAuthConfigAuthority = {
					installationId: bound.pluginInstallationId,
					configContext: {
						kind: "revision",
						configSchema: bound.manifest.configSchema,
						pluginRevisionId: bound.pins.pluginRevisionId,
						pluginConfigRevisionId: bound.pins.pluginConfigRevisionId,
						ownerUserId: bound.pluginOwnerId === null ? null : UserId.make(bound.pluginOwnerId),
					},
				};
				return { bound, registered };
			});

			const refreshAccessToken = Effect.fn("OAuthConnectionsService.refreshAccessToken")(function* (
				connection: ConnectionRow,
				registered: OAuthConfigAuthority,
				integrationId: IntegrationId,
			) {
				const lease = {
					tokenVersion: connection.tokenVersion,
					id: OAuthConnectionId.make(connection.id),
				};
				const release = (message: OAuthAccessTokenError["message"]) =>
					repository
						.releaseRefreshLease(lease)
						.pipe(Effect.andThen(Effect.fail(accessTokenError(message))));
				const expire = repository
					.markExpired({ ...lease, integrationId })
					.pipe(Effect.andThen(Effect.fail(accessTokenError(OAUTH_ACCESS_TOKEN_MESSAGES.expired))));
				if (connection.refreshToken === null) {
					return yield* expire;
				}
				const provider = yield* findOAuthProvider(registered, connection.oauthProviderSlug);
				if (!provider || new URL(provider.tokenUrl).origin !== connection.tokenUrlOrigin) {
					return yield* release(OAUTH_ACCESS_TOKEN_MESSAGES.failed);
				}
				const credentials = yield* resolveCredentials(registered, provider);
				if (!credentials) {
					return yield* release(OAUTH_ACCESS_TOKEN_MESSAGES.failed);
				}
				const refreshToken = yield* unseal(connection, "refreshToken", connection.refreshToken);
				const response = yield* tokenClient
					.requestToken(provider, credentials, { refreshToken, grantType: "refresh_token" })
					.pipe(Effect.result);
				if (Result.isFailure(response)) {
					if (response.failure.reason !== "invalid-grant") {
						return yield* release(OAUTH_ACCESS_TOKEN_MESSAGES.failed);
					}
					const current = yield* repository.findById(lease.id);
					if (current && current.tokenVersion !== connection.tokenVersion) {
						return null;
					}
					return yield* expire;
				}
				const token = response.success;
				const refreshedAt = yield* now;
				const accessTokenExpiresAt = plus(refreshedAt, Duration.seconds(token.expiresInSeconds));
				const stored = yield* repository.storeRefreshedTokens({
					...lease,
					accessTokenExpiresAt,
					accessToken: yield* seal(connection, "accessToken", token.accessToken),
					refreshToken:
						token.refreshToken === null
							? connection.refreshToken
							: yield* seal(connection, "refreshToken", token.refreshToken),
				});
				return stored
					? { accessToken: token.accessToken, expiresAt: accessTokenExpiresAt.toISOString() }
					: null;
			});

			const accessTokenForIntegrationRun = Effect.fn(
				"OAuthConnectionsService.accessTokenForIntegrationRun",
			)(
				function* (input: IntegrationRunInput) {
					const { bound, registered } = yield* findIntegrationRunBinding(input);
					let connection: ConnectionRow = bound;
					for (let attempt = 0; attempt <= REFRESH_POLL_ATTEMPTS; attempt += 1) {
						if (attempt > 0) {
							yield* Effect.sleep(REFRESH_POLL_INTERVAL);
							const current = yield* repository.findById(OAuthConnectionId.make(connection.id));
							if (!current) {
								return yield* unavailable;
							}
							connection = current;
						}
						if (connection.status === "expired") {
							return yield* accessTokenError(OAUTH_ACCESS_TOKEN_MESSAGES.expired);
						}
						if (
							connection.status !== "connected" ||
							connection.integrationId !== input.integrationId
						) {
							return yield* unavailable;
						}
						const checkedAt = yield* now;
						if (
							connection.accessToken !== null &&
							connection.accessTokenExpiresAt !== null &&
							connection.accessTokenExpiresAt.getTime() - checkedAt.getTime() >
								Duration.toMillis(ACCESS_TOKEN_REFRESH_WINDOW)
						) {
							return {
								expiresAt: connection.accessTokenExpiresAt.toISOString(),
								accessToken: yield* unseal(connection, "accessToken", connection.accessToken),
							};
						}
						const leased = yield* repository.acquireRefreshLease({
							now: checkedAt,
							tokenVersion: connection.tokenVersion,
							id: OAuthConnectionId.make(connection.id),
							leaseUntil: plus(checkedAt, TOKEN_REQUEST_LEASE),
						});
						if (leased) {
							const refreshed = yield* refreshAccessToken(
								connection,
								registered,
								input.integrationId,
							);
							if (refreshed) {
								return refreshed;
							}
						}
					}
					return yield* accessTokenError(OAUTH_ACCESS_TOKEN_MESSAGES.busy);
				},
				(effect) =>
					effect.pipe(
						Effect.catchIf(
							(error) => !(error instanceof OAuthAccessTokenError),
							(error) =>
								Effect.logError("OAuth access token resolution failed", error).pipe(
									Effect.andThen(Effect.fail(accessTokenError(OAUTH_ACCESS_TOKEN_MESSAGES.failed))),
								),
						),
					),
			);

			const invalidateAccessTokenForIntegrationRun = Effect.fn(
				"OAuthConnectionsService.invalidateAccessTokenForIntegrationRun",
			)(
				function* (input: IntegrationRunInput & { readonly accessToken: string }) {
					const { bound } = yield* findIntegrationRunBinding(input);
					if (
						bound.status !== "connected" ||
						bound.integrationId !== input.integrationId ||
						bound.accessToken === null
					) {
						return null;
					}
					const currentAccessToken = yield* unseal(bound, "accessToken", bound.accessToken);
					if (currentAccessToken !== input.accessToken) {
						return null;
					}
					yield* repository.markExpired({
						tokenVersion: bound.tokenVersion,
						integrationId: input.integrationId,
						id: OAuthConnectionId.make(bound.id),
					});
					return null;
				},
				(effect) =>
					effect.pipe(
						Effect.catchIf(
							(error) => !(error instanceof OAuthAccessTokenError),
							() =>
								Effect.logError("OAuth access token invalidation failed").pipe(
									Effect.andThen(Effect.fail(accessTokenError(OAUTH_ACCESS_TOKEN_MESSAGES.failed))),
								),
						),
					),
			);

			const deleteExpired = Effect.fn("OAuthConnectionsService.deleteExpired")(function* (
				limit: number,
			) {
				return yield* repository.deleteExpired(yield* now, limit);
			});

			return {
				create,
				status,
				callback,
				complete,
				deleteExpired,
				bindIntegrationSettings,
				accessTokenForIntegrationRun,
				invalidateAccessTokenForIntegrationRun,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
