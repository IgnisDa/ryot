use std::path::PathBuf;

use anyhow::Result;
use async_graphql::SimpleObject;
use common_utils::PROJECT_NAME;
use config_macros::MaskedConfig;
use schematic::{Config, ConfigEnum, ConfigLoader, derive_enum, validate::not_empty};
use serde::{Deserialize, Serialize};

/// Trait for creating masked versions of configuration structs
pub trait MaskedConfig {
    fn masked(&self) -> Self;
}

/// Helper function to mask string values
pub fn mask_string(value: &str) -> String {
    match value.is_empty() {
        false => "****".to_owned(),
        true => "<empty>".to_owned(),
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "ANIME_AND_MANGA_MAL_")]
pub struct MalConfig {
    /// The client ID to be used for the MAL API.
    #[mask]
    pub client_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "ANIME_AND_MANGA_ANILIST_")]
pub struct AnilistConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(
    rename_all = "snake_case",
    env_prefix = "ANIME_AND_MANGA_MANGA_UPDATES_"
)]
pub struct MangaUpdatesConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case")]
pub struct AnimeAndMangaConfig {
    /// Settings related to MAL.
    #[setting(nested)]
    #[mask_nested]
    pub mal: MalConfig,
    /// Settings related to Anilist.
    #[setting(nested)]
    pub anilist: AnilistConfig,
    /// Settings related to MangaUpdates.
    #[setting(nested)]
    pub manga_updates: MangaUpdatesConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "MUSIC_SPOTIFY_")]
pub struct SpotifyConfig {
    /// The client ID for the Spotify API.
    #[mask]
    pub client_id: String,
    /// The client secret for the Spotify API.
    #[mask]
    pub client_secret: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case")]
pub struct MusicConfig {
    /// Settings related to Spotify.
    #[setting(nested)]
    #[mask_nested]
    pub spotify: SpotifyConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "AUDIO_BOOKS_AUDIBLE_")]
pub struct AudibleConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
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

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "BOOKS_OPENLIBRARY_")]
pub struct OpenlibraryConfig {
    /// The image sizes to fetch from Openlibrary.
    pub cover_image_size: OpenlibraryCoverImageSize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "BOOKS_GOOGLE_BOOKS_")]
pub struct GoogleBooksConfig {
    /// The API key to be used for the Google Books API.
    #[mask]
    pub api_key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "BOOKS_HARDCOVER_")]
pub struct HardcoverConfig {
    /// The API key to be used.
    #[mask]
    pub api_key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case")]
pub struct BookConfig {
    /// Settings related to Hardcover.
    #[setting(nested)]
    #[mask_nested]
    pub hardcover: HardcoverConfig,
    /// Settings related to Openlibrary.
    #[setting(nested)]
    pub openlibrary: OpenlibraryConfig,
    /// Settings related to Google Books.
    #[setting(nested)]
    #[mask_nested]
    pub google_books: GoogleBooksConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, PartialEq, Eq, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "DATABASE_")]
pub struct DatabaseConfig {
    /// The Postgres database connection string.
    /// Format described in https://www.sea-ql.org/SeaORM/docs/install-and-config/connection/#postgres.
    #[setting(validate = not_empty)]
    #[mask]
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, PartialEq, Eq, MaskedConfig)]
pub struct ExerciseConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "MOVIES_AND_SHOWS_TVDB_")]
pub struct TvdbConfig {
    /// The API key for the TVDB API.
    #[mask]
    pub api_key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "MOVIES_AND_SHOWS_TMDB_")]
pub struct TmdbConfig {
    /// The access token for the TMDB API.
    #[mask]
    pub access_token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case")]
pub struct MovieAndShowConfig {
    /// Settings related to TMDB.
    #[setting(nested)]
    #[mask_nested]
    pub tmdb: TmdbConfig,
    /// Settings related to TVDB.
    #[setting(nested)]
    #[mask_nested]
    pub tvdb: TvdbConfig,
}

impl MovieAndShowConfig {
    pub fn is_enabled(&self) -> bool {
        !self.tmdb.access_token.is_empty() || !self.tvdb.api_key.is_empty()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "PODCASTS_LISTENNOTES_")]
pub struct ListenNotesConfig {
    /// The access token for the Listennotes API.
    #[mask]
    pub api_token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "PODCASTS_ITUNES_")]
pub struct ITunesConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case")]
pub struct PodcastConfig {
    /// Settings related to iTunes.
    #[setting(nested)]
    pub itunes: ITunesConfig,
    /// Settings related to Listennotes.
    #[setting(nested)]
    #[mask_nested]
    pub listennotes: ListenNotesConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "VIDEO_GAMES_TWITCH_")]
pub struct TwitchConfig {
    /// The client ID issues by Twitch. **Required** to enable video games
    /// tracking. [More information](/docs/guides/video-games.md).
    #[mask]
    pub client_id: String,
    /// The client secret issued by Twitch. **Required** to enable video games
    /// tracking.
    #[mask]
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

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "VIDEO_GAMES_IGDB_")]
pub struct IgdbConfig {
    /// The image sizes to fetch from IGDB.
    pub image_size: IgdbImageSize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "VIDEO_GAMES_GIANT_BOMB_")]
pub struct GiantBombConfig {
    /// The API key to be used for the GiantBomb API.
    #[mask]
    pub api_key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case")]
pub struct VideoGameConfig {
    /// Settings related to IGDB.
    #[setting(nested)]
    pub igdb: IgdbConfig,
    /// Settings related to Twitch.
    #[setting(nested)]
    #[mask_nested]
    pub twitch: TwitchConfig,
    /// Settings related to GiantBomb.
    #[setting(nested)]
    #[mask_nested]
    pub giant_bomb: GiantBombConfig,
}

impl VideoGameConfig {
    pub fn is_enabled(&self) -> bool {
        (!self.twitch.client_id.is_empty() && !self.twitch.client_secret.is_empty())
            || !self.giant_bomb.api_key.is_empty()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "COMIC_BOOK_METRON_")]
pub struct MetronConfig {
    /// The username for the Metron API.
    #[mask]
    pub username: String,
    /// The password for the Metron API.
    #[mask]
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case")]
pub struct ComicBookConfig {
    /// Settings related to Metron.
    #[setting(nested)]
    #[mask_nested]
    pub metron: MetronConfig,
}

impl ComicBookConfig {
    pub fn is_enabled(&self) -> bool {
        !self.metron.username.is_empty() && !self.metron.password.is_empty()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "VISUAL_NOVEL_")]
pub struct VisualNovelConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "FILE_STORAGE_")]
pub struct FileStorageConfig {
    /// The URL for the S3 compatible file storage.
    pub s3_url: String,
    /// The region for the S3 compatible file storage.
    #[setting(default = "us-east-1")]
    pub s3_region: String,
    /// The name of the S3 compatible bucket. **Required** to enable file storage.
    pub s3_bucket_name: String,
    /// The access key ID for the S3 compatible file storage. **Required** to
    /// enable file storage.
    #[mask]
    pub s3_access_key_id: String,
    /// The secret access key for the S3 compatible file storage. **Required**
    /// to enable file storage.
    #[mask]
    pub s3_secret_access_key: String,
}

impl FileStorageConfig {
    pub fn is_enabled(&self) -> bool {
        let mut enabled = false;
        if !self.s3_url.is_empty()
            && !self.s3_access_key_id.is_empty()
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
#[derive(
    PartialEq, Eq, Debug, Serialize, Deserialize, Clone, Config, SimpleObject, MaskedConfig,
)]
#[config(rename_all = "snake_case", env_prefix = "FRONTEND_UMAMI_")]
pub struct FrontendUmamiConfig {
    /// For example: https://umami.is/script.js.
    pub script_url: String,
    pub website_id: String,
}

#[derive(
    PartialEq, Eq, Debug, Serialize, Deserialize, Clone, Config, SimpleObject, MaskedConfig,
)]
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

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "SCHEDULER_")]
pub struct SchedulerConfig {
    /// English expression for frequent cron tasks (syncing integrations, workout revisions).
    /// Uses https://github.com/kaplanelad/english-to-cron.
    #[setting(default = "every 5 minutes")]
    pub frequent_cron_jobs_schedule: String,
    /// English expression for infrequent cron jobs (cleaning up data, refreshing calendar).
    /// Uses https://github.com/kaplanelad/english-to-cron.
    #[setting(default = "every midnight")]
    pub infrequent_cron_jobs_schedule: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "SERVER_SMTP_")]
pub struct SmtpConfig {
    #[mask]
    pub user: String,
    pub server: String,
    #[mask]
    pub password: String,
    #[setting(default = "Ryot <no-reply@ryot.io>")]
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

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "SERVER_OIDC_")]
pub struct OidcConfig {
    #[mask]
    pub client_id: String,
    pub issuer_url: String,
    #[mask]
    pub client_secret: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "SERVER_IMPORTER_")]
pub struct ImporterConfig {
    /// The client ID for the Trakt importer. **Required** to enable Trakt importer.
    #[mask]
    pub trakt_client_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "SERVER_")]
pub struct ServerConfig {
    /// The key that can be used to enable Ryot Pro features.
    #[mask]
    pub pro_key: String,
    /// The OIDC related settings.
    #[setting(nested)]
    #[mask_nested]
    pub oidc: OidcConfig,
    /// The mailer related settings.
    #[setting(nested)]
    #[mask_nested]
    pub smtp: SmtpConfig,
    /// The port number to bind the backend server to.
    #[setting(default = 5000)]
    pub backend_port: usize,
    /// The host address to bind the backend server to.
    #[setting(default = "0.0.0.0")]
    pub backend_host: String,
    /// Whether this is a demo instance.
    #[setting(default = false)]
    pub is_demo_instance: bool,
    /// The maximum file size in MB for user uploads.
    #[setting(default = 70)]
    pub max_file_size_mb: usize,
    /// The importer related settings.
    #[setting(nested)]
    #[mask_nested]
    pub importer: ImporterConfig,
    /// An array of URLs for CORS.
    #[setting(default = vec![], parse_env = schematic::env::split_comma)]
    pub cors_origins: Vec<String>,
    /// An access token that can be used for admin operations.
    #[mask]
    #[setting(validate = not_empty)]
    pub admin_access_token: String,
    /// Disable all background jobs.
    #[setting(default = false)]
    pub disable_background_jobs: bool,
    /// Number of deterministic shards used for single application job queues.
    /// Jobs are hashed by integration/user key, so each key is serialized while
    /// different keys can run in parallel across shards.
    #[setting(default = 32)]
    pub single_application_job_shards: usize,
    /// The hours in which a media can be marked as seen again for a user. This
    /// is used so that the same media can not be used marked as started when
    /// it has been already marked as seen in the last `n` hours.
    #[setting(default = 2)]
    pub progress_update_threshold: i64,
    /// Whether the graphql playground will be enabled.
    #[setting(default = true)]
    pub graphql_playground_enabled: bool,
    /// Number of seconds to sleep before starting the server.
    #[setting(default = 0)]
    pub sleep_before_startup_seconds: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case", env_prefix = "USERS_")]
pub struct UsersConfig {
    /// Whether to validate password for users.
    #[setting(default = true, skip)]
    pub validate_password: bool,
    /// Whether to disable local user authentication completely.
    #[setting(default = false)]
    pub disable_local_auth: bool,
    /// Whether new users will be allowed to sign up to this instance.
    #[setting(default = true)]
    pub allow_registration: bool,
    /// The number of days till login authentication token is valid.
    #[setting(default = 90)]
    pub token_valid_for_days: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, MaskedConfig)]
#[config(rename_all = "snake_case")]
pub struct AppConfig {
    /// Settings related to books.
    #[setting(nested)]
    #[mask_nested]
    pub books: BookConfig,
    /// Settings related to users.
    #[setting(nested)]
    pub users: UsersConfig,
    /// Settings related to music.
    #[setting(nested)]
    #[mask_nested]
    pub music: MusicConfig,
    /// Settings related to server.
    #[setting(nested)]
    #[mask_nested]
    pub server: ServerConfig,
    /// Settings related to podcasts.
    #[setting(nested)]
    #[mask_nested]
    pub podcasts: PodcastConfig,
    /// Settings related to frontend storage.
    #[setting(nested)]
    pub frontend: FrontendConfig,
    /// The database related settings.
    #[setting(nested)]
    #[mask_nested]
    pub database: DatabaseConfig,
    /// Settings related to exercises.
    #[setting(nested)]
    pub exercise: ExerciseConfig,
    /// Settings related to scheduler.
    #[setting(nested)]
    pub scheduler: SchedulerConfig,
    /// Settings related to video games.
    #[setting(nested)]
    #[mask_nested]
    pub video_games: VideoGameConfig,
    /// Settings related to comic books.
    #[setting(nested)]
    #[mask_nested]
    pub comic_books: ComicBookConfig,
    /// Settings related to audio books.
    #[setting(nested)]
    pub audio_books: AudioBookConfig,
    /// Settings related to file storage.
    #[setting(nested)]
    #[mask_nested]
    pub file_storage: FileStorageConfig,
    /// Settings related to visual novels.
    #[setting(nested)]
    pub visual_novels: VisualNovelConfig,
    /// Settings related to anime and manga.
    #[setting(nested)]
    #[mask_nested]
    pub anime_and_manga: AnimeAndMangaConfig,
    /// Settings related to movies and shows.
    #[setting(nested)]
    #[mask_nested]
    pub movies_and_shows: MovieAndShowConfig,

    // Global options
    /// Timezone to be used for date time operations.
    #[setting(default = "Etc/GMT", env = "TZ")]
    pub tz: String,
    /// Whether to disable telemetry.
    #[setting(default = false, env = "DISABLE_TELEMETRY")]
    pub disable_telemetry: bool,
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
