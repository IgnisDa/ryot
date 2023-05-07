use async_graphql::{Context, EmptySubscription, MergedObject, Object, Schema, SimpleObject};
use sea_orm::DatabaseConnection;
use std::env;

use crate::{
    audio_books::{
        audible::AudibleService,
        resolver::{AudioBooksMutation, AudioBooksQuery, AudioBooksService},
    },
    books::{
        openlibrary::OpenlibraryService,
        resolver::{BooksMutation, BooksQuery, BooksService},
    },
    config::{AppConfig, IsFeatureEnabled},
    media::resolver::{MediaMutation, MediaQuery, MediaService},
    migrator::MetadataLot,
    movies::{
        resolver::{MoviesMutation, MoviesQuery, MoviesService},
        tmdb::TmdbService as MovieTmdbService,
    },
    reviews::resolver::{ReviewsMutation, ReviewsQuery, ReviewsService},
    shows::{
        resolver::{ShowsMutation, ShowsQuery, ShowsService},
        tmdb::TmdbService as ShowTmdbService,
    },
    users::resolver::{UsersMutation, UsersQuery, UsersService},
    video_games::{
        igdb::IgdbService,
        resolver::{VideoGamesMutation, VideoGamesQuery, VideoGamesService},
    },
};

pub static VERSION: &str = env!("CARGO_PKG_VERSION");
pub static AUTHOR: &str = "ignisda";

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
    ReviewsQuery,
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
    ReviewsMutation,
);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub async fn get_schema(db: DatabaseConnection, config: &AppConfig) -> GraphqlSchema {
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
    let users_service = UsersService::new(&db);
    let reviews_service = ReviewsService::new(&db);
    Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .data(config.to_owned())
    .data(db)
    .data(books_service)
    .data(media_service)
    .data(movies_service)
    .data(shows_service)
    .data(users_service)
    .data(video_games_service)
    .data(audio_books_service)
    .data(reviews_service)
    .finish()
}
