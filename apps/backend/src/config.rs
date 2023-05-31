use std::path::PathBuf;

use anyhow::{Context, Result};
use figment::{
    providers::{Env, Format, Json, Serialized, Toml, Yaml},
    Figment,
};
use serde::{Deserialize, Serialize};
use strum::Display;

use crate::graphql::{AUTHOR, PROJECT_NAME};

static TMDB_BASE_URL: &str = "https://api.themoviedb.org/3/";

static TMDB_ACCESS_KEY: &str =
"eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4ZGVlOTZjMjc0OGVhY2U0NzU2MGJkMWU4YzE5NTljMCIsInN1YiI6IjY0NDRiYmE4MmM2YjdiMDRiZTdlZDJmNSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.ZZZNJMXStvAOPJlT0hOBVPSTppFAK3mcUpmbJsExIq4";

/// Determine whether a feature is enabled
pub trait IsFeatureEnabled {
    fn is_enabled(&self) -> bool {
        true
    }
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct AudibleConfig {
    pub url: String,
}

impl Default for AudibleConfig {
    fn default() -> Self {
        Self {
            url: "https://api.audible.com/1.0/catalog/products/".to_owned(),
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct AudioBookConfig {
    pub audible: AudibleConfig,
}

impl IsFeatureEnabled for AudioBookConfig {}

#[derive(Deserialize, Debug, Clone, Serialize, Display)]
pub enum OpenlibraryCoverImageSize {
    #[strum(serialize = "S")]
    Small,
    #[strum(serialize = "M")]
    Medium,
    #[strum(serialize = "L")]
    Large,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct OpenlibraryConfig {
    pub url: String,
    pub cover_image_url: String,
    pub cover_image_size: OpenlibraryCoverImageSize,
}

impl Default for OpenlibraryConfig {
    fn default() -> Self {
        Self {
            url: "https://openlibrary.org".to_owned(),
            cover_image_url: "https://covers.openlibrary.org/b".to_owned(),
            cover_image_size: OpenlibraryCoverImageSize::Medium,
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct BookConfig {
    pub openlibrary: OpenlibraryConfig,
}

impl IsFeatureEnabled for BookConfig {}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct DatabaseConfig {
    pub url: String,
    pub scdb_url: String,
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            url: format!("sqlite:/data/{}.db?mode=rwc", PROJECT_NAME),
            scdb_url: format!("/data/{}-scdb.db", PROJECT_NAME),
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct ImporterConfig {}

#[allow(clippy::derivable_impls)]
impl Default for ImporterConfig {
    fn default() -> Self {
        Self {}
    }
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct TmdbConfig {
    pub url: String,
    pub access_token: String,
}

impl Default for TmdbConfig {
    fn default() -> Self {
        Self {
            url: TMDB_BASE_URL.to_owned(),
            access_token: TMDB_ACCESS_KEY.to_owned(),
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct MovieConfig {
    pub tmdb: TmdbConfig,
}

impl IsFeatureEnabled for MovieConfig {}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct ListenNotesConfig {
    pub url: String,
    pub api_token: String,
    pub user_agent: String,
}

impl Default for ListenNotesConfig {
    fn default() -> Self {
        Self {
            url: "https://listen-api.listennotes.com/api/v2/".to_owned(),
            api_token: "".to_owned(),
            user_agent: format!("{}/{}", AUTHOR, PROJECT_NAME),
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct PodcastConfig {
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

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct ShowConfig {
    pub tmdb: TmdbConfig,
}

impl IsFeatureEnabled for ShowConfig {}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct TwitchConfig {
    pub client_id: String,
    pub client_secret: String,
    // Endpoint used to get access tokens which will be used by IGDB
    pub access_token_url: String,
}

impl Default for TwitchConfig {
    fn default() -> Self {
        Self {
            client_id: "".to_owned(),
            client_secret: "".to_owned(),
            access_token_url: "https://id.twitch.tv/oauth2/token".to_owned(),
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Display)]
pub enum IgdbImageSize {
    #[strum(serialize = "t_original")]
    Original,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct IgdbConfig {
    pub url: String,
    pub image_url: String,
    pub image_size: IgdbImageSize,
}

impl Default for IgdbConfig {
    fn default() -> Self {
        Self {
            url: "https://api.igdb.com/v4/".to_owned(),
            image_url: "https://images.igdb.com/igdb/image/upload/".to_owned(),
            image_size: IgdbImageSize::Original,
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct VideoGameConfig {
    pub twitch: TwitchConfig,
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

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct SchedulerConfig {
    pub database_url: String,
    pub user_cleanup_every: i32,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            database_url: "sqlite::memory:".to_string(),
            user_cleanup_every: 10,
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct UsersConfig {
    pub allow_changing_username: bool,
    pub token_valid_for_days: i32,
}

impl Default for UsersConfig {
    fn default() -> Self {
        Self {
            allow_changing_username: true,
            token_valid_for_days: 90,
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct WebConfig {
    pub cors_origins: Vec<String>,
    pub insecure_cookie: bool,
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct AppConfig {
    #[serde(default)]
    pub audio_books: AudioBookConfig,
    #[serde(default)]
    pub books: BookConfig,
    #[serde(default)]
    pub database: DatabaseConfig,
    #[serde(default)]
    pub importer: ImporterConfig,
    #[serde(default)]
    pub movies: MovieConfig,
    #[serde(default)]
    pub podcasts: PodcastConfig,
    #[serde(default)]
    pub scheduler: SchedulerConfig,
    #[serde(default)]
    pub shows: ShowConfig,
    #[serde(default)]
    pub users: UsersConfig,
    #[serde(default)]
    pub video_games: VideoGameConfig,
    #[serde(default)]
    pub web: WebConfig,
}

impl AppConfig {
    // TODO: Denote masked values via attribute
    pub fn masked_value(&self) -> Self {
        let gt = || "****".to_owned();
        let mut cl = self.clone();
        cl.database.url = gt();
        cl.movies.tmdb.access_token = gt();
        cl.podcasts.listennotes.api_token = gt();
        cl.shows.tmdb.access_token = gt();
        cl.video_games.twitch.client_id = gt();
        cl.video_games.twitch.client_secret = gt();
        cl
    }
}

pub fn get_app_config() -> Result<AppConfig> {
    let config = "config";
    let app = PROJECT_NAME;

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
