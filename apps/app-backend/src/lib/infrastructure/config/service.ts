import type { Config } from "effect";
import { ConfigError, Effect, Option, Redacted } from "effect";

import type { GroupMeta } from "./builder";
import {
	animeAndMangaConfigDefinition,
	booksConfigDefinition,
	comicBooksConfigDefinition,
	moviesAndShowsConfigDefinition,
	musicConfigDefinition,
	podcastsConfigDefinition,
	systemConfigDefinition,
	videoGamesConfigDefinition,
} from "./definition";
import { SystemConfigSource, type SystemConfigValue } from "./system";

const isNonEmpty = (opt: Option.Option<string>): opt is Option.Some<string> =>
	Option.isSome(opt) && opt.value.length > 0;

const isNonEmptyRedacted = (
	opt: Option.Option<Redacted.Redacted>,
): opt is Option.Some<Redacted.Redacted> =>
	Option.isSome(opt) && Redacted.value(opt.value).length > 0;

export const isOidcEnabled = (config: SystemConfigValue): boolean => {
	const { clientId, clientSecret, issuerUrl } = config.server.oidc;
	return isNonEmpty(clientId) && isNonEmpty(issuerUrl) && isNonEmptyRedacted(clientSecret);
};

export const getSmtpCredentials = (
	config: SystemConfigValue,
): Option.Option<{ server: string; user: Redacted.Redacted; password: Redacted.Redacted }> => {
	const { password, server, user } = config.server.smtp;
	if (!isNonEmpty(server) || !isNonEmptyRedacted(user) || !isNonEmptyRedacted(password)) {
		return Option.none();
	}
	return Option.some({ server: server.value, user: user.value, password: password.value });
};

export const isSmtpEnabled = (config: SystemConfigValue): boolean =>
	Option.isSome(getSmtpCredentials(config));

export const validateSystemConfig = (
	config: SystemConfigValue,
): Effect.Effect<SystemConfigValue, ConfigError.ConfigError> =>
	Effect.gen(function* () {
		const { clientId, clientSecret, issuerUrl } = config.server.oidc;
		const oidcSetCount = [
			isNonEmpty(clientId),
			isNonEmpty(issuerUrl),
			isNonEmptyRedacted(clientSecret),
		].filter(Boolean).length;

		if (oidcSetCount > 0 && oidcSetCount < 3) {
			return yield* Effect.fail(
				ConfigError.InvalidData(
					[],
					"Partial OIDC configuration detected. Set all three of SERVER_OIDC_CLIENT_ID, SERVER_OIDC_ISSUER_URL, and SERVER_OIDC_CLIENT_SECRET, or none of them.",
				),
			);
		}

		const oidcEnabled = oidcSetCount === 3;
		if (config.users.disableLocalAuth && !oidcEnabled) {
			return yield* Effect.fail(
				ConfigError.InvalidData(
					[],
					"USERS_DISABLE_LOCAL_AUTH is set but OIDC credentials are incomplete. Set SERVER_OIDC_CLIENT_ID, SERVER_OIDC_ISSUER_URL, and SERVER_OIDC_CLIENT_SECRET.",
				),
			);
		}

		const { password, server, user } = config.server.smtp;
		const smtpSetCount = [
			isNonEmpty(server),
			isNonEmptyRedacted(user),
			isNonEmptyRedacted(password),
		].filter(Boolean).length;
		if (smtpSetCount > 0 && smtpSetCount < 3) {
			return yield* Effect.fail(
				ConfigError.InvalidData(
					[],
					"Partial SMTP configuration detected. Set all three of SERVER_SMTP_SERVER, SERVER_SMTP_USER, and SERVER_SMTP_PASSWORD, or none of them.",
				),
			);
		}

		// The cluster SQL runner permanently reserves one workflow-pool connection,
		// even when advisory shard locks are disabled.
		const usableWorkflowConnections = config.database.workflowPoolMax - 1;
		if (config.sandbox.workerConcurrency > usableWorkflowConnections) {
			return yield* Effect.fail(
				ConfigError.InvalidData(
					[],
					`SANDBOX_WORKER_CONCURRENCY (${config.sandbox.workerConcurrency}) exceeds the usable workflow-pool connections (${usableWorkflowConnections}). The cluster SQL runner permanently reserves one connection of DATABASE_WORKFLOW_POOL_MAX (${config.database.workflowPoolMax}), so usable connections = DATABASE_WORKFLOW_POOL_MAX - 1; a higher sandbox worker concurrency starves the workflow engine. Raise DATABASE_WORKFLOW_POOL_MAX or lower SANDBOX_WORKER_CONCURRENCY.`,
				),
			);
		}

		// The +2 accounts for the two always-on DurableQueue workers
		// (EnsureLibraryMembershipQueue and DefaultSavedViewQueue, concurrency 1 each).
		if (config.sandbox.workerConcurrency + 2 >= usableWorkflowConnections) {
			yield* Effect.logWarning("workflow pool connection headroom exhausted").pipe(
				Effect.annotateLogs({
					usableWorkflowConnections,
					sandboxWorkerConcurrency: config.sandbox.workerConcurrency,
				}),
			);
		}

		return config;
	});

export type MoviesAndShowsConfigValue = Config.Config.Success<
	typeof moviesAndShowsConfigDefinition.config
>;
export type AnimeAndMangaConfigValue = Config.Config.Success<
	typeof animeAndMangaConfigDefinition.config
>;
export type ComicBooksConfigValue = Config.Config.Success<typeof comicBooksConfigDefinition.config>;
export type BooksConfigValue = Config.Config.Success<typeof booksConfigDefinition.config>;
export type MusicConfigValue = Config.Config.Success<typeof musicConfigDefinition.config>;
export type PodcastsConfigValue = Config.Config.Success<typeof podcastsConfigDefinition.config>;
export type VideoGamesConfigValue = Config.Config.Success<typeof videoGamesConfigDefinition.config>;

export const appConfigMeta = {
	kind: "group",
	description: "Application configuration",
	children: {
		...systemConfigDefinition.meta.children,
		moviesAndShows: moviesAndShowsConfigDefinition.meta,
		animeAndManga: animeAndMangaConfigDefinition.meta,
		comicBooks: comicBooksConfigDefinition.meta,
		books: booksConfigDefinition.meta,
		music: musicConfigDefinition.meta,
		podcasts: podcastsConfigDefinition.meta,
		videoGames: videoGamesConfigDefinition.meta,
	},
} satisfies GroupMeta;

export class AppConfig extends Effect.Service<AppConfig>()("AppConfig", {
	effect: Effect.gen(function* () {
		const system = yield* SystemConfigSource;
		const moviesAndShows = yield* moviesAndShowsConfigDefinition.config;
		const animeAndManga = yield* animeAndMangaConfigDefinition.config;
		const comicBooks = yield* comicBooksConfigDefinition.config;
		const books = yield* booksConfigDefinition.config;
		const music = yield* musicConfigDefinition.config;
		const podcasts = yield* podcastsConfigDefinition.config;
		const videoGames = yield* videoGamesConfigDefinition.config;
		const validated = yield* validateSystemConfig(system);
		return {
			...validated,
			moviesAndShows,
			animeAndManga,
			comicBooks,
			books,
			music,
			podcasts,
			videoGames,
		};
	}),
}) {}

export type AppConfigValue = SystemConfigValue & {
	moviesAndShows: MoviesAndShowsConfigValue;
	animeAndManga: AnimeAndMangaConfigValue;
	comicBooks: ComicBooksConfigValue;
	books: BooksConfigValue;
	music: MusicConfigValue;
	podcasts: PodcastsConfigValue;
	videoGames: VideoGamesConfigValue;
};
