use async_graphql::{Context, EmptySubscription, MergedObject, Object, Schema, SimpleObject};
use sea_orm::DatabaseConnection;
use std::env;

use crate::{
    audio_books::resolver::{AudioBooksMutation, AudioBooksQuery},
    books::resolver::{BooksMutation, BooksQuery},
    config::{AppConfig, IsFeatureEnabled},
    importer::{ImporterMutation, ImporterQuery},
    media::resolver::{MediaMutation, MediaQuery},
    migrator::MetadataLot,
    misc::resolver::{MiscMutation, MiscQuery},
    movies::resolver::{MoviesMutation, MoviesQuery},
    shows::resolver::{ShowsMutation, ShowsQuery},
    users::resolver::{UsersMutation, UsersQuery},
    utils::AppServices,
    video_games::resolver::{VideoGamesMutation, VideoGamesQuery},
};

pub static VERSION: &str = env!("CARGO_PKG_VERSION");
pub static AUTHOR: &str = "ignisda";
pub static PROJECT_NAME: &str = env!("CARGO_PKG_NAME");

#[derive(SimpleObject)]
pub struct CoreFeatureEnabled {
    name: MetadataLot,
    enabled: bool,
}

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
    /// Get all the features that are enabled for the service
    async fn core_enabled_features(&self, gql_ctx: &Context<'_>) -> Vec<CoreFeatureEnabled> {
        let config = gql_ctx.data_unchecked::<AppConfig>();
        let feats: [(MetadataLot, &dyn IsFeatureEnabled); 5] = [
            (MetadataLot::Book, &config.books),
            (MetadataLot::Movie, &config.movies),
            (MetadataLot::Show, &config.shows),
            (MetadataLot::VideoGame, &config.video_games),
            (MetadataLot::AudioBook, &config.audio_books),
        ];
        feats
            .into_iter()
            .map(|f| CoreFeatureEnabled {
                name: f.0,
                enabled: f.1.is_enabled(),
            })
            .collect()
    }

    /// Get some primary information about the service
    async fn core_details(&self, _gql_ctx: &Context<'_>) -> CoreDetails {
        CoreDetails {
            version: VERSION.to_owned(),
            author_name: AUTHOR.to_owned(),
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
    UsersQuery,
    AudioBooksQuery,
    MiscQuery,
    ImporterQuery,
);

#[derive(MergedObject, Default)]
pub struct MutationRoot(
    UsersMutation,
    BooksMutation,
    MediaMutation,
    MoviesMutation,
    ShowsMutation,
    VideoGamesMutation,
    AudioBooksMutation,
    MiscMutation,
    ImporterMutation,
);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub async fn get_schema(
    app_services: &AppServices,
    db: DatabaseConnection,
    config: &AppConfig,
) -> GraphqlSchema {
    Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .data(config.to_owned())
    .data(db)
    .data(app_services.books_service.clone())
    .data(app_services.media_service.clone())
    .data(app_services.movies_service.clone())
    .data(app_services.shows_service.clone())
    .data(app_services.users_service.clone())
    .data(app_services.video_games_service.clone())
    .data(app_services.audio_books_service.clone())
    .data(app_services.misc_service.clone())
    .data(app_services.importer_service.clone())
    .finish()
}
