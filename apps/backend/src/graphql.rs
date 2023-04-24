use async_graphql::{
    Context, EmptySubscription, MergedObject, Object, Result, Schema, SimpleObject,
};
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
        tmdb::TmdbService,
    },
    users::resolver::{UsersMutation, UsersService},
};

#[derive(Debug, SimpleObject)]
pub struct IdObject {
    pub id: i32,
}

#[derive(Default)]
struct CoreQuery;

#[Object]
impl CoreQuery {
    /// Get the version of the service running.
    async fn version(&self, _gql_ctx: &Context<'_>) -> Result<String> {
        Ok(env!("CARGO_PKG_VERSION").to_owned())
    }
}

#[derive(MergedObject, Default)]
pub struct QueryRoot(CoreQuery, BooksQuery, MediaQuery, MoviesQuery);

#[derive(MergedObject, Default)]
pub struct MutationRoot(UsersMutation, BooksMutation, MediaMutation, MoviesMutation);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub async fn get_schema(db: DatabaseConnection, config: &AppConfig) -> GraphqlSchema {
    let media_service = MediaService::new(&db);
    let openlibrary_service = OpenlibraryService::new(
        &config.books.openlibrary.url,
        &config.books.openlibrary.cover_image,
        &config.books.openlibrary.cover_image_size.to_string(),
    );
    let books_service = BooksService::new(&db, &openlibrary_service, &media_service);
    let tmdb_service =
        TmdbService::new(&config.movies.tmdb.url, &config.movies.tmdb.access_token).await;
    let movies_service = MoviesService::new(&db, &tmdb_service, &media_service);
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
    .data(users_service)
    .finish()
}
