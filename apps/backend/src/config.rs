use std::path::PathBuf;

use anyhow::Result;
use schematic::{derive_enum, Config, ConfigEnum, ConfigLoader, ValidateError};
use serde::{Deserialize, Serialize};

use crate::{
    graphql::PROJECT_NAME,
    providers::{audible::AudibleService, itunes::ITunesService, tmdb::TmdbService},
    traits::MediaProviderLanguages,
};

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
#[config(rename_all = "snake_case", env_prefix = "ANIME_ANILIST_")]
pub struct AnimeAnilistConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
pub struct AnimeConfig {
    #[setting(nested)]
    pub anilist: AnimeAnilistConfig,
}

impl IsFeatureEnabled for AnimeConfig {}

fn validate_audible_locale(
    value: &str,
    _partial: &PartialAudibleConfig,
    _context: &(),
) -> Result<(), ValidateError> {
    if !AudibleService::supported_languages().contains(&value.to_owned()) {
        return Err(ValidateError::new(format!(
            "Audible does not support this locale: {:?}",
            value
        )));
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "AUDIO_BOOKS_AUDIBLE_")]
pub struct AudibleConfig {
    #[setting(validate = validate_audible_locale, default = AudibleService::default_language())]
    pub locale: String,
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
#[config(rename_all = "snake_case", env_prefix = "BOOKS_GOOGLE_BOOKS_")]
pub struct GoogleBooksConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "BOOKS_OPENLIBRARY_")]
pub struct OpenlibraryConfig {
    pub cover_image_size: OpenlibraryCoverImageSize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
pub struct BookConfig {
    #[setting(nested)]
    pub openlibrary: OpenlibraryConfig,
    #[setting(nested)]
    pub google_books: GoogleBooksConfig,
}

impl IsFeatureEnabled for BookConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config, PartialEq, Eq)]
#[config(rename_all = "snake_case", env_prefix = "DATABASE_")]
pub struct DatabaseConfig {
    #[setting(default = format!("/data/{}-scdb.db", PROJECT_NAME))]
    pub scdb_url: String,
    #[setting(default = format!("sqlite:/data/{}.db?mode=rwc", PROJECT_NAME))]
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, PartialEq, Eq)]
#[config(rename_all = "snake_case", env_prefix = "EXERCISE_DB_")]
pub struct FreeExerciseDbConfig {
    #[setting(
        default = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json"
    )]
    pub json_url: String,
    #[setting(
        default = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises"
    )]
    pub images_prefix_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config, PartialEq, Eq)]
pub struct ExerciseConfig {
    #[setting(nested)]
    pub db: FreeExerciseDbConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "MEDIA_")]
pub struct MediaConfig {
    #[setting(default = false)]
    pub sort_images: bool,
}

fn validate_tmdb_locale(value: &str) -> Result<(), ValidateError> {
    if !TmdbService::supported_languages().contains(&value.to_owned()) {
        return Err(ValidateError::new(format!(
            "Tmdb does not support this locale: {:?}",
            value
        )));
    }
    Ok(())
}

fn validate_movies_tmdb_locale(
    value: &str,
    _partial: &PartialMoviesTmdbConfig,
    _context: &(),
) -> Result<(), ValidateError> {
    validate_tmdb_locale(value)
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "MOVIES_TMDB_")]
pub struct MoviesTmdbConfig {
    #[setting(default = default_tmdb_access_token)]
    pub access_token: String,
    #[setting(validate = validate_movies_tmdb_locale, default = TmdbService::default_language())]
    pub locale: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
pub struct MovieConfig {
    #[setting(nested)]
    pub tmdb: MoviesTmdbConfig,
}

impl IsFeatureEnabled for MovieConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "MANGA_ANILIST_")]
pub struct MangaAnilistConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
pub struct MangaConfig {
    #[setting(nested)]
    pub anilist: MangaAnilistConfig,
}

impl IsFeatureEnabled for MangaConfig {}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "PODCASTS_LISTENNOTES_")]
pub struct ListenNotesConfig {
    pub api_token: String,
}

fn validate_itunes_locale(
    value: &str,
    _partial: &PartialITunesConfig,
    _context: &(),
) -> Result<(), ValidateError> {
    if !ITunesService::supported_languages().contains(&value.to_owned()) {
        return Err(ValidateError::new(format!(
            "ITunes does not support this locale: {:?}",
            value
        )));
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "PODCASTS_ITUNES_")]
pub struct ITunesConfig {
    #[setting(validate = validate_itunes_locale, default = ITunesService::default_language())]
    pub locale: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
pub struct PodcastConfig {
    #[setting(nested)]
    pub listennotes: ListenNotesConfig,
    #[setting(nested)]
    pub itunes: ITunesConfig,
}

impl IsFeatureEnabled for PodcastConfig {}

fn validate_shows_tmdb_locale(
    value: &str,
    _partial: &PartialShowsTmdbConfig,
    _context: &(),
) -> Result<(), ValidateError> {
    validate_tmdb_locale(value)
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "MOVIES_TMDB_")]
pub struct ShowsTmdbConfig {
    #[setting(default = default_tmdb_access_token)]
    pub access_token: String,
    #[setting(validate = validate_shows_tmdb_locale, default = TmdbService::default_language())]
    pub locale: String,
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
    pub image_size: IgdbImageSize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
pub struct VideoGameConfig {
    #[setting(nested)]
    pub igdb: IgdbConfig,
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
#[config(rename_all = "snake_case", env_prefix = "FILE_STORAGE_")]
pub struct FileStorageConfig {
    pub s3_access_key_id: String,
    pub s3_bucket_name: String,
    #[setting(default = "us-east-1")]
    pub s3_region: String,
    pub s3_secret_access_key: String,
    pub s3_url: String,
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
    #[setting(default = "sqlite::memory:")]
    pub database_url: String,
    #[setting(default = 5)]
    pub rate_limit_num: i32,
    #[setting(default = 12)]
    pub user_cleanup_every: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone, Config)]
#[config(rename_all = "snake_case", env_prefix = "USERS_")]
pub struct UsersConfig {
    #[setting(default = true)]
    pub allow_changing_username: bool,
    #[setting(default = 90)]
    pub token_valid_for_days: i32,
    #[setting(default = true)]
    pub allow_registration: bool,
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
    pub anime: AnimeConfig,
    #[setting(nested)]
    pub audio_books: AudioBookConfig,
    #[setting(nested)]
    pub books: BookConfig,
    #[setting(nested)]
    pub database: DatabaseConfig,
    #[setting(nested)]
    pub exercise: ExerciseConfig,
    #[setting(nested)]
    pub file_storage: FileStorageConfig,
    #[setting(nested)]
    pub manga: MangaConfig,
    #[setting(nested)]
    pub media: MediaConfig,
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
        cl.file_storage.s3_region = gt();
        cl.file_storage.s3_bucket_name = gt();
        cl.file_storage.s3_access_key_id = gt();
        cl.file_storage.s3_secret_access_key = gt();
        cl.file_storage.s3_url = gt();
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
