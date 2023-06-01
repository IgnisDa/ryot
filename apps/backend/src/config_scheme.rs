use std::path::PathBuf;

use anyhow::{Context, Result};
use figment::{
    providers::{Env, Format, Json, Serialized, Toml, Yaml},
    Figment,
};
use schematic::{derive_enum, validate::url_secure, Config, ConfigEnum, ConfigLoader};
use serde::{Deserialize, Serialize};

use crate::graphql::PROJECT_NAME;

/// Determine whether a feature is enabled
pub trait IsFeatureEnabled {
    fn is_enabled(&self) -> bool {
        true
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
#[config(rename_all = "snake_case")]
pub struct AudibleConfig {
    #[setting(validate = url_secure, default = "https://api.audible.com/1.0/catalog/products/")]
    pub url: String,
}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
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

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
#[config(rename_all = "snake_case")]
pub struct OpenlibraryConfig {
    #[setting(validate = url_secure, default = "https://openlibrary.org")]
    pub url: String,
    #[setting(validate = url_secure, default = "https://covers.openlibrary.org/b")]
    pub cover_image_url: String,
    pub cover_image_size: OpenlibraryCoverImageSize,
}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
pub struct BookConfig {
    #[setting(nested)]
    pub openlibrary: OpenlibraryConfig,
}

impl IsFeatureEnabled for BookConfig {}

#[derive(Deserialize, Debug, Clone, Serialize, Config, PartialEq, Eq)]
#[config(rename_all = "snake_case")]
pub struct DatabaseConfig {
    #[setting(default = format!("sqlite:/data/{}.db?mode=rwc", PROJECT_NAME))]
    pub url: String,
}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
#[config(rename_all = "snake_case")]
pub struct TmdbConfig {
    #[setting(validate = url_secure, default = "https://api.themoviedb.org/3/")]
    pub url: String,
    #[setting(
        default = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4ZGVlOTZjMjc0OGVhY2U0NzU2MGJkMWU4YzE5NTljMCIsInN1YiI6IjY0NDRiYmE4MmM2YjdiMDRiZTdlZDJmNSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.ZZZNJMXStvAOPJlT0hOBVPSTppFAK3mcUpmbJsExIq4"
    )]
    pub access_token: String,
}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
pub struct MovieConfig {
    #[setting(nested)]
    pub tmdb: TmdbConfig,
}

impl IsFeatureEnabled for MovieConfig {}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
#[config(rename_all = "snake_case")]
pub struct ListenNotesConfig {
    #[setting(validate = url_secure, default = "https://listen-api.listennotes.com/api/v2/")]
    pub url: String,
    pub api_token: String,
    pub user_agent: String,
}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
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

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
pub struct ShowConfig {
    #[setting(nested)]
    pub tmdb: TmdbConfig,
}

impl IsFeatureEnabled for ShowConfig {}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
#[config(rename_all = "snake_case")]
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

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
#[config(rename_all = "snake_case")]
pub struct IgdbConfig {
    #[setting(validate = url_secure, default = "https://api.igdb.com/v4/")]
    pub url: String,
    #[setting(validate = url_secure, default = "https://images.igdb.com/igdb/image/upload/")]
    pub image_url: String,
    pub image_size: IgdbImageSize,
}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
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

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
#[config(rename_all = "snake_case")]
pub struct SchedulerConfig {
    #[setting(default = "sqlite::memory:")]
    pub database_url: String,
    #[setting(default = 10)]
    pub user_cleanup_every: i32,
}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
#[config(rename_all = "snake_case")]
pub struct UsersConfig {
    #[setting(default = true)]
    pub allow_changing_username: bool,
}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
#[config(rename_all = "snake_case")]
pub struct WebConfig {
    pub cors_origins: Vec<String>,
    pub insecure_cookie: bool,
}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
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

    let result = ConfigLoader::<AppConfig>::json()
        .file_optional(PathBuf::from(config).join(format!("{app}.json")))?
        .load()?;
    dbg!(result.config);

    Figment::new()
        .merge(Serialized::defaults(AppConfig::default()))
        .merge(Json::file(
            PathBuf::from(config).join(format!("{app}.json")),
        ))
        .merge(Toml::file(
            PathBuf::from(config).join(format!("{app}.toml")),
        ))
        .merge(Yaml::file(
            PathBuf::from(config).join(format!("{app}.yaml")),
        ))
        .merge(Env::raw().split("_").only(&["database.url"]))
        .merge(Env::raw().split("__").ignore(&["database.url"]))
        .extract()
        .context("Unable to construct application configuration")
}
