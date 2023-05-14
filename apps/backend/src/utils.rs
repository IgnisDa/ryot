use apalis::sqlite::SqliteStorage;
use async_graphql::{Context, Error, InputObject, Result, SimpleObject};
use chrono::NaiveDate;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait,
    FromQueryResult, QueryFilter, QuerySelect,
};
use serde::de;
use serde::{Deserialize, Serialize};
use surf::{
    http::headers::{AUTHORIZATION, USER_AGENT},
    Client, Config, Url,
};
use tokio::task::JoinSet;

use crate::audio_books::audible::AudibleService;
use crate::audio_books::resolver::AudioBooksService;
use crate::background::{ImportMedia, UserCreatedJob};
use crate::books::openlibrary::OpenlibraryService;
use crate::books::resolver::BooksService;
use crate::config::AppConfig;
use crate::entities::user_to_metadata;
use crate::graphql::AUTHOR;
use crate::importer::ImporterService;
use crate::media::resolver::MediaService;
use crate::misc::resolver::MiscService;
use crate::movies::{resolver::MoviesService, tmdb::TmdbService as MovieTmdbService};
use crate::podcasts::listennotes::ListennotesService;
use crate::podcasts::resolver::PodcastsService;
use crate::shows::{resolver::ShowsService, tmdb::TmdbService as ShowTmdbService};
use crate::users::resolver::UsersService;
use crate::video_games::igdb::IgdbService;
use crate::video_games::resolver::VideoGamesService;
use crate::{
    entities::{prelude::Token, token},
    GqlCtx,
};

/// All the services that are used by the app
pub struct AppServices {
    pub media_service: MediaService,
    pub openlibrary_service: OpenlibraryService,
    pub books_service: BooksService,
    pub tmdb_movies_service: MovieTmdbService,
    pub movies_service: MoviesService,
    pub tmdb_shows_service: ShowTmdbService,
    pub shows_service: ShowsService,
    pub audible_service: AudibleService,
    pub audio_books_service: AudioBooksService,
    pub igdb_service: IgdbService,
    pub video_games_service: VideoGamesService,
    pub users_service: UsersService,
    pub misc_service: MiscService,
    pub importer_service: ImporterService,
    pub podcasts_service: PodcastsService,
}

pub async fn create_app_services(
    db: DatabaseConnection,
    config: &AppConfig,
    import_media_job: &SqliteStorage<ImportMedia>,
    user_created_job: &SqliteStorage<UserCreatedJob>,
) -> AppServices {
    let media_service = MediaService::new(&db);
    let openlibrary_service = OpenlibraryService::new(&config.books.openlibrary);
    let books_service = BooksService::new(&db, &openlibrary_service, &media_service);
    let tmdb_movies_service = MovieTmdbService::new(&config.movies.tmdb).await;
    let movies_service = MoviesService::new(&db, &tmdb_movies_service, &media_service);
    let tmdb_shows_service = ShowTmdbService::new(&config.shows.tmdb).await;
    let shows_service = ShowsService::new(&db, &tmdb_shows_service, &media_service);
    let audible_service = AudibleService::new(&config.audio_books.audible);
    let audio_books_service = AudioBooksService::new(&db, &audible_service, &media_service);
    let igdb_service = IgdbService::new(&config.video_games).await;
    let video_games_service = VideoGamesService::new(&db, &igdb_service, &media_service);
    let listennotes_service = ListennotesService::new(&config.podcasts).await;
    let podcasts_service = PodcastsService::new(&db, &listennotes_service, &media_service);
    let misc_service = MiscService::new(&db, &media_service);
    let users_service = UsersService::new(&db, &misc_service, user_created_job);
    let importer_service = ImporterService::new(
        &db,
        &audio_books_service,
        &books_service,
        &media_service,
        &misc_service,
        &movies_service,
        &shows_service,
        &video_games_service,
        import_media_job,
    );
    AppServices {
        media_service,
        openlibrary_service,
        books_service,
        tmdb_movies_service,
        movies_service,
        tmdb_shows_service,
        shows_service,
        audible_service,
        audio_books_service,
        igdb_service,
        video_games_service,
        users_service,
        misc_service,
        importer_service,
        podcasts_service,
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
    let db = ctx.data_unchecked::<DatabaseConnection>();
    let token = user_auth_token_from_ctx(ctx)?;
    #[derive(FromQueryResult)]
    struct Model {
        user_id: i32,
    }
    let found_token = Token::find()
        .select_only()
        .column(token::Column::UserId)
        .filter(token::Column::Value.eq(token))
        .into_model::<Model>()
        .one(db)
        .await
        .unwrap();
    match found_token {
        Some(t) => Ok(t.user_id),
        None => Err(Error::new("The auth token was incorrect")),
    }
}

pub fn convert_string_to_date(d: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()
}

pub fn convert_date_to_year(d: &str) -> Option<i32> {
    convert_string_to_date(d).map(|d| d.format("%Y").to_string().parse::<i32>().unwrap())
}

pub async fn get_data_parallely_from_sources<'a, T, F, R>(
    iteree: &'a [T],
    client: &'a Client,
    get_url: F,
) -> Vec<R>
where
    F: Fn(&T) -> String,
    T: Send + Sync + de::DeserializeOwned + 'static,
    R: Send + Sync + de::DeserializeOwned + 'static,
{
    let mut set = JoinSet::new();
    for elm in iteree.iter() {
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

pub mod tmdb {
    use crate::graphql::PROJECT_NAME;

    use super::*;

    pub async fn get_client_config(url: &str, access_token: &str) -> (Client, String) {
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
        let mut rsp = client.get("configuration").await.unwrap();
        let data: TmdbConfiguration = rsp.body_json().await.unwrap();
        (client, data.images.secure_base_url)
    }
}

pub mod listennotes {
    use std::collections::HashMap;

    use super::*;

    pub async fn get_client_config(
        url: &str,
        api_token: &str,
        user_agent: &str,
    ) -> (Client, HashMap<i32, String>) {
        let client: Client = Config::new()
            .add_header("X-ListenAPI-Key", api_token)
            .unwrap()
            .add_header(USER_AGENT, user_agent)
            .unwrap()
            .set_base_url(Url::parse(url).unwrap())
            .try_into()
            .unwrap();
        #[derive(Debug, Serialize, Deserialize)]
        struct Genre {
            id: i32,
            name: String,
        }
        #[derive(Debug, Serialize, Deserialize)]
        struct GenreResponse {
            genres: Vec<Genre>,
        }
        let mut rsp = client.get("genres").await.unwrap();
        let data: GenreResponse = rsp.body_json().await.unwrap();
        let mut genres = HashMap::new();
        for genre in data.genres {
            genres.insert(genre.id, genre.name);
        }
        (client, genres)
    }
}

pub mod igdb {
    use serde_json::json;

    use crate::graphql::PROJECT_NAME;

    use super::*;

    pub async fn get_client_config(
        twitch_base_url: &str,
        twitch_client_id: &str,
        twitch_client_secret: &str,
        igdb_base_url: &str,
    ) -> Client {
        let mut access_res = surf::post(twitch_base_url)
            .query(&json!({
                "client_id": twitch_client_id.to_owned(),
                "client_secret": twitch_client_secret.to_owned(),
                "grant_type": "client_credentials".to_owned(),
            }))
            .unwrap()
            .await
            .unwrap();
        #[derive(Deserialize, Serialize, Default)]
        struct AccessResponse {
            access_token: String,
            token_type: String,
        }
        let access = access_res
            .body_json::<AccessResponse>()
            .await
            .unwrap_or_default();
        let client: Client = Config::new()
            .add_header("Client-ID", twitch_client_id)
            .unwrap()
            .add_header(USER_AGENT, format!("{}/{}", AUTHOR, PROJECT_NAME))
            .unwrap()
            .add_header(
                AUTHORIZATION,
                format!("{} {}", access.token_type, access.access_token),
            )
            .unwrap()
            .set_base_url(Url::parse(igdb_base_url).unwrap())
            .try_into()
            .unwrap();
        client
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
