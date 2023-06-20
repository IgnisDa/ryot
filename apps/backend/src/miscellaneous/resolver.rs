use std::{collections::HashSet, sync::Arc, time::Duration};

use apalis::{prelude::Storage, sqlite::SqliteStorage};
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use async_graphql::{Context, Enum, Error, InputObject, Object, Result, SimpleObject, Union};
use aws_sdk_s3::presigning::PresigningConfig;
use chrono::{Duration as ChronoDuration, NaiveDate, Utc};
use cookie::{time::Duration as CookieDuration, time::OffsetDateTime, Cookie};
use futures::TryStreamExt;
use http::header::SET_COOKIE;
use rust_decimal::Decimal;
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, ActiveValue, ColumnTrait, ConnectionTrait,
    DatabaseBackend, DatabaseConnection, EntityTrait, FromJsonQueryResult, FromQueryResult, Iden,
    JoinType, ModelTrait, Order, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Statement,
};
use sea_query::{
    Alias, Cond, Expr, Func, Keyword, MySqlQueryBuilder, NullOrdering, OrderedStatement,
    PostgresQueryBuilder, Query, SelectStatement, SqliteQueryBuilder, UnionType, Values,
};
use serde::{Deserialize, Serialize};
use strum::IntoEnumIterator;
use uuid::Uuid;

use crate::{
    background::{AfterMediaSeenJob, RecalculateUserSummaryJob, UpdateMetadataJob, UserCreatedJob},
    config::{AppConfig, IsFeatureEnabled},
    entities::{
        collection, genre, media_import_report, metadata, metadata_to_collection,
        metadata_to_genre,
        prelude::{
            Collection, Genre, MediaImportReport, Metadata, MetadataToCollection, Review, Seen,
            Summary, User, UserToMetadata,
        },
        review, seen, summary, user, user_to_metadata,
        utils::{SeenExtraInformation, SeenPodcastExtraInformation, SeenShowExtraInformation},
    },
    graphql::{IdObject, Identifier},
    importer::ImportResultResponse,
    migrator::{
        MediaImportSource, MetadataImageLot, MetadataLot, MetadataSource, ReviewVisibility, UserLot,
    },
    models::{
        AnimeSpecifics, AudioBookSpecifics, BookSpecifics, MangaSpecifics, MovieSpecifics,
        PodcastSpecifics, ShowSpecifics, VideoGameSpecifics,
    },
    providers::{
        anilist::{AnilistAnimeService, AnilistMangaService},
        audible::AudibleService,
        igdb::IgdbService,
        listennotes::ListennotesService,
        openlibrary::OpenlibraryService,
        tmdb::{TmdbMovieService, TmdbShowService},
    },
    traits::MediaProvider,
    utils::{user_auth_token_from_ctx, user_id_from_ctx, MemoryDb, NamedObject},
};

use super::{
    DefaultCollection, MediaSpecifics, MetadataCreator, MetadataCreators, MetadataImage,
    MetadataImageUrl, MetadataImages, PAGE_LIMIT,
};

type ProviderArc = Arc<(dyn MediaProvider + Send + Sync)>;

pub static COOKIE_NAME: &str = "auth";

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct CreateCustomMediaInput {
    pub title: String,
    pub lot: MetadataLot,
    pub description: Option<String>,
    pub creators: Option<Vec<String>>,
    pub genres: Option<Vec<String>>,
    pub images: Option<Vec<String>>,
    pub publish_year: Option<i32>,
    pub audio_book_specifics: Option<AudioBookSpecifics>,
    pub book_specifics: Option<BookSpecifics>,
    pub movie_specifics: Option<MovieSpecifics>,
    pub podcast_specifics: Option<PodcastSpecifics>,
    pub show_specifics: Option<ShowSpecifics>,
    pub video_game_specifics: Option<VideoGameSpecifics>,
    pub manga_specifics: Option<MangaSpecifics>,
    pub anime_specifics: Option<AnimeSpecifics>,
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
enum CreateCustomMediaErrorVariant {
    LotDoesNotMatchSpecifics,
}

#[derive(Debug, SimpleObject)]
struct CreateCustomMediaError {
    error: CreateCustomMediaErrorVariant,
}

#[derive(Union)]
enum CreateCustomMediaResult {
    Ok(IdObject),
    Error(CreateCustomMediaError),
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
pub enum UserDetailsErrorVariant {
    AuthTokenInvalid,
}

#[derive(Debug, SimpleObject)]
pub struct UserDetailsError {
    error: UserDetailsErrorVariant,
}

#[derive(Union)]
pub enum UserDetailsResult {
    Ok(user::Model),
    Error(UserDetailsError),
}

#[derive(Debug, InputObject)]
struct UserInput {
    username: String,
    #[graphql(secret)]
    password: String,
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
enum RegisterErrorVariant {
    UsernameAlreadyExists,
    Disabled,
}

#[derive(Debug, SimpleObject)]
struct RegisterError {
    error: RegisterErrorVariant,
}

#[derive(Union)]
enum RegisterResult {
    Ok(IdObject),
    Error(RegisterError),
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
enum LoginErrorVariant {
    UsernameDoesNotExist,
    CredentialsMismatch,
    MutexError,
}

#[derive(Debug, SimpleObject)]
struct LoginError {
    error: LoginErrorVariant,
}

#[derive(Debug, SimpleObject)]
struct LoginResponse {
    api_key: String,
}

#[derive(Union)]
enum LoginResult {
    Ok(LoginResponse),
    Error(LoginError),
}

#[derive(Debug, InputObject)]
struct UpdateUserInput {
    username: Option<String>,
    email: Option<String>,
    #[graphql(secret)]
    password: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportMedia {
    ryot_id: i32,
    title: String,
    #[serde(rename = "type")]
    lot: MetadataLot,
    audible_id: Option<String>,
    custom_id: Option<String>,
    igdb_id: Option<String>,
    listennotes_id: Option<String>,
    openlibrary_id: Option<String>,
    tmdb_id: Option<String>,
    anilist_id: Option<String>,
    seen_history: Vec<seen::Model>,
    user_reviews: Vec<review::Model>,
}

#[derive(Debug, InputObject)]
struct UpdateUserPreferencesInput {
    property: MetadataLot,
    value: bool,
}

fn create_cookie(
    ctx: &Context<'_>,
    api_key: &str,
    expires: bool,
    insecure_cookie: bool,
    token_valid_till: i32,
) -> Result<()> {
    let mut cookie = Cookie::build(COOKIE_NAME, api_key.to_string()).secure(!insecure_cookie);
    cookie = if expires {
        cookie.expires(OffsetDateTime::now_utc())
    } else {
        cookie.expires(
            OffsetDateTime::now_utc().checked_add(CookieDuration::days(token_valid_till.into())),
        )
    };
    let cookie = cookie.finish();
    ctx.insert_http_header(SET_COOKIE, cookie.to_string());
    Ok(())
}

fn get_hasher() -> Argon2<'static> {
    Argon2::default()
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct AudioBooksSummary {
    runtime: i32,
    played: i32,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct VideoGamesSummary {
    played: i32,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct BooksSummary {
    pages: i32,
    read: i32,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct MoviesSummary {
    runtime: i32,
    watched: i32,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct PodcastsSummary {
    runtime: i32,
    played: i32,
    played_episodes: i32,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct ShowsSummary {
    runtime: i32,
    watched: i32,
    watched_episodes: i32,
    watched_seasons: i32,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct MangaSummary {
    chapters: i32,
    read: i32,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct AnimeSummary {
    episodes: i32,
    watched: i32,
}

#[derive(
    SimpleObject, Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct UserSummary {
    books: BooksSummary,
    movies: MoviesSummary,
    podcasts: PodcastsSummary,
    shows: ShowsSummary,
    video_games: VideoGamesSummary,
    audio_books: AudioBooksSummary,
    anime: AnimeSummary,
    manga: MangaSummary,
}

#[derive(Debug, SimpleObject)]
struct ReviewPostedBy {
    id: Identifier,
    name: String,
}

#[derive(Debug, SimpleObject)]
struct ReviewItem {
    id: Identifier,
    posted_on: DateTimeUtc,
    rating: Option<Decimal>,
    text: Option<String>,
    visibility: ReviewVisibility,
    spoiler: bool,
    season_number: Option<i32>,
    episode_number: Option<i32>,
    posted_by: ReviewPostedBy,
    podcast_episode_id: Option<i32>,
}

#[derive(Debug, InputObject)]
pub struct PostReviewInput {
    pub rating: Option<Decimal>,
    pub text: Option<String>,
    pub visibility: Option<ReviewVisibility>,
    pub spoiler: Option<bool>,
    pub metadata_id: Identifier,
    pub date: Option<DateTimeUtc>,
    /// If this review comes from a different source, this should be set
    pub identifier: Option<String>,
    /// ID of the review if this is an update to an existing review
    pub review_id: Option<Identifier>,
    pub season_number: Option<i32>,
    pub episode_number: Option<i32>,
}

#[derive(Debug, SimpleObject)]
struct CollectionItem {
    collection_details: collection::Model,
    media_details: Vec<MediaSearchItem>,
}

#[derive(Debug, InputObject)]
pub struct AddMediaToCollection {
    pub collection_name: String,
    pub media_id: Identifier,
}

#[derive(SimpleObject)]
pub struct MetadataFeatureEnabled {
    anime: bool,
    audio_books: bool,
    books: bool,
    manga: bool,
    movies: bool,
    podcasts: bool,
    shows: bool,
    video_games: bool,
}

#[derive(SimpleObject)]
pub struct GeneralFeatures {
    file_storage: bool,
    signup_allowed: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaBaseData {
    pub model: metadata::Model,
    pub creators: Vec<MetadataCreator>,
    pub poster_images: Vec<String>,
    pub backdrop_images: Vec<String>,
    pub genres: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MediaSearchItem {
    pub identifier: String,
    pub lot: MetadataLot,
    pub title: String,
    pub images: Vec<String>,
    pub publish_year: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MediaSearchItemResponse {
    pub item: MediaSearchItem,
    pub database_id: Option<Identifier>,
}

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone)]
pub struct MediaSearchResults {
    pub total: i32,
    pub items: Vec<MediaSearchItem>,
    pub next_page: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone)]
pub struct DetailedMediaSearchResults {
    pub total: i32,
    pub items: Vec<MediaSearchItemResponse>,
    pub next_page: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct ProgressUpdate {
    pub metadata_id: Identifier,
    pub progress: Option<i32>,
    pub date: Option<NaiveDate>,
    pub show_season_number: Option<i32>,
    pub show_episode_number: Option<i32>,
    pub podcast_episode_number: Option<i32>,
    /// If this update comes from a different source, this should be set
    pub identifier: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaDetails {
    pub identifier: String,
    pub title: String,
    pub source: MetadataSource,
    pub description: Option<String>,
    pub lot: MetadataLot,
    pub creators: Vec<MetadataCreator>,
    pub genres: Vec<String>,
    pub images: Vec<MetadataImage>,
    pub publish_year: Option<i32>,
    pub publish_date: Option<NaiveDate>,
    pub specifics: MediaSpecifics,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct GraphqlMediaDetails {
    pub id: i32,
    pub title: String,
    pub identifier: String,
    pub description: Option<String>,
    pub lot: MetadataLot,
    pub source: MetadataSource,
    pub creators: Vec<MetadataCreator>,
    pub genres: Vec<String>,
    pub poster_images: Vec<String>,
    pub backdrop_images: Vec<String>,
    pub publish_year: Option<i32>,
    pub publish_date: Option<NaiveDate>,
    pub book_specifics: Option<BookSpecifics>,
    pub movie_specifics: Option<MovieSpecifics>,
    pub show_specifics: Option<ShowSpecifics>,
    pub video_game_specifics: Option<VideoGameSpecifics>,
    pub audio_book_specifics: Option<AudioBookSpecifics>,
    pub podcast_specifics: Option<PodcastSpecifics>,
    pub manga_specifics: Option<MangaSpecifics>,
    pub anime_specifics: Option<AnimeSpecifics>,
    pub source_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum MediaSortOrder {
    Desc,
    #[default]
    Asc,
}

impl From<MediaSortOrder> for Order {
    fn from(value: MediaSortOrder) -> Self {
        match value {
            MediaSortOrder::Desc => Self::Desc,
            MediaSortOrder::Asc => Self::Asc,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum MediaSortBy {
    Title,
    #[default]
    ReleaseDate,
    LastSeen,
    Rating,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MediaSortInput {
    #[graphql(default)]
    pub order: MediaSortOrder,
    #[graphql(default)]
    pub by: MediaSortBy,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, Copy, Eq, PartialEq)]
pub enum MediaFilter {
    All,
    Rated,
    Unrated,
    Dropped,
    Finished,
    Unseen,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MediaListInput {
    pub page: i32,
    pub lot: MetadataLot,
    pub sort: Option<MediaSortInput>,
    pub query: Option<String>,
    pub filter: Option<MediaFilter>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MediaConsumedInput {
    pub identifier: String,
    pub lot: MetadataLot,
}

#[derive(Serialize, Deserialize, Debug, InputObject)]
pub struct SearchInput {
    pub query: String,
    pub page: Option<i32>,
}

#[derive(Default)]
pub struct MiscellaneousQuery;

#[Object]
impl MiscellaneousQuery {
    /// Get all the public reviews for a media item.
    async fn media_item_reviews(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: Identifier,
    ) -> Result<Vec<ReviewItem>> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .media_item_reviews(&user_id, &metadata_id.into())
            .await
    }

    /// Get all collections for the currently logged in user.
    async fn collections(&self, gql_ctx: &Context<'_>) -> Result<Vec<CollectionItem>> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .collections(&user_id)
            .await
    }

    /// Get details about the currently logged in user.
    pub async fn user_details(&self, gql_ctx: &Context<'_>) -> Result<UserDetailsResult> {
        let token = user_auth_token_from_ctx(gql_ctx)?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .user_details(&token)
            .await
    }

    /// Get a summary of all the media items that have been consumed by this user.
    pub async fn user_summary(&self, gql_ctx: &Context<'_>) -> Result<UserSummary> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .user_summary(&user_id)
            .await
    }

    /// Get details about a media present in the database.
    async fn media_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: Identifier,
    ) -> Result<GraphqlMediaDetails> {
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .media_details(metadata_id.into())
            .await
    }

    /// Get the user's seen history for a particular media item.
    async fn seen_history(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: Identifier,
    ) -> Result<Vec<seen::Model>> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .seen_history(metadata_id.into(), user_id)
            .await
    }

    /// Get all the media items related to a user for a specific media type.
    async fn media_list(
        &self,
        gql_ctx: &Context<'_>,
        input: MediaListInput,
    ) -> Result<MediaSearchResults> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .media_list(user_id, input)
            .await
    }

    /// Get a presigned URL (valid for 90 minutes) for a given key.
    async fn get_presigned_url(&self, gql_ctx: &Context<'_>, key: String) -> String {
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .get_presigned_url(key)
            .await
    }

    /// Get all the features that are enabled for the service
    async fn core_enabled_features(&self, gql_ctx: &Context<'_>) -> Result<GeneralFeatures> {
        let config = gql_ctx.data_unchecked::<AppConfig>();
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .core_enabled_features(config)
            .await
    }

    /// Get all the user specific features that are enabled
    async fn user_enabled_features(&self, gql_ctx: &Context<'_>) -> Result<MetadataFeatureEnabled> {
        let config = gql_ctx.data_unchecked::<AppConfig>();
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .user_enabled_features(user_id, config)
            .await
    }

    /// Search for a list of media for a given type.
    async fn media_search(
        &self,
        gql_ctx: &Context<'_>,
        lot: MetadataLot,
        input: SearchInput,
    ) -> Result<DetailedMediaSearchResults> {
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .media_search(lot, input)
            .await
    }

    /// Check if a media with the given metadata and identifier exists in the database.
    async fn media_exists_in_database(
        &self,
        gql_ctx: &Context<'_>,
        identifier: String,
        lot: MetadataLot,
    ) -> Result<Option<IdObject>> {
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .media_exists_in_database(identifier, lot)
            .await
    }
}

#[derive(Default)]
pub struct MiscellaneousMutation;

#[Object]
impl MiscellaneousMutation {
    /// Create or update a review.
    async fn post_review(&self, gql_ctx: &Context<'_>, input: PostReviewInput) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .post_review(&user_id, input)
            .await
    }

    /// Delete a review if it belongs to the user.
    async fn delete_review(&self, gql_ctx: &Context<'_>, review_id: Identifier) -> Result<bool> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .delete_review(&user_id, review_id.into())
            .await
    }

    /// Create a new collection for the logged in user.
    async fn create_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: NamedObject,
    ) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .create_collection(&user_id, input)
            .await
    }

    /// Add a media item to a collection if it is not there, otherwise do nothing.
    async fn add_media_to_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: AddMediaToCollection,
    ) -> Result<bool> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .add_media_to_collection(&user_id, input)
            .await
    }

    /// Remove a media item from a collection if it is not there, otherwise do nothing.
    async fn remove_media_from_collection(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: Identifier,
        collection_name: String,
    ) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .remove_media_item_from_collection(&user_id, &metadata_id.into(), &collection_name)
            .await
    }

    /// Delete a collection.
    async fn delete_collection(
        &self,
        gql_ctx: &Context<'_>,
        collection_name: String,
    ) -> Result<bool> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .delete_collection(&user_id, &collection_name)
            .await
    }

    /// Delete a seen item from a user's history.
    async fn delete_seen_item(
        &self,
        gql_ctx: &Context<'_>,
        seen_id: Identifier,
    ) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .delete_seen_item(seen_id.into(), user_id)
            .await
    }

    /// Deploy jobs to update all media item's metadata.
    async fn update_all_metadata(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .update_all_metadata()
            .await
    }

    /// Create a new user for the service. Also set their `lot` as admin if
    /// they are the first user.
    async fn register_user(
        &self,
        gql_ctx: &Context<'_>,
        input: UserInput,
    ) -> Result<RegisterResult> {
        let config = gql_ctx.data_unchecked::<AppConfig>();
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .register_user(&input.username, &input.password, config)
            .await
    }

    /// Login a user using their username and password and return an API key.
    async fn login_user(&self, gql_ctx: &Context<'_>, input: UserInput) -> Result<LoginResult> {
        let config = gql_ctx.data_unchecked::<AppConfig>();
        let maybe_api_key = gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .login_user(
                &input.username,
                &input.password,
                config.users.token_valid_for_days,
            )
            .await?;
        let config = gql_ctx.data_unchecked::<AppConfig>();
        if let LoginResult::Ok(LoginResponse { api_key }) = &maybe_api_key {
            create_cookie(
                gql_ctx,
                api_key,
                false,
                config.web.insecure_cookie,
                config.users.token_valid_for_days,
            )?;
        };
        Ok(maybe_api_key)
    }

    /// Logout a user from the server, deleting their login token.
    async fn logout_user(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let config = gql_ctx.data_unchecked::<AppConfig>();
        create_cookie(
            gql_ctx,
            "",
            true,
            config.web.insecure_cookie,
            config.users.token_valid_for_days,
        )?;
        let user_id = user_auth_token_from_ctx(gql_ctx)?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .logout_user(&user_id)
            .await
    }

    /// Update a user's profile details.
    async fn update_user(&self, gql_ctx: &Context<'_>, input: UpdateUserInput) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        let config = gql_ctx.data_unchecked::<AppConfig>();
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .update_user(&user_id, input, config)
            .await
    }

    /// Delete all summaries for the currently logged in user and then generate one from scratch.
    pub async fn regenerate_user_summary(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .regenerate_user_summary(user_id)
            .await
    }

    /// Create a custom media item.
    async fn create_custom_media(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateCustomMediaInput,
    ) -> Result<CreateCustomMediaResult> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .create_custom_media(input, &user_id)
            .await
    }

    /// Mark a user's progress on a specific media item.
    async fn progress_update(
        &self,
        gql_ctx: &Context<'_>,
        input: ProgressUpdate,
    ) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .progress_update(input, user_id)
            .await
    }

    /// Deploy a job to update a media item's metadata.
    async fn deploy_update_metadata_job(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: Identifier,
    ) -> Result<String> {
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .deploy_update_metadata_job(metadata_id.into())
            .await
    }

    /// Merge a media item into another. This will move all `seen` and `review`
    /// items with the new user and then delete the old media item completely.
    async fn merge_metadata(
        &self,
        gql_ctx: &Context<'_>,
        merge_from: Identifier,
        merge_into: Identifier,
    ) -> Result<bool> {
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .merge_metadata(merge_from.into(), merge_into.into())
            .await
    }

    /// Fetch details about a media and create a media item in the database.
    async fn commit_media(
        &self,
        gql_ctx: &Context<'_>,
        lot: MetadataLot,
        identifier: String,
    ) -> Result<IdObject> {
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .commit_media(lot, identifier)
            .await
    }

    /// Load next 10 episodes of a podcast if they exist.
    async fn commit_next_10_podcast_episodes(
        &self,
        gql_ctx: &Context<'_>,
        podcast_id: Identifier,
    ) -> Result<bool> {
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .commit_next_10_podcast_episodes(podcast_id.into())
            .await
    }

    /// Change a user's preferences
    async fn update_user_preferences(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateUserPreferencesInput,
    ) -> Result<bool> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .update_user_preferences(input, user_id)
            .await
    }

    /// Generate an auth token without any expiry
    async fn generate_application_token(&self, gql_ctx: &Context<'_>) -> Result<String> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<Arc<MiscellaneousService>>()
            .generate_application_token(user_id)
            .await
    }
}

#[derive(Debug, Clone)]
pub struct MiscellaneousService {
    db: DatabaseConnection,
    scdb: MemoryDb,
    s3_client: aws_sdk_s3::Client,
    bucket_name: String,
    audible_service: Arc<AudibleService>,
    igdb_service: Arc<IgdbService>,
    listennotes_service: Arc<ListennotesService>,
    openlibrary_service: Arc<OpenlibraryService>,
    tmdb_movies_service: Arc<TmdbMovieService>,
    tmdb_shows_service: Arc<TmdbShowService>,
    anilist_anime_service: Arc<AnilistAnimeService>,
    anilist_manga_service: Arc<AnilistMangaService>,
    after_media_seen: SqliteStorage<AfterMediaSeenJob>,
    update_metadata: SqliteStorage<UpdateMetadataJob>,
    recalculate_user_summary: SqliteStorage<RecalculateUserSummaryJob>,
    user_created: SqliteStorage<UserCreatedJob>,
}

impl MiscellaneousService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        db: &DatabaseConnection,
        scdb: &MemoryDb,
        s3_client: &aws_sdk_s3::Client,
        bucket_name: &str,
        audible_service: Arc<AudibleService>,
        igdb_service: Arc<IgdbService>,
        listennotes_service: Arc<ListennotesService>,
        openlibrary_service: Arc<OpenlibraryService>,
        tmdb_movies_service: Arc<TmdbMovieService>,
        tmdb_shows_service: Arc<TmdbShowService>,
        anilist_anime_service: Arc<AnilistAnimeService>,
        anilist_manga_service: Arc<AnilistMangaService>,
        after_media_seen: &SqliteStorage<AfterMediaSeenJob>,
        update_metadata: &SqliteStorage<UpdateMetadataJob>,
        recalculate_user_summary: &SqliteStorage<RecalculateUserSummaryJob>,
        user_created: &SqliteStorage<UserCreatedJob>,
    ) -> Self {
        Self {
            db: db.clone(),
            scdb: scdb.clone(),
            s3_client: s3_client.clone(),
            bucket_name: bucket_name.to_owned(),
            audible_service,
            igdb_service,
            listennotes_service,
            openlibrary_service,
            tmdb_movies_service,
            tmdb_shows_service,
            anilist_anime_service,
            anilist_manga_service,
            after_media_seen: after_media_seen.clone(),
            update_metadata: update_metadata.clone(),
            recalculate_user_summary: recalculate_user_summary.clone(),
            user_created: user_created.clone(),
        }
    }
}

impl MiscellaneousService {
    async fn get_presigned_url(&self, key: String) -> String {
        self.s3_client
            .get_object()
            .bucket(&self.bucket_name)
            .key(key)
            .presigned(PresigningConfig::expires_in(Duration::from_secs(90 * 60)).unwrap())
            .await
            .unwrap()
            .uri()
            .to_string()
    }

    async fn metadata_images(&self, meta: &metadata::Model) -> Result<(Vec<String>, Vec<String>)> {
        let mut poster_images = vec![];
        let mut backdrop_images = vec![];
        for i in meta.images.0.clone() {
            match i.lot {
                MetadataImageLot::Backdrop => {
                    let img = match i.url.clone() {
                        MetadataImageUrl::Url(u) => u,
                        MetadataImageUrl::S3(u) => self.get_presigned_url(u).await,
                    };
                    backdrop_images.push(img);
                }
                MetadataImageLot::Poster => {
                    let img = match i.url.clone() {
                        MetadataImageUrl::Url(u) => u,
                        MetadataImageUrl::S3(u) => self.get_presigned_url(u).await,
                    };
                    poster_images.push(img);
                }
            };
        }
        Ok((poster_images, backdrop_images))
    }

    pub async fn generic_metadata(&self, metadata_id: i32) -> Result<MediaBaseData> {
        let meta = match Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
        {
            Some(m) => m,
            None => return Err(Error::new("The record does not exit".to_owned())),
        };
        let genres = meta
            .find_related(Genre)
            .all(&self.db)
            .await
            .unwrap()
            .into_iter()
            .map(|g| g.name)
            .collect();
        let creators = meta.creators.clone().0;
        let (poster_images, backdrop_images) = self.metadata_images(&meta).await.unwrap();
        Ok(MediaBaseData {
            model: meta,
            creators,
            poster_images,
            backdrop_images,
            genres,
        })
    }

    async fn media_details(&self, metadata_id: i32) -> Result<GraphqlMediaDetails> {
        let MediaBaseData {
            model,
            creators,
            poster_images,
            backdrop_images,
            genres,
        } = self.generic_metadata(metadata_id).await?;
        let slug = slug::slugify(&model.title);
        let identifier = &model.identifier;
        let source_url = match model.source {
            MetadataSource::Custom => None,
            MetadataSource::Audible => {
                Some(format!("https://www.audible.com/pd/{slug}/{identifier}"))
            }
            MetadataSource::Openlibrary => {
                Some(format!("https://openlibrary.org/works/{identifier}/{slug}"))
            }
            MetadataSource::Tmdb => {
                let bw = match model.lot {
                    MetadataLot::Movie => "movie",
                    MetadataLot::Show => "tv",
                    _ => unreachable!(),
                };
                Some(format!(
                    "https://www.themoviedb.org/{bw}/{identifier}-{slug}"
                ))
            }
            MetadataSource::Listennotes => Some(format!(
                "https://www.listennotes.com/podcasts/{slug}-{identifier}"
            )),
            MetadataSource::Igdb => Some(format!("https://www.igdb.com/games/{slug}")),
            MetadataSource::Anilist => {
                let bw = match model.lot {
                    MetadataLot::Anime => "anime",
                    MetadataLot::Manga => "manga",
                    _ => unreachable!(),
                };
                Some(format!("https://anilist.co/{bw}/{identifier}/{slug}"))
            }
        };
        let mut resp = GraphqlMediaDetails {
            id: model.id,
            title: model.title,
            identifier: model.identifier,
            description: model.description,
            publish_year: model.publish_year,
            publish_date: model.publish_date,
            source: model.source,
            lot: model.lot,
            creators,
            genres,
            poster_images,
            backdrop_images,
            book_specifics: None,
            movie_specifics: None,
            show_specifics: None,
            video_game_specifics: None,
            audio_book_specifics: None,
            podcast_specifics: None,
            manga_specifics: None,
            anime_specifics: None,
            source_url,
        };
        match model.specifics {
            MediaSpecifics::AudioBook(a) => {
                resp.audio_book_specifics = Some(a);
            }
            MediaSpecifics::Book(a) => {
                resp.book_specifics = Some(a);
            }
            MediaSpecifics::Movie(a) => {
                resp.movie_specifics = Some(a);
            }
            MediaSpecifics::Podcast(a) => {
                resp.podcast_specifics = Some(a);
            }
            MediaSpecifics::Show(a) => {
                resp.show_specifics = Some(a);
            }
            MediaSpecifics::VideoGame(a) => {
                resp.video_game_specifics = Some(a);
            }
            MediaSpecifics::Anime(a) => {
                resp.anime_specifics = Some(a);
            }
            MediaSpecifics::Manga(a) => {
                resp.manga_specifics = Some(a);
            }
            MediaSpecifics::Unknown => {}
        };
        Ok(resp)
    }

    async fn seen_history(&self, metadata_id: i32, user_id: i32) -> Result<Vec<seen::Model>> {
        let mut prev_seen = Seen::find()
            .filter(seen::Column::UserId.eq(user_id))
            .filter(seen::Column::MetadataId.eq(metadata_id))
            .order_by_desc(seen::Column::LastUpdatedOn)
            .all(&self.db)
            .await
            .unwrap();
        prev_seen.iter_mut().for_each(|s| {
            if let Some(i) = s.extra_information.as_ref() {
                match i {
                    SeenExtraInformation::Show(sea) => {
                        s.show_information = Some(sea.clone());
                    }
                    SeenExtraInformation::Podcast(sea) => {
                        s.podcast_information = Some(sea.clone());
                    }
                };
            }
        });
        Ok(prev_seen)
    }

    pub async fn media_list(
        &self,
        user_id: i32,
        input: MediaListInput,
    ) -> Result<MediaSearchResults> {
        let meta = UserToMetadata::find()
            .filter(user_to_metadata::Column::UserId.eq(user_id))
            .all(&self.db)
            .await
            .unwrap();
        let distinct_meta_ids = meta.into_iter().map(|m| m.metadata_id).collect::<Vec<_>>();

        #[derive(Iden)]
        #[iden = "metadata"]
        enum TempMetadata {
            Table,
            #[iden = "m"]
            Alias,
            Id,
            Lot,
        }
        #[derive(Iden)]
        #[iden = "seen"]
        enum TempSeen {
            Table,
            #[iden = "s"]
            Alias,
            MetadataId,
            FinishedOn,
            LastSeen,
            UserId,
        }
        #[derive(Iden)]
        #[iden = "review"]
        enum TempReview {
            Table,
            #[iden = "r"]
            Alias,
            MetadataId,
            UserId,
            Rating,
        }

        let mut main_select = Query::select()
            .expr(Expr::table_asterisk(TempMetadata::Alias))
            .from_as(TempMetadata::Table, TempMetadata::Alias)
            .and_where(Expr::col((TempMetadata::Alias, TempMetadata::Lot)).eq(input.lot))
            .and_where(
                Expr::col((TempMetadata::Alias, TempMetadata::Id)).is_in(distinct_meta_ids.clone()),
            )
            .to_owned();

        if let Some(v) = input.query.clone() {
            let get_contains_expr = |col: metadata::Column| {
                Expr::expr(Func::lower(Func::cast_as(
                    Expr::col((TempMetadata::Alias, col)),
                    Alias::new("text"),
                )))
                .like(format!("%{}%", v))
            };
            main_select = main_select
                .cond_where(
                    Cond::any()
                        .add(get_contains_expr(metadata::Column::Title))
                        .add(get_contains_expr(metadata::Column::Description))
                        .add(get_contains_expr(metadata::Column::Creators)),
                )
                .to_owned();
        };

        let order_by = input
            .sort
            .clone()
            .map(|a| Order::from(a.order))
            .unwrap_or(Order::Asc);

        match input.sort.clone() {
            None => {
                main_select = main_select
                    .order_by((TempMetadata::Alias, metadata::Column::Title), order_by)
                    .to_owned();
            }
            Some(s) => {
                match s.by {
                    MediaSortBy::Title => {
                        main_select = main_select
                            .order_by((TempMetadata::Alias, metadata::Column::Title), order_by)
                            .to_owned();
                    }
                    MediaSortBy::ReleaseDate => {
                        main_select = main_select
                            .order_by_with_nulls(
                                (TempMetadata::Alias, metadata::Column::PublishYear),
                                order_by,
                                NullOrdering::Last,
                            )
                            .to_owned();
                    }
                    MediaSortBy::LastSeen => {
                        let sub_select = Query::select()
                            .column(TempSeen::MetadataId)
                            .expr_as(
                                Func::max(Expr::col(TempSeen::FinishedOn)),
                                TempSeen::LastSeen,
                            )
                            .from(TempSeen::Table)
                            .and_where(Expr::col(TempSeen::UserId).eq(user_id))
                            .group_by_col(TempSeen::MetadataId)
                            .to_owned();
                        main_select = main_select
                            .join_subquery(
                                JoinType::LeftJoin,
                                sub_select,
                                TempSeen::Alias,
                                Expr::col((TempMetadata::Alias, TempMetadata::Id))
                                    .equals((TempSeen::Alias, TempSeen::MetadataId)),
                            )
                            .order_by_with_nulls(
                                (TempSeen::Alias, TempSeen::LastSeen),
                                order_by,
                                NullOrdering::Last,
                            )
                            .to_owned();
                    }
                    MediaSortBy::Rating => {
                        let alias_name = "average_rating";
                        main_select = main_select
                            .expr_as(
                                Func::coalesce([
                                    Func::avg(Expr::col((TempReview::Alias, TempReview::Rating)))
                                        .into(),
                                    Expr::value(0),
                                ]),
                                Alias::new(alias_name),
                            )
                            .join_as(
                                JoinType::LeftJoin,
                                TempReview::Table,
                                TempReview::Alias,
                                Expr::col((TempMetadata::Alias, TempMetadata::Id))
                                    .equals((TempReview::Alias, TempReview::MetadataId))
                                    .and(
                                        Expr::col((TempReview::Alias, TempReview::UserId))
                                            .eq(user_id),
                                    ),
                            )
                            .group_by_col((TempMetadata::Alias, TempMetadata::Id))
                            .order_by_expr(Expr::cust(alias_name), order_by)
                            .to_owned();
                    }
                };
            }
        };

        match input.filter {
            None => {}
            Some(s) => {
                let reviews = if matches!(s, MediaFilter::All) {
                    vec![]
                } else {
                    Review::find()
                        .filter(review::Column::UserId.eq(user_id))
                        .all(&self.db)
                        .await?
                        .into_iter()
                        .map(|r| r.metadata_id)
                        .collect::<Vec<_>>()
                };
                match s {
                    MediaFilter::All => {}
                    MediaFilter::Rated => {
                        main_select = main_select
                            .and_where(
                                Expr::col((TempMetadata::Alias, TempMetadata::Id)).is_in(reviews),
                            )
                            .to_owned();
                    }
                    MediaFilter::Unrated => {
                        main_select = main_select
                            .and_where(
                                Expr::col((TempMetadata::Alias, TempMetadata::Id))
                                    .is_not_in(reviews),
                            )
                            .to_owned();
                    }
                    MediaFilter::Dropped => {
                        let dropped_ids = Seen::find()
                            .filter(seen::Column::UserId.eq(user_id))
                            .filter(seen::Column::Dropped.eq(true))
                            .all(&self.db)
                            .await?
                            .into_iter()
                            .map(|r| r.metadata_id)
                            .collect::<Vec<_>>();
                        main_select = main_select
                            .and_where(
                                Expr::col((TempMetadata::Alias, TempMetadata::Id))
                                    .is_in(dropped_ids),
                            )
                            .to_owned();
                    }
                    MediaFilter::Finished => {
                        let finished_ids = Seen::find()
                            .filter(seen::Column::UserId.eq(user_id))
                            .filter(seen::Column::Progress.eq(100))
                            .all(&self.db)
                            .await?
                            .into_iter()
                            .map(|r| r.metadata_id)
                            .collect::<Vec<_>>();
                        main_select = main_select
                            .and_where(
                                Expr::col((TempMetadata::Alias, TempMetadata::Id))
                                    .is_in(finished_ids),
                            )
                            .to_owned();
                    }
                    MediaFilter::Unseen => {
                        main_select = main_select
                            .join_as(
                                JoinType::LeftJoin,
                                TempReview::Table,
                                TempReview::Alias,
                                Expr::col((TempMetadata::Alias, TempMetadata::Id))
                                    .equals((TempSeen::Alias, TempSeen::MetadataId)),
                            )
                            .and_where(Expr::col((TempSeen::Alias, TempSeen::MetadataId)).is_null())
                            .to_owned();
                    }
                }
            }
        };

        #[derive(Debug, FromQueryResult)]
        struct InnerMediaSearchItem {
            id: i32,
            lot: MetadataLot,
            title: String,
            publish_year: Option<i32>,
            images: serde_json::Value,
        }

        let count_select = Query::select()
            .expr(Func::count(Expr::asterisk()))
            .from_subquery(main_select.clone(), Alias::new("subquery"))
            .to_owned();
        let stmt = self.get_db_stmt(count_select);
        let total = self
            .db
            .query_one(stmt)
            .await?
            .map(|qr| qr.try_get_by_index::<i64>(0).unwrap())
            .unwrap();
        let total: i32 = total.try_into().unwrap();

        let main_select = main_select
            .limit(PAGE_LIMIT as u64)
            .offset(((input.page - 1) * PAGE_LIMIT) as u64)
            .to_owned();
        let stmt = self.get_db_stmt(main_select);
        let metas: Vec<InnerMediaSearchItem> = self
            .db
            .query_all(stmt)
            .await?
            .into_iter()
            .map(|qr| InnerMediaSearchItem::from_query_result(&qr, "").unwrap())
            .collect();
        let mut items = vec![];
        for m in metas {
            let images = serde_json::from_value(m.images).unwrap();
            let (poster_images, _) = self
                .metadata_images(&metadata::Model {
                    images,
                    ..Default::default()
                })
                .await?;
            let m_small = MediaSearchItem {
                identifier: m.id.to_string(),
                lot: m.lot,
                title: m.title,
                images: poster_images,
                publish_year: m.publish_year,
            };
            items.push(m_small);
        }
        let next_page = if total - ((input.page) * PAGE_LIMIT) > 0 {
            Some(input.page + 1)
        } else {
            None
        };
        Ok(MediaSearchResults {
            total,
            items,
            next_page,
        })
    }

    pub async fn progress_update(&self, input: ProgressUpdate, user_id: i32) -> Result<IdObject> {
        let prev_seen = Seen::find()
            .filter(seen::Column::Progress.lt(100))
            .filter(seen::Column::UserId.eq(user_id))
            .filter(seen::Column::Dropped.ne(true))
            .filter(seen::Column::MetadataId.eq(i32::from(input.metadata_id)))
            .order_by_desc(seen::Column::LastUpdatedOn)
            .all(&self.db)
            .await
            .unwrap();
        #[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy)]
        pub enum ProgressUpdateAction {
            Update,
            Now,
            InThePast,
            JustStarted,
            Drop,
        }
        let action = match input.progress {
            None => ProgressUpdateAction::Drop,
            Some(p) => {
                if p == 100 {
                    match input.date {
                        None => ProgressUpdateAction::InThePast,
                        Some(u) => {
                            if Utc::now().date_naive() == u {
                                if prev_seen.is_empty() {
                                    ProgressUpdateAction::Now
                                } else {
                                    ProgressUpdateAction::Update
                                }
                            } else {
                                ProgressUpdateAction::InThePast
                            }
                        }
                    }
                } else if prev_seen.is_empty() {
                    ProgressUpdateAction::JustStarted
                } else {
                    ProgressUpdateAction::Update
                }
            }
        };
        let meta = Seen::find()
            .filter(seen::Column::Identifier.eq(input.identifier.clone()))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject {
                id: m.metadata_id.into(),
            })
        } else {
            let err = || Err(Error::new("There is no `seen` item underway".to_owned()));
            let seen_item = match action {
                ProgressUpdateAction::Update => {
                    let progress = input.progress.unwrap();
                    let mut last_seen: seen::ActiveModel = prev_seen[0].clone().into();
                    last_seen.progress = ActiveValue::Set(progress);
                    last_seen.last_updated_on = ActiveValue::Set(Utc::now());
                    if progress == 100 {
                        last_seen.finished_on = ActiveValue::Set(Some(Utc::now().date_naive()));
                    }
                    last_seen.update(&self.db).await.unwrap()
                }
                ProgressUpdateAction::Drop => {
                    let last_seen = Seen::find()
                        .filter(seen::Column::UserId.eq(user_id))
                        .filter(seen::Column::Dropped.ne(true))
                        .filter(seen::Column::MetadataId.eq(i32::from(input.metadata_id)))
                        .order_by_desc(seen::Column::LastUpdatedOn)
                        .one(&self.db)
                        .await
                        .unwrap();
                    match last_seen {
                        Some(ls) => {
                            let mut last_seen: seen::ActiveModel = ls.into();
                            last_seen.dropped = ActiveValue::Set(true);
                            last_seen.last_updated_on = ActiveValue::Set(Utc::now());
                            last_seen.update(&self.db).await.unwrap()
                        }
                        None => {
                            return err();
                        }
                    }
                }
                ProgressUpdateAction::Now
                | ProgressUpdateAction::InThePast
                | ProgressUpdateAction::JustStarted => {
                    let meta = Metadata::find_by_id(input.metadata_id)
                        .one(&self.db)
                        .await
                        .unwrap()
                        .unwrap();
                    let finished_on = if action == ProgressUpdateAction::JustStarted {
                        None
                    } else {
                        input.date
                    };
                    let (progress, started_on) =
                        if matches!(action, ProgressUpdateAction::JustStarted) {
                            (0, Some(Utc::now().date_naive()))
                        } else {
                            (100, None)
                        };
                    let mut seen_insert = seen::ActiveModel {
                        progress: ActiveValue::Set(progress),
                        user_id: ActiveValue::Set(user_id),
                        metadata_id: ActiveValue::Set(i32::from(input.metadata_id)),
                        started_on: ActiveValue::Set(started_on),
                        finished_on: ActiveValue::Set(finished_on),
                        last_updated_on: ActiveValue::Set(Utc::now()),
                        identifier: ActiveValue::Set(input.identifier),
                        ..Default::default()
                    };
                    if meta.lot == MetadataLot::Show {
                        seen_insert.extra_information = ActiveValue::Set(Some(
                            SeenExtraInformation::Show(SeenShowExtraInformation {
                                season: input.show_season_number.unwrap(),
                                episode: input.show_episode_number.unwrap(),
                            }),
                        ));
                    } else if meta.lot == MetadataLot::Podcast {
                        seen_insert.extra_information = ActiveValue::Set(Some(
                            SeenExtraInformation::Podcast(SeenPodcastExtraInformation {
                                episode: input.podcast_episode_number.unwrap(),
                            }),
                        ))
                    }

                    seen_insert.insert(&self.db).await.unwrap()
                }
            };
            let id = seen_item.id.into();
            let metadata = self.generic_metadata(input.metadata_id.into()).await?;
            let mut storage = self.after_media_seen.clone();
            storage
                .push(AfterMediaSeenJob {
                    seen: seen_item,
                    metadata_lot: metadata.model.lot,
                })
                .await
                .ok();
            Ok(IdObject { id })
        }
    }

    pub async fn deploy_recalculate_summary_job(&self, user_id: i32) -> Result<()> {
        let mut storage = self.recalculate_user_summary.clone();
        storage
            .push(RecalculateUserSummaryJob {
                user_id: user_id.into(),
            })
            .await?;
        Ok(())
    }

    pub async fn cleanup_user_and_metadata_association(&self) -> Result<()> {
        let user_to_metadatas = UserToMetadata::find().all(&self.db).await.unwrap();
        for u in user_to_metadatas {
            // check if there is any seen item
            let seen_count = Seen::find()
                .filter(seen::Column::UserId.eq(u.user_id))
                .filter(seen::Column::MetadataId.eq(u.metadata_id))
                .count(&self.db)
                .await
                .unwrap();
            // check if it has been reviewed
            let reviewed_count = Review::find()
                .filter(review::Column::UserId.eq(u.user_id))
                .filter(review::Column::MetadataId.eq(u.metadata_id))
                .count(&self.db)
                .await
                .unwrap();
            // check if it is part of any collection
            let collection_ids: Vec<i32> = Collection::find()
                .select_only()
                .column(collection::Column::Id)
                .filter(collection::Column::UserId.eq(u.user_id))
                .into_tuple()
                .all(&self.db)
                .await
                .unwrap();
            let meta_ids: Vec<i32> = MetadataToCollection::find()
                .select_only()
                .column(metadata_to_collection::Column::MetadataId)
                .filter(metadata_to_collection::Column::CollectionId.is_in(collection_ids))
                .into_tuple()
                .all(&self.db)
                .await
                .unwrap();
            let is_in_collection = meta_ids.contains(&u.metadata_id);
            if seen_count + reviewed_count == 0 && !is_in_collection {
                tracing::debug!(
                    "Removing user_to_metadata = {id:?}",
                    id = (u.user_id, u.metadata_id)
                );
                u.delete(&self.db).await.ok();
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn update_media(
        &self,
        metadata_id: i32,
        title: String,
        description: Option<String>,
        images: Vec<MetadataImage>,
        creators: Vec<MetadataCreator>,
        specifics: MediaSpecifics,
        genres: Vec<String>,
    ) -> Result<()> {
        let meta = Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let mut meta: metadata::ActiveModel = meta.into();
        meta.title = ActiveValue::Set(title);
        meta.description = ActiveValue::Set(description);
        meta.images = ActiveValue::Set(MetadataImages(images));
        meta.last_updated_on = ActiveValue::Set(Utc::now());
        meta.creators = ActiveValue::Set(MetadataCreators(creators));
        meta.specifics = ActiveValue::Set(specifics);
        meta.save(&self.db).await.ok();
        for genre in genres {
            self.associate_genre_with_metadata(genre, metadata_id)
                .await
                .ok();
        }
        Ok(())
    }

    async fn associate_genre_with_metadata(&self, name: String, metadata_id: i32) -> Result<()> {
        let db_genre = if let Some(c) = Genre::find()
            .filter(genre::Column::Name.eq(&name))
            .one(&self.db)
            .await
            .unwrap()
        {
            c
        } else {
            let c = genre::ActiveModel {
                name: ActiveValue::Set(name),
                ..Default::default()
            };
            c.insert(&self.db).await.unwrap()
        };
        let intermediate = metadata_to_genre::ActiveModel {
            metadata_id: ActiveValue::Set(metadata_id),
            genre_id: ActiveValue::Set(db_genre.id),
        };
        intermediate.insert(&self.db).await.ok();
        Ok(())
    }

    pub async fn commit_media_internal(&self, details: MediaDetails) -> Result<IdObject> {
        let metadata = metadata::ActiveModel {
            lot: ActiveValue::Set(details.lot),
            title: ActiveValue::Set(details.title),
            description: ActiveValue::Set(details.description),
            publish_year: ActiveValue::Set(details.publish_year),
            publish_date: ActiveValue::Set(details.publish_date),
            images: ActiveValue::Set(MetadataImages(details.images)),
            identifier: ActiveValue::Set(details.identifier),
            creators: ActiveValue::Set(MetadataCreators(details.creators)),
            source: ActiveValue::Set(details.source),
            specifics: ActiveValue::Set(details.specifics),
            ..Default::default()
        };
        let metadata = metadata.insert(&self.db).await.unwrap();
        for genre in details.genres {
            self.associate_genre_with_metadata(genre, metadata.id)
                .await
                .ok();
        }
        Ok(IdObject {
            id: metadata.id.into(),
        })
    }

    pub async fn cleanup_metadata_with_associated_user_activities(&self) -> Result<()> {
        let all_metadata = Metadata::find().all(&self.db).await.unwrap();
        for metadata in all_metadata {
            let num_associations = UserToMetadata::find()
                .filter(user_to_metadata::Column::MetadataId.eq(metadata.id))
                .count(&self.db)
                .await
                .unwrap();
            if num_associations == 0 {
                metadata.delete(&self.db).await.ok();
            }
        }
        Ok(())
    }

    pub async fn deploy_update_metadata_job(&self, metadata_id: i32) -> Result<String> {
        let metadata = Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let mut storage = self.update_metadata.clone();
        let job_id = storage.push(UpdateMetadataJob { metadata }).await?;
        Ok(job_id.to_string())
    }

    pub async fn merge_metadata(&self, merge_from: i32, merge_into: i32) -> Result<bool> {
        for old_seen in Seen::find()
            .filter(seen::Column::MetadataId.eq(merge_from))
            .all(&self.db)
            .await
            .unwrap()
        {
            let old_seen_active: seen::ActiveModel = old_seen.clone().into();
            let new_seen = seen::ActiveModel {
                id: ActiveValue::NotSet,
                metadata_id: ActiveValue::Set(merge_into),
                ..old_seen_active
            };
            new_seen.insert(&self.db).await?;
            old_seen.delete(&self.db).await?;
        }
        for old_review in Review::find()
            .filter(review::Column::MetadataId.eq(merge_from))
            .all(&self.db)
            .await
            .unwrap()
        {
            let old_review_active: review::ActiveModel = old_review.clone().into();
            let new_review = review::ActiveModel {
                id: ActiveValue::NotSet,
                metadata_id: ActiveValue::Set(merge_into),
                ..old_review_active
            };
            new_review.insert(&self.db).await?;
            old_review.delete(&self.db).await?;
        }
        Metadata::delete_by_id(merge_from).exec(&self.db).await?;
        Ok(true)
    }

    async fn user_enabled_features(
        &self,
        user_id: i32,
        config: &AppConfig,
    ) -> Result<MetadataFeatureEnabled> {
        let user_preferences = self.user_by_id(user_id).await?.preferences;
        let metadata = MetadataFeatureEnabled {
            anime: config.anime.is_enabled() && user_preferences.anime,
            audio_books: config.audio_books.is_enabled() && user_preferences.audio_books,
            books: config.books.is_enabled() && user_preferences.books,
            shows: config.shows.is_enabled() && user_preferences.shows,
            manga: config.manga.is_enabled() && user_preferences.manga,
            movies: config.movies.is_enabled() && user_preferences.movies,
            podcasts: config.podcasts.is_enabled() && user_preferences.podcasts,
            video_games: config.video_games.is_enabled() && user_preferences.video_games,
        };
        Ok(metadata)
    }

    async fn core_enabled_features(&self, config: &AppConfig) -> Result<GeneralFeatures> {
        let mut files_enabled = config.file_storage.is_enabled();
        if files_enabled
            && self
                .s3_client
                .head_bucket()
                .bucket(&self.bucket_name)
                .send()
                .await
                .is_err()
        {
            files_enabled = false;
        }
        let general = GeneralFeatures {
            file_storage: files_enabled,
            signup_allowed: config.users.allow_registration,
        };
        Ok(general)
    }

    async fn media_search(
        &self,
        lot: MetadataLot,
        input: SearchInput,
    ) -> Result<DetailedMediaSearchResults> {
        #[derive(Iden)]
        #[iden = "identifiers"]
        enum TempIdentifiers {
            #[iden = "identifiers"]
            Alias,
            Identifier,
        }
        #[derive(Iden)]
        #[iden = "metadata"]
        enum TempMetadata {
            Table,
            #[iden = "m"]
            Alias,
            Id,
            Lot,
            Identifier,
        }
        let service: ProviderArc = match lot {
            MetadataLot::Book => self.openlibrary_service.clone(),
            MetadataLot::AudioBook => self.audible_service.clone(),
            MetadataLot::Podcast => self.listennotes_service.clone(),
            MetadataLot::Movie => self.tmdb_movies_service.clone(),
            MetadataLot::Show => self.tmdb_shows_service.clone(),
            MetadataLot::VideoGame => self.igdb_service.clone(),
            MetadataLot::Anime => self.anilist_anime_service.clone(),
            MetadataLot::Manga => self.anilist_manga_service.clone(),
        };
        let results = service.search(&input.query, input.page).await?;
        let mut all_idens = results
            .items
            .iter()
            .map(|i| i.identifier.to_owned())
            .collect::<Vec<_>>();
        let data = if all_idens.is_empty() {
            vec![]
        } else {
            // This can be done with `select id from metadata where identifier = '...'
            // and lot = '...'` in a loop. But, I wanted to write a performant query.
            let first_iden = all_idens.drain(..1).collect::<Vec<_>>().pop().unwrap();
            let mut subquery = Query::select()
                .expr_as(Expr::val(first_iden), TempIdentifiers::Identifier)
                .to_owned();
            for identifier in all_idens {
                subquery = subquery
                    .union(
                        UnionType::All,
                        Query::select().expr(Expr::val(identifier)).to_owned(),
                    )
                    .to_owned();
            }
            let identifiers_query = Query::select()
                .expr(Expr::col((
                    TempIdentifiers::Alias,
                    TempIdentifiers::Identifier,
                )))
                .expr_as(
                    Expr::case(
                        Expr::col((TempMetadata::Alias, TempMetadata::Id)).is_not_null(),
                        Expr::col((TempMetadata::Alias, TempMetadata::Id)),
                    )
                    .finally(Keyword::Null),
                    TempMetadata::Id,
                )
                .from_subquery(subquery, TempIdentifiers::Alias)
                .join_as(
                    JoinType::LeftJoin,
                    TempMetadata::Table,
                    TempMetadata::Alias,
                    Expr::col((TempIdentifiers::Alias, TempIdentifiers::Identifier))
                        .equals((TempMetadata::Alias, TempMetadata::Identifier)),
                )
                .and_where(
                    Expr::col((TempMetadata::Alias, TempMetadata::Lot))
                        .eq(lot)
                        .or(Expr::col((TempMetadata::Alias, TempMetadata::Lot)).is_null()),
                )
                .to_owned();
            let stmt = self.get_db_stmt(identifiers_query);
            #[derive(Debug, FromQueryResult)]
            struct DbResponse {
                identifier: String,
                id: Option<i32>,
            }
            let identifiers: Vec<DbResponse> = self
                .db
                .query_all(stmt)
                .await?
                .iter()
                .map(|qr| DbResponse::from_query_result(qr, "").unwrap())
                .collect();
            results
                .items
                .into_iter()
                .map(|i| MediaSearchItemResponse {
                    database_id: identifiers
                        .iter()
                        .find(|&f| f.identifier == i.identifier)
                        .unwrap()
                        .id
                        .map(Identifier::from),
                    item: i,
                })
                .collect()
        };
        let results = DetailedMediaSearchResults {
            total: results.total,
            items: data,
            next_page: results.next_page,
        };
        Ok(results)
    }

    pub async fn details_from_provider_for_existing_media(
        &self,
        metadata_id: i32,
    ) -> Result<MediaDetails> {
        let metadata = Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let results = self
            .details_from_provider(metadata.lot, metadata.source, metadata.identifier)
            .await?;
        Ok(results)
    }

    async fn details_from_provider(
        &self,
        lot: MetadataLot,
        source: MetadataSource,
        identifier: String,
    ) -> Result<MediaDetails> {
        let service: ProviderArc = match source {
            MetadataSource::Openlibrary => self.openlibrary_service.clone(),
            MetadataSource::Audible => self.audible_service.clone(),
            MetadataSource::Listennotes => self.listennotes_service.clone(),
            MetadataSource::Tmdb => match lot {
                MetadataLot::Show => self.tmdb_shows_service.clone(),
                MetadataLot::Movie => self.tmdb_movies_service.clone(),
                _ => unreachable!(),
            },
            MetadataSource::Anilist => match lot {
                MetadataLot::Anime => self.anilist_anime_service.clone(),
                MetadataLot::Manga => self.anilist_manga_service.clone(),
                _ => unreachable!(),
            },
            MetadataSource::Igdb => self.igdb_service.clone(),
            MetadataSource::Custom => {
                return Err(Error::new("This source is not supported".to_owned()));
            }
        };
        let results = service.details(&identifier).await?;
        Ok(results)
    }

    pub async fn commit_media(&self, lot: MetadataLot, identifier: String) -> Result<IdObject> {
        let meta = Metadata::find()
            .filter(metadata::Column::Lot.eq(lot))
            .filter(metadata::Column::Identifier.eq(&identifier))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject { id: m.id.into() })
        } else {
            let source = match lot {
                MetadataLot::Anime => MetadataSource::Anilist,
                MetadataLot::AudioBook => MetadataSource::Audible,
                MetadataLot::Podcast => MetadataSource::Listennotes,
                MetadataLot::Manga => MetadataSource::Anilist,
                MetadataLot::Movie => MetadataSource::Tmdb,
                MetadataLot::Show => MetadataSource::Tmdb,
                MetadataLot::VideoGame => MetadataSource::Igdb,
                MetadataLot::Book => MetadataSource::Openlibrary,
            };
            let details = self.details_from_provider(lot, source, identifier).await?;
            let media_id = self.commit_media_internal(details).await?;
            Ok(media_id)
        }
    }

    pub async fn commit_next_10_podcast_episodes(&self, podcast_id: i32) -> Result<bool> {
        let podcast = Metadata::find_by_id(podcast_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        match podcast.specifics.clone() {
            MediaSpecifics::Podcast(mut specifics) => {
                if specifics.total_episodes == specifics.episodes.len() as i32 {
                    return Ok(false);
                }
                let last_episode = specifics.episodes.last().unwrap();
                let next_pub_date = last_episode.publish_date;
                let episode_number = last_episode.number;
                let details = match podcast.source {
                    MetadataSource::Listennotes => {
                        self.listennotes_service
                            .details_with_paginated_episodes(
                                &podcast.identifier,
                                Some(next_pub_date),
                                Some(episode_number),
                            )
                            .await?
                    }
                    MetadataSource::Custom => {
                        return Err(Error::new(
                            "Can not fetch next episodes for custom source".to_owned(),
                        ));
                    }
                    _ => unreachable!(),
                };
                match details.specifics {
                    MediaSpecifics::Podcast(ed) => {
                        let mut meta: metadata::ActiveModel = podcast.into();
                        let details_small = meta.specifics.unwrap();
                        specifics.episodes.extend(ed.episodes.into_iter());
                        meta.specifics = ActiveValue::Set(details_small);
                        meta.save(&self.db).await.unwrap();
                    }
                    _ => unreachable!(),
                }
            }
            _ => unreachable!(),
        }
        Ok(true)
    }

    async fn media_item_reviews(
        &self,
        user_id: &i32,
        metadata_id: &i32,
    ) -> Result<Vec<ReviewItem>> {
        let all_reviews = Review::find()
            .order_by_desc(review::Column::PostedOn)
            .filter(review::Column::MetadataId.eq(metadata_id.to_owned()))
            .find_also_related(User)
            .all(&self.db)
            .await
            .unwrap()
            .into_iter()
            .map(|(r, u)| {
                let (show_se, show_ep, podcast_ep) = match r.extra_information {
                    Some(s) => match s {
                        SeenExtraInformation::Show(d) => (Some(d.season), Some(d.episode), None),
                        SeenExtraInformation::Podcast(d) => (None, None, Some(d.episode)),
                    },
                    None => (None, None, None),
                };
                let user = u.unwrap();
                ReviewItem {
                    id: r.id.into(),
                    posted_on: r.posted_on,
                    rating: r.rating,
                    spoiler: r.spoiler,
                    text: r.text,
                    visibility: r.visibility,
                    season_number: show_se,
                    episode_number: show_ep,
                    podcast_episode_id: podcast_ep,
                    posted_by: ReviewPostedBy {
                        id: user.id.into(),
                        name: user.name,
                    },
                }
            })
            .collect::<Vec<_>>();
        let all_reviews = all_reviews
            .into_iter()
            .filter(|r| match r.visibility {
                ReviewVisibility::Private => i32::from(r.posted_by.id) == *user_id,
                _ => true,
            })
            .collect();
        Ok(all_reviews)
    }

    async fn collections(&self, user_id: &i32) -> Result<Vec<CollectionItem>> {
        let collections = Collection::find()
            .filter(collection::Column::UserId.eq(user_id.to_owned()))
            .find_with_related(Metadata)
            .all(&self.db)
            .await
            .unwrap();
        let mut data = vec![];
        for (col, metas) in collections.into_iter() {
            let mut meta_data = vec![];
            for meta in metas {
                let m = self.generic_metadata(meta.id).await?;
                meta_data.push(MediaSearchItem {
                    identifier: m.model.id.to_string(),
                    lot: m.model.lot,
                    title: m.model.title,
                    images: m.poster_images,
                    publish_year: m.model.publish_year,
                })
            }
            data.push(CollectionItem {
                collection_details: col,
                media_details: meta_data,
            });
        }
        Ok(data)
    }

    pub async fn post_review(&self, user_id: &i32, input: PostReviewInput) -> Result<IdObject> {
        let meta = Review::find()
            .filter(review::Column::Identifier.eq(input.identifier.clone()))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject {
                id: m.metadata_id.into(),
            })
        } else {
            let review_id = match input.review_id {
                Some(i) => ActiveValue::Set(i32::from(i)),
                None => ActiveValue::NotSet,
            };
            let mut review_obj = review::ActiveModel {
                id: review_id,
                rating: ActiveValue::Set(input.rating),
                text: ActiveValue::Set(input.text),
                user_id: ActiveValue::Set(user_id.to_owned()),
                metadata_id: ActiveValue::Set(i32::from(input.metadata_id)),
                extra_information: ActiveValue::NotSet,
                identifier: ActiveValue::Set(input.identifier),
                ..Default::default()
            };
            if let Some(s) = input.spoiler {
                review_obj.spoiler = ActiveValue::Set(s);
            }
            if let Some(v) = input.visibility {
                review_obj.visibility = ActiveValue::Set(v);
            }
            if let Some(d) = input.date {
                review_obj.posted_on = ActiveValue::Set(d);
            }
            if let (Some(s), Some(e)) = (input.season_number, input.episode_number) {
                review_obj.extra_information =
                    ActiveValue::Set(Some(SeenExtraInformation::Show(SeenShowExtraInformation {
                        season: s,
                        episode: e,
                    })));
            }
            let insert = review_obj.save(&self.db).await.unwrap();
            Ok(IdObject {
                id: insert.id.unwrap().into(),
            })
        }
    }

    pub async fn delete_review(&self, user_id: &i32, review_id: i32) -> Result<bool> {
        let review = Review::find()
            .filter(review::Column::Id.eq(review_id))
            .one(&self.db)
            .await
            .unwrap();
        match review {
            Some(r) => {
                if r.user_id == *user_id {
                    r.delete(&self.db).await?;
                    Ok(true)
                } else {
                    Err(Error::new("This review does not belong to you".to_owned()))
                }
            }
            None => Ok(false),
        }
    }

    pub async fn create_collection(&self, user_id: &i32, input: NamedObject) -> Result<IdObject> {
        let meta = Collection::find()
            .filter(collection::Column::Name.eq(input.name.clone()))
            .filter(collection::Column::UserId.eq(user_id.to_owned()))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject { id: m.id.into() })
        } else {
            let col = collection::ActiveModel {
                name: ActiveValue::Set(input.name),
                user_id: ActiveValue::Set(user_id.to_owned()),
                ..Default::default()
            };
            let inserted = col
                .insert(&self.db)
                .await
                .map_err(|_| Error::new("There was an error creating the collection".to_owned()))?;
            Ok(IdObject {
                id: inserted.id.into(),
            })
        }
    }

    pub async fn delete_collection(&self, user_id: &i32, name: &str) -> Result<bool> {
        if DefaultCollection::iter().any(|n| n.to_string() == name) {
            return Err(Error::new("Can not delete a default collection".to_owned()));
        }
        let collection = Collection::find()
            .filter(collection::Column::Name.eq(name))
            .filter(collection::Column::UserId.eq(user_id.to_owned()))
            .one(&self.db)
            .await?;
        let resp = if let Some(c) = collection {
            Collection::delete_by_id(c.id).exec(&self.db).await.is_ok()
        } else {
            false
        };
        Ok(resp)
    }

    pub async fn remove_media_item_from_collection(
        &self,
        user_id: &i32,
        metadata_id: &i32,
        collection_name: &str,
    ) -> Result<IdObject> {
        let collect = Collection::find()
            .filter(collection::Column::Name.eq(collection_name.to_owned()))
            .filter(collection::Column::UserId.eq(user_id.to_owned()))
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let col = metadata_to_collection::ActiveModel {
            metadata_id: ActiveValue::Set(metadata_id.to_owned()),
            collection_id: ActiveValue::Set(collect.id),
        };
        let id = col.collection_id.clone().unwrap();
        col.delete(&self.db).await.ok();
        Ok(IdObject { id: id.into() })
    }

    pub async fn add_media_to_collection(
        &self,
        user_id: &i32,
        input: AddMediaToCollection,
    ) -> Result<bool> {
        let collection = Collection::find()
            .filter(collection::Column::UserId.eq(user_id.to_owned()))
            .filter(collection::Column::Name.eq(input.collection_name))
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let col = metadata_to_collection::ActiveModel {
            metadata_id: ActiveValue::Set(i32::from(input.media_id)),
            collection_id: ActiveValue::Set(collection.id),
        };
        Ok(col.clone().insert(&self.db).await.is_ok())
    }

    pub async fn start_import_job(
        &self,
        user_id: i32,
        source: MediaImportSource,
    ) -> Result<media_import_report::Model> {
        let model = media_import_report::ActiveModel {
            user_id: ActiveValue::Set(user_id),
            source: ActiveValue::Set(source),
            ..Default::default()
        };
        let model = model.insert(&self.db).await.unwrap();
        tracing::info!("Started import job with id = {id}", id = model.id);
        Ok(model)
    }

    pub async fn finish_import_job(
        &self,
        job: media_import_report::Model,
        details: ImportResultResponse,
    ) -> Result<media_import_report::Model> {
        let mut model: media_import_report::ActiveModel = job.into();
        model.finished_on = ActiveValue::Set(Some(Utc::now()));
        model.details = ActiveValue::Set(Some(details));
        model.success = ActiveValue::Set(Some(true));
        let model = model.update(&self.db).await.unwrap();
        Ok(model)
    }

    pub async fn media_import_reports(
        &self,
        user_id: i32,
    ) -> Result<Vec<media_import_report::Model>> {
        let reports = MediaImportReport::find()
            .filter(media_import_report::Column::UserId.eq(user_id))
            .all(&self.db)
            .await
            .unwrap();
        Ok(reports)
    }

    pub async fn delete_seen_item(&self, seen_id: i32, user_id: i32) -> Result<IdObject> {
        let seen_item = Seen::find_by_id(seen_id).one(&self.db).await.unwrap();
        if let Some(si) = seen_item {
            let seen_id = si.id;
            let progress = si.progress;
            let metadata_id = si.metadata_id;
            if si.user_id != user_id {
                return Err(Error::new(
                    "This seen item does not belong to this user".to_owned(),
                ));
            }
            si.delete(&self.db).await.ok();
            if progress < 100 {
                self.remove_media_item_from_collection(
                    &user_id,
                    &metadata_id,
                    &DefaultCollection::InProgress.to_string(),
                )
                .await
                .ok();
            }
            Ok(IdObject { id: seen_id.into() })
        } else {
            Err(Error::new("This seen item does not exist".to_owned()))
        }
    }

    pub async fn cleanup_summaries_for_user(&self, user_id: &i32) -> Result<()> {
        let summaries = Summary::delete_many()
            .filter(summary::Column::UserId.eq(user_id.to_owned()))
            .exec(&self.db)
            .await
            .unwrap();
        tracing::trace!(
            "Deleted {} summaries for user {}",
            summaries.rows_affected,
            user_id
        );
        Ok(())
    }

    pub async fn update_metadata(&self, metadata: metadata::Model) -> Result<()> {
        let metadata_id = metadata.id;
        tracing::info!("Updating metadata for {:?}", Identifier::from(metadata_id));
        let maybe_details = self
            .details_from_provider_for_existing_media(metadata_id)
            .await;
        match maybe_details {
            Ok(details) => {
                self.update_media(
                    metadata_id,
                    details.title,
                    details.description,
                    details.images,
                    details.creators,
                    details.specifics,
                    details.genres,
                )
                .await
                .ok();
            }
            Err(e) => {
                tracing::error!("Error while updating: {:?}", e);
            }
        }

        Ok(())
    }

    pub async fn update_all_metadata(&self) -> Result<bool> {
        let metadatas = Metadata::find()
            .order_by_asc(metadata::Column::Id)
            .all(&self.db)
            .await
            .unwrap();
        for metadata in metadatas {
            self.deploy_update_metadata_job(metadata.id).await?;
        }
        Ok(true)
    }

    async fn user_details(&self, token: &str) -> Result<UserDetailsResult> {
        let found_token = self.scdb.lock().unwrap().get(token.as_bytes()).unwrap();
        if let Some(t) = found_token {
            let user_id = std::str::from_utf8(&t).unwrap().parse::<i32>().unwrap();
            let user = self.user_by_id(user_id).await?;
            Ok(UserDetailsResult::Ok(user))
        } else {
            Ok(UserDetailsResult::Error(UserDetailsError {
                error: UserDetailsErrorVariant::AuthTokenInvalid,
            }))
        }
    }

    async fn user_by_id(&self, user_id: i32) -> Result<user::Model> {
        User::find_by_id(user_id)
            .one(&self.db)
            .await
            .unwrap()
            .ok_or_else(|| Error::new("No user found"))
    }

    async fn latest_user_summary(&self, user_id: &i32) -> Result<summary::Model> {
        let ls = Summary::find()
            .filter(summary::Column::UserId.eq(user_id.to_owned()))
            .order_by_desc(summary::Column::CreatedOn)
            .one(&self.db)
            .await
            .unwrap_or_default()
            .unwrap_or_default();
        Ok(ls)
    }

    async fn user_summary(&self, user_id: &i32) -> Result<UserSummary> {
        let ls = self.latest_user_summary(user_id).await?;
        Ok(ls.data)
    }

    pub async fn calculate_user_summary(&self, user_id: &i32) -> Result<IdObject> {
        let mut ls = summary::Model::default();
        let mut seen_items = Seen::find()
            .filter(seen::Column::UserId.eq(user_id.to_owned()))
            .filter(seen::Column::UserId.eq(user_id.to_owned()))
            .filter(seen::Column::Progress.eq(100))
            .find_also_related(Metadata)
            .stream(&self.db)
            .await?;

        let mut unique_shows = HashSet::new();
        let mut unique_show_seasons = HashSet::new();
        let mut unique_podcasts = HashSet::new();
        let mut unique_podcast_episodes = HashSet::new();
        while let Some((seen, metadata)) = seen_items.try_next().await.unwrap() {
            let meta = metadata.to_owned().unwrap();
            match meta.specifics {
                MediaSpecifics::AudioBook(item) => {
                    ls.data.audio_books.played += 1;
                    if let Some(r) = item.runtime {
                        ls.data.audio_books.runtime += r;
                    }
                }
                MediaSpecifics::Anime(item) => {
                    ls.data.anime.watched += 1;
                    if let Some(r) = item.episodes {
                        ls.data.anime.episodes += r;
                    }
                }
                MediaSpecifics::Manga(item) => {
                    ls.data.manga.read += 1;
                    if let Some(r) = item.chapters {
                        ls.data.manga.chapters += r;
                    }
                }
                MediaSpecifics::Book(item) => {
                    ls.data.books.read += 1;
                    if let Some(pg) = item.pages {
                        ls.data.books.pages += pg;
                    }
                }
                MediaSpecifics::Podcast(item) => {
                    unique_podcasts.insert(seen.metadata_id);
                    for episode in item.episodes {
                        match seen.extra_information.to_owned() {
                            None => continue,
                            Some(sei) => match sei {
                                SeenExtraInformation::Show(_) => unreachable!(),
                                SeenExtraInformation::Podcast(s) => {
                                    if s.episode == episode.number {
                                        if let Some(r) = episode.runtime {
                                            ls.data.podcasts.runtime += r;
                                        }
                                        unique_podcast_episodes.insert((s.episode, episode.id));
                                    }
                                }
                            },
                        }
                    }
                }
                MediaSpecifics::Movie(item) => {
                    ls.data.movies.watched += 1;
                    if let Some(r) = item.runtime {
                        ls.data.movies.runtime += r;
                    }
                }
                MediaSpecifics::Show(item) => {
                    unique_shows.insert(seen.metadata_id);
                    for season in item.seasons {
                        for episode in season.episodes {
                            match seen.extra_information.to_owned().unwrap() {
                                SeenExtraInformation::Podcast(_) => unreachable!(),
                                SeenExtraInformation::Show(s) => {
                                    if s.season == season.season_number
                                        && s.episode == episode.episode_number
                                    {
                                        if let Some(r) = episode.runtime {
                                            ls.data.shows.runtime += r;
                                        }
                                        ls.data.shows.watched_episodes += 1;
                                        unique_show_seasons.insert((s.season, season.id));
                                    }
                                }
                            }
                        }
                    }
                }
                MediaSpecifics::VideoGame(_item) => {
                    ls.data.video_games.played += 1;
                }
                MediaSpecifics::Unknown => {}
            }
        }

        ls.data.podcasts.played += i32::try_from(unique_podcasts.len()).unwrap();
        ls.data.podcasts.played_episodes += i32::try_from(unique_podcast_episodes.len()).unwrap();

        ls.data.shows.watched = i32::try_from(unique_shows.len()).unwrap();
        ls.data.shows.watched_seasons += i32::try_from(unique_show_seasons.len()).unwrap();

        let summary_obj = summary::ActiveModel {
            id: ActiveValue::NotSet,
            created_on: ActiveValue::NotSet,
            user_id: ActiveValue::Set(user_id.to_owned()),
            data: ActiveValue::Set(ls.data),
        };
        let obj = summary_obj.insert(&self.db).await.unwrap();
        Ok(IdObject { id: obj.id.into() })
    }

    async fn register_user(
        &self,
        username: &str,
        password: &str,
        config: &AppConfig,
    ) -> Result<RegisterResult> {
        if !config.users.allow_registration {
            return Ok(RegisterResult::Error(RegisterError {
                error: RegisterErrorVariant::Disabled,
            }));
        }
        let mut storage = self.user_created.clone();
        if User::find()
            .filter(user::Column::Name.eq(username))
            .count(&self.db)
            .await
            .unwrap()
            != 0
        {
            return Ok(RegisterResult::Error(RegisterError {
                error: RegisterErrorVariant::UsernameAlreadyExists,
            }));
        };
        let lot = if User::find().count(&self.db).await.unwrap() == 0 {
            UserLot::Admin
        } else {
            UserLot::Normal
        };
        let user = user::ActiveModel {
            name: ActiveValue::Set(username.to_owned()),
            password: ActiveValue::Set(password.to_owned()),
            lot: ActiveValue::Set(lot),
            ..Default::default()
        };
        let user = user.insert(&self.db).await.unwrap();
        storage
            .push(UserCreatedJob {
                user_id: user.id.into(),
            })
            .await?;
        Ok(RegisterResult::Ok(IdObject { id: user.id.into() }))
    }

    async fn login_user(
        &self,
        username: &str,
        password: &str,
        valid_for_days: i32,
    ) -> Result<LoginResult> {
        let user = User::find()
            .filter(user::Column::Name.eq(username))
            .one(&self.db)
            .await
            .unwrap();
        if user.is_none() {
            return Ok(LoginResult::Error(LoginError {
                error: LoginErrorVariant::UsernameDoesNotExist,
            }));
        };
        let user = user.unwrap();
        let parsed_hash = PasswordHash::new(&user.password).unwrap();
        if get_hasher()
            .verify_password(password.as_bytes(), &parsed_hash)
            .is_err()
        {
            return Ok(LoginResult::Error(LoginError {
                error: LoginErrorVariant::CredentialsMismatch,
            }));
        }
        let api_key = Uuid::new_v4().to_string();

        if self
            .set_auth_token(
                &api_key,
                &user.id,
                Some(
                    ChronoDuration::days(valid_for_days.into())
                        .num_seconds()
                        .try_into()
                        .unwrap(),
                ),
            )
            .is_err()
        {
            return Ok(LoginResult::Error(LoginError {
                error: LoginErrorVariant::MutexError,
            }));
        };
        Ok(LoginResult::Ok(LoginResponse { api_key }))
    }

    async fn logout_user(&self, token: &str) -> Result<bool> {
        let found_token = self.scdb.lock().unwrap().get(token.as_bytes()).unwrap();
        if let Some(t) = found_token {
            self.scdb.lock().unwrap().delete(&t)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    // this job is run when a user is created for the first time
    pub async fn user_created_job(&self, user_id: &i32) -> Result<()> {
        for collection in DefaultCollection::iter() {
            self.create_collection(
                user_id,
                NamedObject {
                    name: collection.to_string(),
                },
            )
            .await
            .ok();
        }
        Ok(())
    }

    async fn update_user(
        &self,
        user_id: &i32,
        input: UpdateUserInput,
        config: &AppConfig,
    ) -> Result<IdObject> {
        let mut user_obj: user::ActiveModel = User::find_by_id(user_id.to_owned())
            .one(&self.db)
            .await
            .unwrap()
            .unwrap()
            .into();
        if let Some(n) = input.username {
            if config.users.allow_changing_username {
                user_obj.name = ActiveValue::Set(n);
            }
        }
        if let Some(e) = input.email {
            user_obj.email = ActiveValue::Set(Some(e));
        }
        if let Some(p) = input.password {
            user_obj.password = ActiveValue::Set(p);
        }
        let user_obj = user_obj.update(&self.db).await.unwrap();
        Ok(IdObject {
            id: user_obj.id.into(),
        })
    }

    pub async fn regenerate_user_summaries(&self) -> Result<()> {
        let all_users = User::find().all(&self.db).await.unwrap();
        for user in all_users {
            self.cleanup_summaries_for_user(&user.id).await?;
            self.calculate_user_summary(&user.id).await?;
        }
        Ok(())
    }

    pub async fn regenerate_user_summary(&self, user_id: i32) -> Result<bool> {
        self.cleanup_summaries_for_user(&user_id).await?;
        self.deploy_recalculate_summary_job(user_id).await?;
        Ok(true)
    }

    async fn create_custom_media(
        &self,
        input: CreateCustomMediaInput,
        user_id: &i32,
    ) -> Result<CreateCustomMediaResult> {
        let mut input = input;
        let err = || {
            Ok(CreateCustomMediaResult::Error(CreateCustomMediaError {
                error: CreateCustomMediaErrorVariant::LotDoesNotMatchSpecifics,
            }))
        };
        let specifics = match input.lot {
            MetadataLot::AudioBook => match input.audio_book_specifics {
                None => return err(),
                Some(ref mut s) => MediaSpecifics::AudioBook(s.clone()),
            },
            MetadataLot::Book => match input.book_specifics {
                None => return err(),
                Some(ref mut s) => MediaSpecifics::Book(s.clone()),
            },
            MetadataLot::Movie => match input.movie_specifics {
                None => return err(),
                Some(ref mut s) => MediaSpecifics::Movie(s.clone()),
            },
            MetadataLot::Podcast => match input.podcast_specifics {
                None => return err(),
                Some(ref mut s) => MediaSpecifics::Podcast(s.clone()),
            },
            MetadataLot::Show => match input.show_specifics {
                None => return err(),
                Some(ref mut s) => MediaSpecifics::Show(s.clone()),
            },
            MetadataLot::VideoGame => match input.video_game_specifics {
                None => return err(),
                Some(ref mut s) => MediaSpecifics::VideoGame(s.clone()),
            },
            MetadataLot::Anime => match input.anime_specifics {
                None => return err(),
                Some(ref mut s) => MediaSpecifics::Anime(s.clone()),
            },
            MetadataLot::Manga => match input.manga_specifics {
                None => return err(),
                Some(ref mut s) => MediaSpecifics::Manga(s.clone()),
            },
        };
        let identifier = Uuid::new_v4().to_string();
        let images = input
            .images
            .unwrap_or_default()
            .into_iter()
            .map(|i| MetadataImage {
                url: MetadataImageUrl::S3(i),
                lot: MetadataImageLot::Poster,
            })
            .collect();
        let creators = input
            .creators
            .unwrap_or_default()
            .into_iter()
            .map(|c| MetadataCreator {
                name: c,
                role: "Creator".to_string(),
                image_urls: vec![],
            })
            .collect();
        let details = MediaDetails {
            identifier,
            title: input.title,
            description: input.description,
            lot: input.lot,
            source: MetadataSource::Custom,
            creators,
            genres: input.genres.unwrap_or_default(),
            images,
            publish_year: input.publish_year,
            publish_date: None,
            specifics,
        };
        let media = self.commit_media_internal(details).await?;
        self.add_media_to_collection(
            user_id,
            AddMediaToCollection {
                collection_name: DefaultCollection::Custom.to_string(),
                media_id: media.id,
            },
        )
        .await?;
        Ok(CreateCustomMediaResult::Ok(media))
    }

    pub async fn json_export(&self, user_id: i32) -> Result<Vec<ExportMedia>> {
        let related_metadata = UserToMetadata::find()
            .filter(user_to_metadata::Column::UserId.eq(user_id))
            .all(&self.db)
            .await
            .unwrap();
        let distinct_meta_ids = related_metadata
            .into_iter()
            .map(|m| m.metadata_id)
            .collect::<Vec<_>>();
        let metas = Metadata::find()
            .filter(metadata::Column::Id.is_in(distinct_meta_ids))
            .order_by(metadata::Column::Id, Order::Asc)
            .all(&self.db)
            .await?;

        let mut resp = vec![];

        for m in metas {
            let seens = m
                .find_related(Seen)
                .filter(seen::Column::UserId.eq(user_id))
                .all(&self.db)
                .await
                .unwrap();
            let reviews = m
                .find_related(Review)
                .filter(review::Column::UserId.eq(user_id))
                .all(&self.db)
                .await
                .unwrap();
            let mut exp = ExportMedia {
                ryot_id: m.id,
                title: m.title,
                lot: m.lot,
                audible_id: None,
                custom_id: None,
                igdb_id: None,
                listennotes_id: None,
                openlibrary_id: None,
                tmdb_id: None,
                anilist_id: None,
                seen_history: seens,
                user_reviews: reviews,
            };
            match m.source {
                MetadataSource::Audible => exp.audible_id = Some(m.identifier),
                MetadataSource::Custom => exp.custom_id = Some(m.identifier),
                MetadataSource::Igdb => exp.igdb_id = Some(m.identifier),
                MetadataSource::Listennotes => exp.listennotes_id = Some(m.identifier),
                MetadataSource::Openlibrary => exp.openlibrary_id = Some(m.identifier),
                MetadataSource::Tmdb => exp.tmdb_id = Some(m.identifier),
                MetadataSource::Anilist => exp.anilist_id = Some(m.identifier),
            };
            resp.push(exp);
        }

        Ok(resp)
    }

    fn get_sql_and_values(&self, stmt: SelectStatement) -> (String, Values) {
        match self.db.get_database_backend() {
            DatabaseBackend::MySql => stmt.build(MySqlQueryBuilder {}),
            DatabaseBackend::Postgres => stmt.build(PostgresQueryBuilder {}),
            DatabaseBackend::Sqlite => stmt.build(SqliteQueryBuilder {}),
        }
    }

    fn get_db_stmt(&self, stmt: SelectStatement) -> Statement {
        let (sql, values) = self.get_sql_and_values(stmt);

        Statement::from_sql_and_values(self.db.get_database_backend(), &sql, values)
    }

    async fn update_user_preferences(
        &self,
        input: UpdateUserPreferencesInput,
        user_id: i32,
    ) -> Result<bool> {
        let user_model = self.user_by_id(user_id).await?;
        let mut preferences = user_model.preferences.clone();
        match input.property {
            MetadataLot::AudioBook => preferences.audio_books = input.value,
            MetadataLot::Book => preferences.books = input.value,
            MetadataLot::Movie => preferences.movies = input.value,
            MetadataLot::Podcast => preferences.podcasts = input.value,
            MetadataLot::Show => preferences.shows = input.value,
            MetadataLot::VideoGame => preferences.video_games = input.value,
            MetadataLot::Manga => preferences.manga = input.value,
            MetadataLot::Anime => preferences.anime = input.value,
        };
        let mut user_model: user::ActiveModel = user_model.into();
        user_model.preferences = ActiveValue::Set(preferences);
        user_model.update(&self.db).await?;
        Ok(true)
    }

    async fn generate_application_token(&self, user_id: i32) -> Result<String> {
        let api_token = Uuid::new_v4().to_string();
        self.set_auth_token(&api_token, &user_id, None)
            .map_err(|_| Error::new("Could not set auth token"))?;
        Ok(api_token)
    }

    fn set_auth_token(&self, api_key: &str, user_id: &i32, ttl: Option<u64>) -> anyhow::Result<()> {
        match self.scdb.lock() {
            Ok(mut d) => d.set(api_key.as_bytes(), user_id.to_string().as_bytes(), ttl)?,
            Err(e) => {
                tracing::error!("{:?}", e);
                Err(anyhow::anyhow!(
                    "Could not lock auth database due to mutex poisoning"
                ))?
            }
        };
        Ok(())
    }

    async fn media_exists_in_database(
        &self,
        identifier: String,
        lot: MetadataLot,
    ) -> Result<Option<IdObject>> {
        let media = Metadata::find()
            .filter(metadata::Column::Lot.eq(lot))
            .filter(metadata::Column::Identifier.eq(identifier))
            .one(&self.db)
            .await?;
        Ok(media.map(|m| IdObject { id: m.id.into() }))
    }
}
