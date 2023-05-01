use async_graphql::{Context, EmptySubscription, MergedObject, Object, Schema, SimpleObject};
use sea_orm::DatabaseConnection;
use std::env;

use crate::{
    books::{
        openlibrary::OpenlibraryService,
        resolver::{BooksMutation, BooksQuery, BooksService},
    },
    config::AppConfig,
    media::resolver::{MediaMutation, MediaQuery, MediaService},
    movies::{
        resolver::{MoviesMutation, MoviesQuery, MoviesService},
        tmdb::TmdbService as MovieTmdbService,
    },
    shows::{
        resolver::{ShowsMutation, ShowsQuery, ShowsService},
        tmdb::TmdbService as ShowTmdbService,
    },
    users::resolver::{UsersMutation, UsersService},
};

pub static VERSION: &str = env!("CARGO_PKG_VERSION");
pub static AUTHOR: &str = "ignisda";

#[derive(SimpleObject)]
pub struct CoreDetails {
    version: String,
    author_name: String,
}

#[derive(Debug, SimpleObject)]
pub struct IdObject {
    pub id: i32,
}

#[derive(Default)]
struct CoreQuery;

#[Object]
impl CoreQuery {
    /// Get some primary information about the service
    async fn core_details(&self, _gql_ctx: &Context<'_>) -> CoreDetails {
        CoreDetails {
            version: VERSION.to_owned(),
            author_name: AUTHOR.to_owned(),
        }
    }
}

#[derive(MergedObject, Default)]
pub struct QueryRoot(CoreQuery, BooksQuery, MediaQuery, MoviesQuery, ShowsQuery);

#[derive(MergedObject, Default)]
pub struct MutationRoot(
    UsersMutation,
    BooksMutation,
    MediaMutation,
    MoviesMutation,
    ShowsMutation,
);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub async fn get_schema(db: DatabaseConnection, config: &AppConfig) -> GraphqlSchema {
    let media_service = MediaService::new(&db);
    let openlibrary_service = OpenlibraryService::new(
        &config.books.openlibrary.url,
        &config.books.openlibrary.cover_image_url,
        &config.books.openlibrary.cover_image_size.to_string(),
    );
    let books_service = BooksService::new(&db, &openlibrary_service, &media_service);
    let tmdb_movies_service =
        MovieTmdbService::new(&config.movies.tmdb.url, &config.movies.tmdb.access_token).await;
    let movies_service = MoviesService::new(&db, &tmdb_movies_service, &media_service);
    let tmdb_shows_service =
        ShowTmdbService::new(&config.shows.tmdb.url, &config.shows.tmdb.access_token).await;
    let shows_service = ShowsService::new(&db, &tmdb_shows_service, &media_service);
    let users_service = UsersService::new(&db);
    Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .data(db)
    .data(books_service)
    .data(media_service)
    .data(movies_service)
    .data(shows_service)
    .data(users_service)
    .finish()
}
