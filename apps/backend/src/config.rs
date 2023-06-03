use std::path::PathBuf;

use anyhow::Result;
use schematic::{derive_enum, validate::url_secure, Config, ConfigEnum, ConfigLoader};
use serde::{Deserialize, Serialize};

use crate::graphql::PROJECT_NAME;

fn default_tmdb_url(_ctx: &()) -> Option<String> {
    Some("https://api.themoviedb.org/3/".to_owned())
}

fn default_tmdb_access_token(_ctx: &()) -> Option<String> {
    Some("eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4ZGVlOTZjMjc0OGVhY2U0NzU2MGJkMWU4YzE5NTljMCIsInN1YiI6IjY0NDRiYmE4MmM2YjdiMDRiZTdlZDJmNSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.ZZZNJMXStvAOPJlT0hOBVPSTppFAK3mcUpmbJsExIq4".to_owned())
}

/// Determine whether a feature is enabled
pub trait IsFeatureEnabled {
    fn is_enabled(&self) -> bool {
        true
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "AUDIO_BOOKS_AUDIBLE_")]
pub struct AudibleConfig {
    #[setting(validate = url_secure, default = "https://api.audible.com/1.0/catalog/products/")]
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
pub struct AudioBookConfig {
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
#[config(rename_all = "snake_case", env_prefix = "BOOKS_OPENLIBRARY_")]
pub struct OpenlibraryConfig {
    #[setting(validate = url_secure, default = "https://openlibrary.org")]
    pub url: String,
    #[setting(validate = url_secure, default = "https://covers.openlibrary.org/b")]
    pub cover_image_url: String,
    pub cover_image_size: OpenlibraryCoverImageSize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
pub struct BookConfig {
    #[setting(nested)]
    pub openlibrary: OpenlibraryConfig,
}

impl IsFeatureEnabled for BookConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config, PartialEq, Eq)]
#[config(rename_all = "snake_case", env_prefix = "DATABASE_")]
pub struct DatabaseConfig {
    #[setting(default = format!("sqlite:/data/{}.db?mode=rwc", PROJECT_NAME))]
    pub url: String,
    #[setting(default = format!("/data/{}-scdb.db", PROJECT_NAME))]
    pub scdb_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "MOVIES_TMDB_")]
pub struct MoviesTmdbConfig {
    #[setting(validate = url_secure, default = default_tmdb_url)]
    pub url: String,
    #[setting(default = default_tmdb_access_token)]
    pub access_token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
pub struct MovieConfig {
    #[setting(nested)]
    pub tmdb: MoviesTmdbConfig,
}

impl IsFeatureEnabled for MovieConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "PODCASTS_LISTENNOTES_")]
pub struct ListenNotesConfig {
    #[setting(validate = url_secure, default = "https://listen-api.listennotes.com/api/v2/")]
    pub url: String,
    pub api_token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
pub struct PodcastConfig {
    #[setting(nested)]
    pub listennotes: ListenNotesConfig,
}

impl IsFeatureEnabled for PodcastConfig {
    fn is_enabled(&self) -> bool {
        let mut enabled = false;
        if !self.listennotes.api_token.is_empty() {
            enabled = true;
        }
        enabled
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "MOVIES_TMDB_")]
pub struct ShowsTmdbConfig {
    #[setting(validate = url_secure, default = default_tmdb_url)]
    pub url: String,
    #[setting(default = default_tmdb_access_token)]
    pub access_token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
pub struct ShowConfig {
    #[setting(nested)]
    pub tmdb: ShowsTmdbConfig,
}

impl IsFeatureEnabled for ShowConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "VIDEO_GAMES_TWITCH_")]
pub struct TwitchConfig {
    pub client_id: String,
    pub client_secret: String,
    // Endpoint used to get access tokens which will be used by IGDB
    #[setting(validate = url_secure, default = "https://id.twitch.tv/oauth2/token")]
    pub access_token_url: String,
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
    #[setting(validate = url_secure, default = "https://api.igdb.com/v4/")]
    pub url: String,
    #[setting(validate = url_secure, default = "https://images.igdb.com/igdb/image/upload/")]
    pub image_url: String,
    pub image_size: IgdbImageSize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
pub struct VideoGameConfig {
    #[setting(nested)]
    pub twitch: TwitchConfig,
    #[setting(nested)]
    pub igdb: IgdbConfig,
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
#[config(rename_all = "snake_case", env_prefix = "FILE_STORAGE_")]
pub struct FileStorageConfig {
    #[setting(default = "us-east-1")]
    pub aws_region: String,
    pub aws_access_key_id: String,
    pub aws_secret_access_key: String,
    #[setting(validate = url_secure, default = "https://amazonaws.com")]
    pub aws_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "SCHEDULER_")]
pub struct SchedulerConfig {
    #[setting(default = "sqlite::memory:")]
    pub database_url: String,
    #[setting(default = 600)]
    pub user_cleanup_every: i32,
    #[setting(default = 5)]
    pub rate_limit_num: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "USERS_")]
pub struct UsersConfig {
    #[setting(default = true)]
    pub allow_changing_username: bool,
    #[setting(default = 90)]
    pub token_valid_for_days: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "WEB_")]
pub struct WebConfig {
    #[setting(default = vec![], parse_env = schematic::env::split_comma)]
    pub cors_origins: Vec<String>,
    pub insecure_cookie: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case")]
pub struct AppConfig {
    #[setting(nested)]
    pub audio_books: AudioBookConfig,
    #[setting(nested)]
    pub books: BookConfig,
    #[setting(nested)]
    pub database: DatabaseConfig,
    #[setting(nested)]
    pub file_storage: FileStorageConfig,
    #[setting(nested)]
    pub movies: MovieConfig,
    #[setting(nested)]
    pub podcasts: PodcastConfig,
    #[setting(nested)]
    pub scheduler: SchedulerConfig,
    #[setting(nested)]
    pub shows: ShowConfig,
    #[setting(nested)]
    pub users: UsersConfig,
    #[setting(nested)]
    pub video_games: VideoGameConfig,
    #[setting(nested)]
    pub web: WebConfig,
}

impl AppConfig {
    // TODO: Denote masked values via attribute
    pub fn masked_value(&self) -> Self {
        let gt = || "****".to_owned();
        let mut cl = self.clone();
        cl.database.url = gt();
        cl.database.scdb_url = gt();
        cl.file_storage.aws_region = gt();
        cl.file_storage.aws_access_key_id = gt();
        cl.file_storage.aws_secret_access_key = gt();
        cl.file_storage.aws_url = gt();
        cl.movies.tmdb.access_token = gt();
        cl.podcasts.listennotes.api_token = gt();
        cl.shows.tmdb.access_token = gt();
        cl.scheduler.database_url = gt();
        cl.video_games.twitch.client_id = gt();
        cl.video_games.twitch.client_secret = gt();
        cl.web.cors_origins = vec![gt()];
        cl
    }
}

pub fn get_app_config() -> Result<AppConfig> {
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
