use std::path::PathBuf;

use anyhow::Result;
use schematic::{derive_enum, validate::url_secure, Config, ConfigEnum, ConfigLoader};

use crate::graphql::PROJECT_NAME;

/// Determine whether a feature is enabled
pub trait IsFeatureEnabled {
    fn is_enabled(&self) -> bool {
        true
    }
}

#[derive(Debug, Clone, Config)]
#[config(rename_all = "snake_case")]
#[config(env_prefix = "AUDIO_BOOKS_AUDIBLE_")]
pub struct AudibleConfig {
    #[setting(validate = url_secure, default = "https://api.audible.com/1.0/catalog/products/")]
    pub url: String,
}

#[derive(Debug, Clone, Config)]
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

#[derive(Debug, Clone, Config)]
#[config(rename_all = "snake_case")]
#[config(env_prefix = "BOOKS_OPENLIBRARY_")]
pub struct OpenlibraryConfig {
    #[setting(validate = url_secure, default = "https://openlibrary.org")]
    pub url: String,
    #[setting(validate = url_secure, default = "https://covers.openlibrary.org/b")]
    pub cover_image_url: String,
    pub cover_image_size: OpenlibraryCoverImageSize,
}

#[derive(Debug, Clone, Config)]
pub struct BookConfig {
    #[setting(nested)]
    pub openlibrary: OpenlibraryConfig,
}

impl IsFeatureEnabled for BookConfig {}

#[derive(Debug, Clone, Config, PartialEq, Eq)]
#[config(rename_all = "snake_case")]
#[config(env_prefix = "DATABASE_")]
pub struct DatabaseConfig {
    #[setting(default = format!("sqlite:/data/{}.db?mode=rwc", PROJECT_NAME))]
    pub url: String,
    #[setting(default = format!("/data/{}-scdb.db", PROJECT_NAME))]
    pub scdb_url: String,
}

#[derive(Debug, Clone, Config)]
#[config(rename_all = "snake_case")]
#[config(env_prefix = "MOVIES_TMDB_")]
// #[config(env_prefix = "SHOWS_TMDB_")]
pub struct TmdbConfig {
    #[setting(validate = url_secure, default = "https://api.themoviedb.org/3/")]
    pub url: String,
    #[setting(
        default = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4ZGVlOTZjMjc0OGVhY2U0NzU2MGJkMWU4YzE5NTljMCIsInN1YiI6IjY0NDRiYmE4MmM2YjdiMDRiZTdlZDJmNSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.ZZZNJMXStvAOPJlT0hOBVPSTppFAK3mcUpmbJsExIq4"
    )]
    pub access_token: String,
}

#[derive(Debug, Clone, Config)]
pub struct MovieConfig {
    #[setting(nested)]
    pub tmdb: TmdbConfig,
}

impl IsFeatureEnabled for MovieConfig {}

#[derive(Debug, Clone, Config)]
#[config(rename_all = "snake_case")]
#[config(env_prefix = "PODCASTS_LISTENNOTES_")]
pub struct ListenNotesConfig {
    #[setting(validate = url_secure, default = "https://listen-api.listennotes.com/api/v2/")]
    pub url: String,
    pub api_token: String,
    pub user_agent: String,
}

#[derive(Debug, Clone, Config)]
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

#[derive(Debug, Clone, Config)]
pub struct ShowConfig {
    #[setting(nested)]
    pub tmdb: TmdbConfig,
}

impl IsFeatureEnabled for ShowConfig {}

#[derive(Debug, Clone, Config)]
#[config(rename_all = "snake_case")]
#[config(env_prefix = "VIDEO_GAMES_TWITCH_")]
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

#[derive(Debug, Clone, Config)]
#[config(rename_all = "snake_case")]
#[config(env_prefix = "VIDEO_GAMES_IGDB_")]
pub struct IgdbConfig {
    #[setting(validate = url_secure, default = "https://api.igdb.com/v4/")]
    pub url: String,
    #[setting(validate = url_secure, default = "https://images.igdb.com/igdb/image/upload/")]
    pub image_url: String,
    pub image_size: IgdbImageSize,
}

#[derive(Debug, Clone, Config)]
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

#[derive(Debug, Clone, Config)]
#[config(rename_all = "snake_case")]
#[config(env_prefix = "SCHEDULER_")]
pub struct SchedulerConfig {
    #[setting(default = "sqlite::memory:")]
    pub database_url: String,
    #[setting(default = 10)]
    pub user_cleanup_every: i32,
}

#[derive(Debug, Clone, Config)]
#[config(rename_all = "snake_case")]
#[config(env_prefix = "USERS_")]
pub struct UsersConfig {
    #[setting(default = true)]
    pub allow_changing_username: bool,
    #[setting(default = 90)]
    pub token_valid_for_days: i32,
}

#[derive(Debug, Clone, Config)]
#[config(rename_all = "snake_case")]
#[config(env_prefix = "WEB_")]
pub struct WebConfig {
    #[setting(default = vec![], parse_env = schematic::env::split_comma)]
    pub cors_origins: Vec<String>,
    pub insecure_cookie: bool,
}

#[derive(Debug, Clone, Config)]
#[config(rename_all = "snake_case")]
pub struct AppConfig {
    #[setting(nested)]
    pub audio_books: AudioBookConfig,
    #[setting(nested)]
    pub books: BookConfig,
    #[setting(nested)]
    pub database: DatabaseConfig,
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

pub fn get_app_config_scheme() -> Result<AppConfig> {
    let config = "config";
    let app = PROJECT_NAME;
    let path = PathBuf::from(config);

    let result = ConfigLoader::<AppConfig>::new()
        .file_optional(path.join(format!("{app}.json")))?
        .file_optional(path.join(format!("{app}.toml")))?
        .file_optional(path.join(format!("{app}.yaml")))?
        .load()?;

    dbg!(&result.config);

    Ok(result.config)
}
