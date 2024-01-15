use std::path::PathBuf;

use anyhow::Result;
use rs_utils::{IsFeatureEnabled, PROJECT_NAME};
use schematic::{derive_enum, validate::not_empty, Config, ConfigEnum, ConfigLoader};
use serde::{Deserialize, Serialize};

fn default_tmdb_access_token(_ctx: &()) -> Option<String> {
    Some("eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4ZGVlOTZjMjc0OGVhY2U0NzU2MGJkMWU4YzE5NTljMCIsInN1YiI6IjY0NDRiYmE4MmM2YjdiMDRiZTdlZDJmNSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.ZZZNJMXStvAOPJlT0hOBVPSTppFAK3mcUpmbJsExIq4".to_owned())
}

fn default_mal_client_id(_ctx: &()) -> Option<String> {
    Some("3879694bbe52ac3204be9ff68af8f027".to_owned())
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "ANIME_AND_MANGA_MAL_")]
pub struct MalConfig {
    /// The client ID to be used for the MAL API.
    #[setting(default = default_mal_client_id)]
    pub client_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "ANIME_AND_MANGA_ANILIST_")]
pub struct AnilistConfig {
    /// Whether to prefer the english name for media from this source.
    pub prefer_english: bool,
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

impl IsFeatureEnabled for AnimeAndMangaConfig {}

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

impl IsFeatureEnabled for AudioBookConfig {}

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
#[config(rename_all = "snake_case", env_prefix = "BOOKS_GOOGLE_BOOKS_")]
pub struct GoogleBooksConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "BOOKS_OPENLIBRARY_")]
pub struct OpenlibraryConfig {
    /// The image sizes to fetch from Openlibrary.
    pub cover_image_size: OpenlibraryCoverImageSize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case")]
pub struct BookConfig {
    /// Settings related to Openlibrary.
    #[setting(nested)]
    pub openlibrary: OpenlibraryConfig,
    /// Settings related to Google Books.
    #[setting(nested)]
    pub google_books: GoogleBooksConfig,
}

impl IsFeatureEnabled for BookConfig {}

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

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "MEDIA_")]
pub struct MediaConfig {}

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

impl IsFeatureEnabled for MovieAndShowConfig {}

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

impl IsFeatureEnabled for PodcastConfig {}

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
#[config(rename_all = "snake_case")]
pub struct VideoGameConfig {
    /// Settings related to IGDB.
    #[setting(nested)]
    pub igdb: IgdbConfig,
    /// Settings related to Twitch.
    #[setting(nested)]
    pub twitch: TwitchConfig,
}

impl IsFeatureEnabled for VideoGameConfig {
    fn is_enabled(&self) -> bool {
        let mut enabled = false;
        if !self.twitch.client_id.is_empty() && !self.twitch.client_secret.is_empty() {
            enabled = true;
        }
        enabled
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "VISUAL_NOVEL_")]
pub struct VisualNovelConfig {}

impl IsFeatureEnabled for VisualNovelConfig {}

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

/// The configuration related to Umami analytics. More information
/// [here](https://umami.is/docs/tracker-configuration).
#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "FRONTEND_UMAMI_")]
pub struct FrontendUmamiConfig {
    /// For example: https://umami.is/script.js.
    pub script_url: String,
    pub website_id: String,
    pub domains: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "FRONTEND_")]
pub struct FrontendConfig {
    #[setting(default = "https://ryot.fly.dev")]
    pub url: String,
    /// The height of the right section of an item's details page in pixels.
    #[setting(default = 300)]
    pub item_details_height: u32,
    /// The number of items to display in a list view.
    #[setting(default = 20)]
    pub page_size: i32,
    /// Settings related to Umami analytics.
    #[setting(nested)]
    pub umami: FrontendUmamiConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "INTEGRATION_")]
pub struct IntegrationConfig {
    /// Sync data from [yank](/docs/guides/integrations.md) based integrations
    /// every `n` hours.
    #[setting(default = 2)]
    pub pull_every: i32,
    /// The salt used to hash user IDs.
    #[setting(default = format!("{}", PROJECT_NAME))]
    pub hasher_salt: String,
    /// The minimum progress limit before which a media is considered to be started.
    #[setting(default = 2)]
    pub minimum_progress_limit: i32,
    /// The maximum progress limit after which a media is considered to be completed.
    #[setting(default = 95)]
    pub maximum_progress_limit: i32,
}

impl IsFeatureEnabled for FileStorageConfig {
    fn is_enabled(&self) -> bool {
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

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "SCHEDULER_")]
pub struct SchedulerConfig {
    /// The url to the SQLite database where job related data needs to be stored.
    #[setting(default = "sqlite::memory:")]
    pub database_url: String,
    /// The number of jobs to process every 5 seconds when updating metadata in
    /// the background.
    #[setting(default = 5)]
    pub rate_limit_num: u64,
    /// Deploy a job every x hours that performs user cleanup and summary
    /// calculation.
    #[setting(default = 12)]
    pub user_cleanup_every: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "SERVER_")]
pub struct ServerConfig {
    /// The path where the config file will be written once the server boots up.
    #[setting(default = format!("tmp/{}-config.json", PROJECT_NAME))]
    pub config_dump_path: String,
    /// An array of URLs for CORS.
    #[setting(default = vec![], parse_env = schematic::env::split_comma)]
    pub cors_origins: Vec<String>,
    /// Whether default credentials will be populated on the login page of the
    /// instance.
    pub default_credentials: bool,
    /// The hours in which a media can be marked as seen again for a user. This
    /// is used so that the same media can not be used marked as started when
    /// it has been already marked as seen in the last `n` hours.
    #[setting(default = 2)]
    pub progress_update_threshold: i64,
    /// The number of days after which details about a person are considered outdated.
    #[setting(default = 30)]
    pub person_outdated_threshold: i64,
    /// Admin jobs take a lot of resources, so they can be disabled completely from being
    /// triggered manually. They still run as background jobs.
    #[setting(default = true)]
    pub deploy_admin_jobs_allowed: bool,
    /// The maximum file size in MB for user uploads.
    #[setting(default = 70)]
    pub max_file_size: usize,
    /// Whether videos will be displayed in the media details.
    #[setting(default = false)]
    pub videos_disabled: bool,
    /// Whether monitored media will be updated.
    #[setting(default = true)]
    pub update_monitored_media: bool,
    /// Whether the graphql playground will be enabled.
    #[setting(default = true)]
    pub graphql_playground_enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "USERS_")]
pub struct UsersConfig {
    /// The secret used for generating JWT tokens.
    #[setting(default = format!("{}", PROJECT_NAME))]
    pub jwt_secret: String,
    /// Whether users will be allowed to change their preferences in their profile
    /// settings.
    #[setting(default = true)]
    pub allow_changing_preferences: bool,
    /// Whether users will be allowed to change their username and password in their
    /// profile settings.
    #[setting(default = true)]
    pub allow_changing_credentials: bool,
    /// Whether new users will be allowed to sign up to this instance.
    #[setting(default = true)]
    pub allow_registration: bool,
    /// Whether users will be allowed to post reviews on this instance.
    #[setting(default = false)]
    pub reviews_disabled: bool,
    /// The number of days till login auth token is valid.
    #[setting(default = 90)]
    pub token_valid_for_days: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case")]
pub struct AppConfig {
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
    /// Settings related to external integrations.
    #[setting(nested)]
    pub integration: IntegrationConfig,
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
}

impl AppConfig {
    // TODO: Denote masked values via attribute
    pub fn masked_value(&self) -> Self {
        let gt = || "****".to_owned();
        let mut cl = self.clone();
        cl.anime_and_manga.mal.client_id = gt();
        cl.database.url = gt();
        cl.file_storage.s3_region = gt();
        cl.file_storage.s3_bucket_name = gt();
        cl.file_storage.s3_access_key_id = gt();
        cl.file_storage.s3_secret_access_key = gt();
        cl.file_storage.s3_url = gt();
        cl.integration.hasher_salt = gt();
        cl.movies_and_shows.tmdb.access_token = gt();
        cl.podcasts.listennotes.api_token = gt();
        cl.scheduler.database_url = gt();
        cl.video_games.twitch.client_id = gt();
        cl.video_games.twitch.client_secret = gt();
        cl.server.config_dump_path = gt();
        cl.server.cors_origins = vec![gt()];
        cl.users.jwt_secret = gt();
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
