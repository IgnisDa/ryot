use std::path::PathBuf;

use anyhow::Result;
use async_graphql::SimpleObject;
use common_utils::PROJECT_NAME;
use env_utils::{DEFAULT_MAL_CLIENT_ID, DEFAULT_TMDB_ACCESS_TOKEN, TRAKT_CLIENT_ID};
use schematic::{Config, ConfigEnum, ConfigLoader, HandlerError, derive_enum, validate::not_empty};
use serde::{Deserialize, Serialize};

// FIXME: Remove this in the next major version
fn default_tmdb_access_token(_ctx: &()) -> Result<Option<String>, HandlerError> {
    Ok(Some(DEFAULT_TMDB_ACCESS_TOKEN.to_string()))
}

// FIXME: Remove this in the next major version
fn default_mal_client_id(_ctx: &()) -> Result<Option<String>, HandlerError> {
    Ok(Some(DEFAULT_MAL_CLIENT_ID.to_string()))
}

// FIXME: Remove this in the next major version
fn default_trakt_client_id(_ctx: &()) -> Result<Option<String>, HandlerError> {
    Ok(Some(TRAKT_CLIENT_ID.to_string()))
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "ANIME_AND_MANGA_MAL_")]
pub struct MalConfig {
    /// The client ID to be used for the MAL API.
    #[setting(default = default_mal_client_id)]
    pub client_id: String,
}

derive_enum!(
    #[derive(ConfigEnum, Default)]
    pub enum AnilistPreferredLanguage {
        English,
        #[default]
        Native,
        Romaji,
    }
);

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "ANIME_AND_MANGA_ANILIST_")]
pub struct AnilistConfig {
    /// The preferred language for media from this source.
    pub preferred_language: AnilistPreferredLanguage,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(
    rename_all = "snake_case",
    env_prefix = "ANIME_AND_MANGA_MANGA_UPDATES_"
)]
pub struct MangaUpdatesConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case")]
pub struct AnimeAndMangaConfig {
    /// Settings related to Anilist.
    #[setting(nested)]
    pub anilist: AnilistConfig,
    /// Settings related to MAL.
    #[setting(nested)]
    pub mal: MalConfig,
    /// Settings related to MangaUpdates.
    #[setting(nested)]
    pub manga_updates: MangaUpdatesConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case")]
pub struct MusicConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "AUDIO_BOOKS_AUDIBLE_")]
pub struct AudibleConfig {
    /// Settings related to locale for making requests Audible.
    #[setting(default = "us")]
    pub locale: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case")]
pub struct AudioBookConfig {
    /// Settings related to Audible.
    #[setting(nested)]
    pub audible: AudibleConfig,
}

derive_enum!(
    #[derive(ConfigEnum, Default)]
    pub enum OpenlibraryCoverImageSize {
        #[serde(rename = "S")]
        Small,
        #[default]
        #[serde(rename = "M")]
        Medium,
        #[serde(rename = "L")]
        Large,
    }
);

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "BOOKS_OPENLIBRARY_")]
pub struct OpenlibraryConfig {
    /// The image sizes to fetch from Openlibrary.
    pub cover_image_size: OpenlibraryCoverImageSize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "BOOKS_GOOGLE_BOOKS_")]
pub struct GoogleBooksConfig {
    /// The API key to be used for the Google Books API.
    pub api_key: String,
    /// Whether to pass the raw query string to the search API.
    pub pass_raw_query: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "BOOKS_HARDCOVER_")]
pub struct HardcoverConfig {
    /// The API key to be used.
    pub api_key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case")]
pub struct BookConfig {
    /// Settings related to Hardcover.
    #[setting(nested)]
    pub hardcover: HardcoverConfig,
    /// Settings related to Openlibrary.
    #[setting(nested)]
    pub openlibrary: OpenlibraryConfig,
    /// Settings related to Google Books.
    #[setting(nested)]
    pub google_books: GoogleBooksConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, PartialEq, Eq)]
#[config(rename_all = "snake_case", env_prefix = "DATABASE_")]
pub struct DatabaseConfig {
    /// The Postgres database connection string.
    /// Format described in https://www.sea-ql.org/SeaORM/docs/install-and-config/connection/#postgres.
    #[setting(validate = not_empty)]
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, PartialEq, Eq)]
pub struct ExerciseConfig {}

// FIXME: Remove this in the next major version
#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "MEDIA_")]
pub struct MediaConfig {
    /// Number of days after which a media should be removed from the Monitoring collection.
    #[setting(default = 30)]
    pub monitoring_remove_after_days: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "MOVIES_AND_SHOWS_TMDB_")]
pub struct TmdbConfig {
    /// The access token for the TMDB API.
    #[setting(default = default_tmdb_access_token)]
    pub access_token: String,
    /// The locale to use for making requests to TMDB API.
    #[setting(default = "en")]
    pub locale: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case")]
pub struct MovieAndShowConfig {
    /// Settings related to TMDB.
    #[setting(nested)]
    pub tmdb: TmdbConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "PODCASTS_LISTENNOTES_")]
pub struct ListenNotesConfig {
    /// The access token for the Listennotes API.
    pub api_token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "PODCASTS_ITUNES_")]
pub struct ITunesConfig {
    /// The locale to use for making requests to iTunes API.
    #[setting(default = "en_us")]
    pub locale: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case")]
pub struct PodcastConfig {
    /// Settings related to Listennotes.
    #[setting(nested)]
    pub listennotes: ListenNotesConfig,
    /// Settings related to iTunes.
    #[setting(nested)]
    pub itunes: ITunesConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "VIDEO_GAMES_TWITCH_")]
pub struct TwitchConfig {
    /// The client ID issues by Twitch. **Required** to enable video games
    /// tracking. [More information](/docs/guides/video-games.md).
    pub client_id: String,
    /// The client secret issued by Twitch. **Required** to enable video games
    /// tracking.
    pub client_secret: String,
}

derive_enum!(
    #[derive(ConfigEnum, Default)]
    pub enum IgdbImageSize {
        #[default]
        #[serde(rename = "t_original")]
        Original,
    }
);

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "VIDEO_GAMES_IGDB_")]
pub struct IgdbConfig {
    /// The image sizes to fetch from IGDB.
    pub image_size: IgdbImageSize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "VIDEO_GAMES_GIANT_BOMB_")]
pub struct GiantBombConfig {
    /// The API key to be used for the GiantBomb API.
    pub api_key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case")]
pub struct VideoGameConfig {
    /// Settings related to IGDB.
    #[setting(nested)]
    pub igdb: IgdbConfig,
    /// Settings related to Twitch.
    #[setting(nested)]
    pub twitch: TwitchConfig,
    /// Settings related to GiantBomb.
    #[setting(nested)]
    pub giant_bomb: GiantBombConfig,
}

impl VideoGameConfig {
    pub fn is_enabled(&self) -> bool {
        let mut enabled = false;
        if !self.twitch.client_id.is_empty() && !self.twitch.client_secret.is_empty() {
            enabled = true;
        }
        if !self.giant_bomb.api_key.is_empty() {
            enabled = true;
        }
        enabled
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "VISUAL_NOVEL_")]
pub struct VisualNovelConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "FILE_STORAGE_")]
pub struct FileStorageConfig {
    /// The access key ID for the S3 compatible file storage. **Required** to
    /// enable file storage.
    pub s3_access_key_id: String,
    /// The name of the S3 compatible bucket. **Required** to enable file storage.
    pub s3_bucket_name: String,
    /// The region for the S3 compatible file storage.
    #[setting(default = "us-east-1")]
    pub s3_region: String,
    /// The secret access key for the S3 compatible file storage. **Required**
    /// to enable file storage.
    pub s3_secret_access_key: String,
    /// The URL for the S3 compatible file storage.
    pub s3_url: String,
}

impl FileStorageConfig {
    pub fn is_enabled(&self) -> bool {
        let mut enabled = false;
        if !self.s3_access_key_id.is_empty()
            && !self.s3_bucket_name.is_empty()
            && !self.s3_secret_access_key.is_empty()
        {
            enabled = true;
        }
        enabled
    }
}

/// The configuration related to Umami analytics. More information
/// [here](https://umami.is/docs/tracker-configuration).
#[derive(PartialEq, Eq, Debug, Serialize, Deserialize, Clone, Config, SimpleObject)]
#[config(rename_all = "snake_case", env_prefix = "FRONTEND_UMAMI_")]
pub struct FrontendUmamiConfig {
    pub domains: String,
    /// For example: https://umami.is/script.js.
    pub script_url: String,
    pub website_id: String,
}

#[derive(PartialEq, Eq, Debug, Serialize, Deserialize, Clone, Config, SimpleObject)]
#[config(rename_all = "snake_case", env_prefix = "FRONTEND_")]
pub struct FrontendConfig {
    /// Used as the base URL when generating item links for the frontend.
    #[setting(default = "https://app.ryot.io")]
    pub url: String,
    /// The button label for OIDC authentication.
    #[setting(default = "Continue with OpenID Connect")]
    pub oidc_button_label: String,
    /// A message to be displayed on the dashboard.
    pub dashboard_message: String,
    /// Settings related to Umami analytics.
    #[setting(nested)]
    pub umami: FrontendUmamiConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "SCHEDULER_")]
pub struct SchedulerConfig {
    /// Run frequent cron tasks (syncing integrations, workout revisions) every `n` minutes.
    #[setting(default = 5)]
    pub frequent_cron_jobs_every_minutes: i32,
    /// Hours cron component for infrequent cron jobs (cleaning up data, refreshing calendar).
    #[setting(default = "0")]
    pub infrequent_cron_jobs_hours_format: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "SERVER_SMTP_")]
pub struct SmtpConfig {
    pub server: String,
    pub user: String,
    pub password: String,
    #[setting(default = "Ryot <no-reply@mailer.io>")]
    pub mailbox: String,
}

impl SmtpConfig {
    pub fn is_enabled(&self) -> bool {
        let mut enabled = false;
        if !self.server.is_empty() && !self.user.is_empty() && !self.password.is_empty() {
            enabled = true;
        }
        enabled
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "SERVER_OIDC_")]
pub struct OidcConfig {
    pub client_id: String,
    pub client_secret: String,
    pub issuer_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "SERVER_IMPORTER_")]
pub struct ImporterConfig {
    /// The client ID for the Trakt importer. **Required** to enable Trakt importer.
    #[setting(default = default_trakt_client_id)]
    pub trakt_client_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "SERVER_")]
pub struct ServerConfig {
    /// The host address to bind the backend server to.
    #[setting(default = "0.0.0.0")]
    pub backend_host: String,
    /// The port number to bind the backend server to.
    #[setting(default = 5000)]
    pub backend_port: usize,
    /// Whether this is a demo instance.
    #[setting(default = false)]
    pub is_demo_instance: bool,
    /// The mailer related settings.
    #[setting(nested)]
    pub smtp: SmtpConfig,
    /// The OIDC related settings.
    #[setting(nested)]
    pub oidc: OidcConfig,
    /// The importer related settings.
    #[setting(nested)]
    pub importer: ImporterConfig,
    /// The pro key assigned to the user.
    pub pro_key: String,
    /// An array of URLs for CORS.
    #[setting(default = vec![], parse_env = schematic::env::split_comma)]
    pub cors_origins: Vec<String>,
    /// The hours in which a media can be marked as seen again for a user. This
    /// is used so that the same media can not be used marked as started when
    /// it has been already marked as seen in the last `n` hours.
    #[setting(default = 2)]
    pub progress_update_threshold: i64,
    /// The maximum file size in MB for user uploads.
    #[setting(default = 70)]
    pub max_file_size_mb: usize,
    /// Whether the graphql playground will be enabled.
    #[setting(default = true)]
    pub graphql_playground_enabled: bool,
    /// Disable all background jobs.
    #[setting(default = false)]
    pub disable_background_jobs: bool,
    /// Number of seconds to sleep before starting the server.
    #[setting(default = 0)]
    pub sleep_before_startup_seconds: u64,
    /// An access token that can be used for admin operations.
    #[setting(default = format!("{}", PROJECT_NAME))]
    pub admin_access_token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "USERS_")]
pub struct UsersConfig {
    /// The secret used for generating JWT tokens.
    #[setting(default = format!("{}", PROJECT_NAME))]
    pub jwt_secret: String,
    /// Whether new users will be allowed to sign up to this instance.
    #[setting(default = true)]
    pub allow_registration: bool,
    /// The number of days till login authentication token is valid.
    #[setting(default = 90)]
    pub token_valid_for_days: i32,
    /// Whether to disable local user authentication completely.
    #[setting(default = false)]
    pub disable_local_auth: bool,
    /// Whether to validate password for users.
    #[setting(default = true, skip)]
    pub validate_password: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case")]
pub struct AppConfig {
    /// Settings related to music.
    #[setting(nested)]
    pub music: MusicConfig,
    /// Settings related to anime and manga.
    #[setting(nested)]
    pub anime_and_manga: AnimeAndMangaConfig,
    /// Settings related to audio books.
    #[setting(nested)]
    pub audio_books: AudioBookConfig,
    /// Settings related to books.
    #[setting(nested)]
    pub books: BookConfig,
    /// The database related settings.
    #[setting(nested)]
    pub database: DatabaseConfig,
    /// Settings related to exercises.
    #[setting(nested)]
    pub exercise: ExerciseConfig,
    /// Settings related to file storage.
    #[setting(nested)]
    pub file_storage: FileStorageConfig,
    /// Settings related to frontend storage.
    #[setting(nested)]
    pub frontend: FrontendConfig,
    /// Settings related to media.
    #[setting(nested)]
    pub media: MediaConfig,
    /// Settings related to movies and shows.
    #[setting(nested)]
    pub movies_and_shows: MovieAndShowConfig,
    /// Settings related to podcasts.
    #[setting(nested)]
    pub podcasts: PodcastConfig,
    /// Settings related to scheduler.
    #[setting(nested)]
    pub scheduler: SchedulerConfig,
    /// Settings related to server.
    #[setting(nested)]
    pub server: ServerConfig,
    /// Settings related to users.
    #[setting(nested)]
    pub users: UsersConfig,
    /// Settings related to video games.
    #[setting(nested)]
    pub video_games: VideoGameConfig,
    /// Settings related to visual novels.
    #[setting(nested)]
    pub visual_novels: VisualNovelConfig,

    // Global options
    /// Whether to disable telemetry.
    #[setting(default = false, env = "DISABLE_TELEMETRY")]
    pub disable_telemetry: bool,
}

impl AppConfig {
    pub fn masked_value(&self) -> Self {
        let gt = || "****".to_owned();
        let mut cl = self.clone();
        cl.anime_and_manga.mal.client_id = gt();
        cl.books.hardcover.api_key = gt();
        cl.books.google_books.api_key = gt();
        cl.database.url = gt();
        cl.file_storage.s3_region = gt();
        cl.file_storage.s3_bucket_name = gt();
        cl.file_storage.s3_access_key_id = gt();
        cl.file_storage.s3_secret_access_key = gt();
        cl.file_storage.s3_url = gt();
        cl.movies_and_shows.tmdb.access_token = gt();
        cl.podcasts.listennotes.api_token = gt();
        cl.video_games.twitch.client_id = gt();
        cl.video_games.twitch.client_secret = gt();
        cl.video_games.giant_bomb.api_key = gt();
        cl.users.jwt_secret = gt();
        cl.server.cors_origins = vec![gt()];
        cl.server.smtp.server = gt();
        cl.server.smtp.user = gt();
        cl.server.smtp.password = gt();
        cl.server.smtp.mailbox = gt();
        cl.server.importer.trakt_client_id = gt();
        cl.server.oidc.client_id = gt();
        cl.server.oidc.client_secret = gt();
        cl.server.oidc.issuer_url = gt();
        cl.server.pro_key = gt();
        cl.server.admin_access_token = gt();
        cl
    }
}

pub fn load_app_config() -> Result<AppConfig> {
    let config = "config";
    let app = PROJECT_NAME;
    let path = PathBuf::from(config);

    let result = ConfigLoader::<AppConfig>::new()
        .file_optional(path.join(format!("{app}.json")))?
        .file_optional(path.join(format!("{app}.toml")))?
        .file_optional(path.join(format!("{app}.yaml")))?
        .load()?;

    Ok(result.config)
}
