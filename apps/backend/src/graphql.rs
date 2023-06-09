use async_graphql::{
    scalar, Context, EmptySubscription, MergedObject, Object, Schema, SimpleObject,
};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use std::env;

use crate::{
    audio_books::resolver::{AudioBooksMutation, AudioBooksQuery},
    books::resolver::{BooksMutation, BooksQuery},
    config::AppConfig,
    importer::{ImporterMutation, ImporterQuery},
    media::resolver::{MediaMutation, MediaQuery},
    misc::resolver::{MiscMutation, MiscQuery},
    movies::resolver::{MoviesMutation, MoviesQuery},
    podcasts::resolver::{PodcastsMutation, PodcastsQuery},
    shows::resolver::{ShowsMutation, ShowsQuery},
    utils::{AppServices, MemoryDb},
    video_games::resolver::{VideoGamesMutation, VideoGamesQuery},
    VERSION,
};

pub static AUTHOR: &str = "ignisda";
pub static PROJECT_NAME: &str = env!("CARGO_PKG_NAME");
pub static REPOSITORY_LINK: &str = "https://github.com/ignisda/ryot";

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
pub struct Identifier(i32);

impl From<Identifier> for i32 {
    fn from(value: Identifier) -> Self {
        value.0
    }
}

impl From<i32> for Identifier {
    fn from(value: i32) -> Self {
        Self(value)
    }
}

scalar!(Identifier);

#[derive(SimpleObject)]
pub struct CoreDetails {
    version: String,
    author_name: String,
    repository_link: String,
    username_change_allowed: bool,
}

#[derive(Debug, SimpleObject)]
pub struct IdObject {
    pub id: Identifier,
}

#[derive(Default)]
struct CoreQuery;

#[Object]
impl CoreQuery {
    /// Get some primary information about the service
    async fn core_details(&self, gql_ctx: &Context<'_>) -> CoreDetails {
        let config = gql_ctx.data_unchecked::<AppConfig>();
        CoreDetails {
            version: VERSION.to_owned(),
            author_name: AUTHOR.to_owned(),
            repository_link: REPOSITORY_LINK.to_owned(),
            username_change_allowed: config.users.allow_changing_username,
        }
    }
}

#[derive(MergedObject, Default)]
pub struct QueryRoot(
    CoreQuery,
    BooksQuery,
    MediaQuery,
    MoviesQuery,
    ShowsQuery,
    VideoGamesQuery,
    AudioBooksQuery,
    MiscQuery,
    ImporterQuery,
    PodcastsQuery,
);

#[derive(MergedObject, Default)]
pub struct MutationRoot(
    BooksMutation,
    MediaMutation,
    MoviesMutation,
    ShowsMutation,
    VideoGamesMutation,
    AudioBooksMutation,
    MiscMutation,
    ImporterMutation,
    PodcastsMutation,
);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub async fn get_schema(
    app_services: &AppServices,
    db: DatabaseConnection,
    scdb: MemoryDb,
    config: &AppConfig,
) -> GraphqlSchema {
    Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .data(config.to_owned())
    .data(db)
    .data(scdb)
    .data(app_services.books_service.clone())
    .data(app_services.media_service.clone())
    .data(app_services.movies_service.clone())
    .data(app_services.shows_service.clone())
    .data(app_services.video_games_service.clone())
    .data(app_services.audio_books_service.clone())
    .data(app_services.misc_service.clone())
    .data(app_services.importer_service.clone())
    .data(app_services.podcasts_service.clone())
    .finish()
}
