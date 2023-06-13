use std::fs::File;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Result as AnyhowResult};
use apalis::sqlite::SqliteStorage;
use async_graphql::{Context, Error, InputObject, Result, SimpleObject};
use chrono::NaiveDate;
use scdb::Store;
use sea_orm::{ActiveModelTrait, ActiveValue, ConnectionTrait, DatabaseConnection};
use serde::de::{self, DeserializeOwned};
use serde::{Deserialize, Serialize};
use surf::{
    http::headers::{AUTHORIZATION, USER_AGENT},
    Client, Config, Url,
};
use tokio::task::JoinSet;

use crate::audio_books::audible::AudibleService;

use crate::background::{
    AfterMediaSeenJob, ImportMedia, RecalculateUserSummaryJob, UpdateMetadataJob, UserCreatedJob,
};
use crate::books::openlibrary::OpenlibraryService;
use crate::config::AppConfig;
use crate::entities::user_to_metadata;
use crate::graphql::AUTHOR;
use crate::importer::ImporterService;
use crate::media::resolver::MediaService;
use crate::movies::tmdb::TmdbService as MovieTmdbService;
use crate::podcasts::listennotes::ListennotesService;
use crate::shows::tmdb::TmdbService as ShowTmdbService;
use crate::video_games::igdb::IgdbService;
use crate::GqlCtx;

pub type MemoryDb = Arc<Mutex<Store>>;

/// All the services that are used by the app
pub struct AppServices {
    pub media_service: MediaService,
    pub openlibrary_service: OpenlibraryService,
    pub tmdb_movies_service: MovieTmdbService,
    pub tmdb_shows_service: ShowTmdbService,
    pub audible_service: AudibleService,
    pub igdb_service: IgdbService,
    pub importer_service: ImporterService,
}

#[allow(clippy::too_many_arguments)]
pub async fn create_app_services(
    db: DatabaseConnection,
    scdb: MemoryDb,
    s3_client: aws_sdk_s3::Client,
    config: &AppConfig,
    import_media_job: &SqliteStorage<ImportMedia>,
    user_created_job: &SqliteStorage<UserCreatedJob>,
    after_media_seen_job: &SqliteStorage<AfterMediaSeenJob>,
    update_metadata_job: &SqliteStorage<UpdateMetadataJob>,
    recalculate_user_summary_job: &SqliteStorage<RecalculateUserSummaryJob>,
) -> AppServices {
    let openlibrary_service = OpenlibraryService::new(&config.books.openlibrary);
    let tmdb_movies_service = MovieTmdbService::new(&config.movies.tmdb).await;
    let tmdb_shows_service = ShowTmdbService::new(&config.shows.tmdb).await;
    let audible_service = AudibleService::new(&config.audio_books.audible);
    let igdb_service = IgdbService::new(&config.video_games).await;
    let listennotes_service = ListennotesService::new(&config.podcasts).await;

    let media_service = MediaService::new(
        &db,
        &scdb,
        &s3_client,
        &config.file_storage.s3_bucket_name,
        &audible_service,
        &igdb_service,
        &listennotes_service,
        &openlibrary_service,
        &tmdb_movies_service,
        &tmdb_shows_service,
        after_media_seen_job,
        update_metadata_job,
        recalculate_user_summary_job,
        user_created_job,
    );
    let importer_service = ImporterService::new(&db, &media_service, import_media_job);
    AppServices {
        media_service,
        openlibrary_service,
        tmdb_movies_service,
        tmdb_shows_service,
        audible_service,
        igdb_service,
        importer_service,
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, SimpleObject, InputObject)]
#[graphql(input_name = "NamedObjectInput")]
pub struct NamedObject {
    pub name: String,
}

pub async fn associate_user_with_metadata<C>(user_id: &i32, metadata_id: &i32, db: &C) -> Result<()>
where
    C: ConnectionTrait,
{
    let user_to_meta = user_to_metadata::ActiveModel {
        user_id: ActiveValue::Set(*user_id),
        metadata_id: ActiveValue::Set(*metadata_id),
        ..Default::default()
    };
    user_to_meta.insert(db).await.ok();
    Ok(())
}

pub fn user_auth_token_from_ctx(ctx: &Context<'_>) -> Result<String> {
    let ctx = ctx.data_unchecked::<GqlCtx>();
    ctx.auth_token
        .clone()
        .ok_or_else(|| Error::new("The auth token is not present".to_owned()))
}

pub async fn user_id_from_ctx(ctx: &Context<'_>) -> Result<i32> {
    let scdb = ctx.data_unchecked::<MemoryDb>();
    let token = user_auth_token_from_ctx(ctx)?;
    user_id_from_token(token, scdb)
}

pub fn user_id_from_token(token: String, scdb: &MemoryDb) -> Result<i32> {
    let found_token = scdb.lock().unwrap().get(token.as_bytes());
    match found_token {
        Ok(tk) => match tk {
            Some(t) => Ok(std::str::from_utf8(&t).unwrap().parse().unwrap()),
            None => Err(Error::new("The auth token was incorrect")),
        },
        Err(e) => {
            tracing::error!("{:?}", e);
            Err(Error::new("Error getting auth token"))
        }
    }
}

pub fn convert_string_to_date(d: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()
}

pub fn convert_date_to_year(d: &str) -> Option<i32> {
    convert_string_to_date(d).map(|d| d.format("%Y").to_string().parse::<i32>().unwrap())
}

pub async fn get_data_parallelly_from_sources<'a, T, F, R>(
    iterate_over: &'a [T],
    client: &'a Client,
    get_url: F,
) -> Vec<R>
where
    F: Fn(&T) -> String,
    T: Send + Sync + de::DeserializeOwned + 'static,
    R: Send + Sync + de::DeserializeOwned + 'static,
{
    let mut set = JoinSet::new();
    for elm in iterate_over.iter() {
        let client = client.clone();
        let url = get_url(elm);
        set.spawn(async move {
            let mut rsp = client.get(url).await.unwrap();
            let single_element: R = rsp.body_json().await.unwrap();
            single_element
        });
    }
    let mut data = vec![];
    while let Some(Ok(result)) = set.join_next().await {
        data.push(result);
    }
    data
}

fn read_file_to_json<T: DeserializeOwned>(path: &PathBuf) -> Option<T> {
    let mut file = File::open(path).ok()?;
    let mut data = String::new();
    file.read_to_string(&mut data).unwrap();
    serde_json::from_str::<T>(&data).ok()
}

fn get_now_timestamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards")
        .as_millis()
}

pub mod tmdb {
    use std::{env, fs};

    use crate::graphql::PROJECT_NAME;

    use super::*;

    #[derive(Debug, Serialize, Deserialize, Clone)]
    pub struct TmdbCredit {
        pub name: Option<String>,
        pub known_for_department: Option<String>,
        pub profile_path: Option<String>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone)]
    pub struct TmdbImage {
        pub file_path: String,
    }

    #[derive(Debug, Serialize, Deserialize, Clone)]
    pub struct TmdbImagesResponse {
        pub backdrops: Option<Vec<TmdbImage>>,
        pub posters: Option<Vec<TmdbImage>>,
    }

    pub async fn get_client_config(url: &str, access_token: &str) -> (Client, String) {
        let path = env::temp_dir().join("tmdb-config.json");
        let client: Client = Config::new()
            .add_header(USER_AGENT, format!("{}/{}", AUTHOR, PROJECT_NAME))
            .unwrap()
            .add_header(AUTHORIZATION, format!("Bearer {access_token}"))
            .unwrap()
            .set_base_url(Url::parse(url).unwrap())
            .try_into()
            .unwrap();
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbImageConfiguration {
            secure_base_url: String,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbConfiguration {
            images: TmdbImageConfiguration,
        }
        let image_url = if let Some(details) = read_file_to_json::<TmdbConfiguration>(&path) {
            details.images.secure_base_url
        } else {
            let mut rsp = client.get("configuration").await.unwrap();
            let data: TmdbConfiguration = rsp.body_json().await.unwrap();
            fs::write(path, serde_json::to_string(&data).unwrap()).ok();
            data.images.secure_base_url
        };
        (client, image_url)
    }

    pub async fn save_all_images(
        client: &Client,
        typ: &str,
        identifier: &str,
        images: &mut Vec<String>,
    ) -> AnyhowResult<()> {
        let mut rsp = client
            .get(format!("{}/{}/images", typ, identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let new_images: TmdbImagesResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        if let Some(imgs) = new_images.posters {
            for image in imgs {
                images.push(image.file_path);
            }
        }
        if let Some(imgs) = new_images.backdrops {
            for image in imgs {
                images.push(image.file_path);
            }
        }
        Ok(())
    }
}

pub mod listennotes {
    use std::collections::HashMap;

    use crate::graphql::PROJECT_NAME;

    use super::*;

    pub async fn get_client_config(url: &str, api_token: &str) -> (Client, HashMap<i32, String>) {
        let client: Client = Config::new()
            .add_header("X-ListenAPI-Key", api_token)
            .unwrap()
            .add_header(USER_AGENT, format!("{}/{}", AUTHOR, PROJECT_NAME))
            .unwrap()
            .set_base_url(Url::parse(url).unwrap())
            .try_into()
            .unwrap();
        #[derive(Debug, Serialize, Deserialize, Default)]
        struct Genre {
            id: i32,
            name: String,
        }
        #[derive(Debug, Serialize, Deserialize, Default)]
        struct GenreResponse {
            genres: Vec<Genre>,
        }
        let mut rsp = client.get("genres").await.unwrap();
        let data: GenreResponse = rsp.body_json().await.unwrap_or_default();
        let mut genres = HashMap::new();
        for genre in data.genres {
            genres.insert(genre.id, genre.name);
        }
        (client, genres)
    }
}

pub mod igdb {
    use std::{env, fs};

    use serde_json::json;

    use super::*;
    use crate::{config::VideoGameConfig, graphql::PROJECT_NAME};

    #[derive(Deserialize, Debug, Serialize)]
    struct Credentials {
        access_token: String,
        expires_at: u128,
    }

    async fn get_access_token(config: &VideoGameConfig) -> Credentials {
        let mut access_res = surf::post(&config.twitch.access_token_url)
            .query(&json!({
                "client_id": config.twitch.client_id.to_owned(),
                "client_secret": config.twitch.client_secret.to_owned(),
                "grant_type": "client_credentials".to_owned(),
            }))
            .unwrap()
            .await
            .unwrap();
        #[derive(Deserialize, Serialize, Default, Debug)]
        struct AccessResponse {
            access_token: String,
            token_type: String,
            expires_in: u128,
        }
        let access = access_res
            .body_json::<AccessResponse>()
            .await
            .unwrap_or_default();
        let expires_at = get_now_timestamp() + (access.expires_in * 1000);
        let access_token = format!("{} {}", access.token_type, access.access_token);
        Credentials {
            access_token,
            expires_at,
        }
    }

    // Ideally, I want this to use a mutex to store the client and expiry time.
    // However for the time being we will read and write to a file.
    pub async fn get_client(config: &VideoGameConfig) -> Client {
        let path = env::temp_dir().join("igdb-credentials.json");
        let access_token =
            if let Some(mut credential_details) = read_file_to_json::<Credentials>(&path) {
                if credential_details.expires_at < get_now_timestamp() {
                    tracing::info!("Access token has expired, refreshing...");
                    credential_details = get_access_token(config).await;
                    fs::write(path, serde_json::to_string(&credential_details).unwrap()).ok();
                }
                credential_details.access_token
            } else {
                let creds = get_access_token(config).await;
                fs::write(path, serde_json::to_string(&creds).unwrap()).ok();
                creds.access_token
            };
        Config::new()
            .add_header("Client-ID", config.twitch.client_id.to_owned())
            .unwrap()
            .add_header(USER_AGENT, format!("{}/{}", AUTHOR, PROJECT_NAME))
            .unwrap()
            .add_header(AUTHORIZATION, access_token)
            .unwrap()
            .set_base_url(Url::parse(&config.igdb.url).unwrap())
            .try_into()
            .unwrap()
    }
}

pub mod openlibrary {
    pub fn get_key(key: &str) -> String {
        key.split('/')
            .collect::<Vec<_>>()
            .last()
            .cloned()
            .unwrap()
            .to_owned()
    }
}
