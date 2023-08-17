use std::{
    collections::{HashMap, HashSet},
    iter::zip,
    str::FromStr,
    sync::{Arc, OnceLock},
};

use anyhow::anyhow;
use apalis::{prelude::Storage as ApalisStorage, sqlite::SqliteStorage};
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use async_graphql::{Context, Enum, Error, InputObject, Object, Result, SimpleObject, Union};
use chrono::{Duration as ChronoDuration, NaiveDate, Utc};
use cookie::{time::Duration as CookieDuration, time::OffsetDateTime, Cookie, SameSite};
use enum_meta::Meta;
use futures::{future::join_all, TryStreamExt};
use harsh::Harsh;
use http::header::SET_COOKIE;
use itertools::Itertools;
use markdown::{
    to_html as markdown_to_html, to_html_with_options as markdown_to_html_opts, CompileOptions,
    Options,
};
use nanoid::nanoid;
use retainer::Cache;
use rust_decimal::Decimal;
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, ActiveValue, ColumnTrait, ConnectionTrait,
    DatabaseBackend, DatabaseConnection, EntityTrait, FromQueryResult, Iden, ItemsAndPagesNumber,
    Iterable, JoinType, ModelTrait, Order, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect,
    QueryTrait, Statement,
};
use sea_query::{
    Alias, Asterisk, Cond, Condition, Expr, Func, Keyword, MySqlQueryBuilder, NullOrdering,
    PostgresQueryBuilder, Query, SelectStatement, SqliteQueryBuilder, UnionType, Values,
};
use semver::Version;
use serde::{Deserialize, Serialize};
use surf::http::headers::USER_AGENT;
use uuid::Uuid;

use crate::{
    background::{RecalculateUserSummaryJob, UpdateMetadataJob, UserCreatedJob},
    config::AppConfig,
    entities::{
        collection, creator, genre, metadata, metadata_to_collection, metadata_to_creator,
        metadata_to_genre,
        prelude::{
            Collection, Creator, Genre, Metadata, MetadataToCollection, MetadataToCreator,
            MetadataToGenre, Review, Seen, User, UserMeasurement, UserToMetadata,
        },
        review, seen, user, user_measurement, user_to_metadata,
    },
    file_storage::FileStorageService,
    integrations::{IntegrationMedia, IntegrationService},
    migrator::{
        Metadata as TempMetadata, MetadataImageLot, MetadataLot, MetadataSource,
        Review as TempReview, Seen as TempSeen, SeenState, UserLot,
        UserToMetadata as TempUserToMetadata,
    },
    miscellaneous::{CustomService, DefaultCollection},
    models::{
        media::{
            AddMediaToCollection, AnimeSpecifics, AudioBookSpecifics, BookSpecifics,
            CreateOrUpdateCollectionInput, CreatorExtraInformation, ImportOrExportItem,
            ImportOrExportItemRating, ImportOrExportItemReview, ImportOrExportItemSeen,
            MangaSpecifics, MediaCreatorSearchItem, MediaDetails, MediaListItem, MediaSearchItem,
            MediaSearchItemResponse, MediaSearchItemWithLot, MediaSpecifics, MetadataCreator,
            MetadataImage, MetadataImageUrl, MetadataImages, MovieSpecifics, MusicSpecifics,
            PodcastSpecifics, PostReviewInput, ProgressUpdateError, ProgressUpdateErrorVariant,
            ProgressUpdateInput, ProgressUpdateResultUnion, SeenOrReviewExtraInformation,
            SeenPodcastExtraInformation, SeenShowExtraInformation, ShowSpecifics,
            UserMediaReminder, UserSummary, VideoGameSpecifics, Visibility,
        },
        IdObject, SearchDetails, SearchInput, SearchResults,
    },
    providers::{
        anilist::{AnilistAnimeService, AnilistMangaService, AnilistService},
        audible::AudibleService,
        google_books::GoogleBooksService,
        igdb::IgdbService,
        itunes::ITunesService,
        listennotes::ListennotesService,
        music_brainz::MusicBrainzService,
        openlibrary::OpenlibraryService,
        tmdb::{TmdbMovieService, TmdbService, TmdbShowService},
    },
    traits::{AuthProvider, IsFeatureEnabled, MediaProvider, MediaProviderLanguages},
    users::{
        UserDistanceUnit, UserNotification, UserNotificationSetting, UserNotificationSettingKind,
        UserNotifications, UserPreferences, UserSinkIntegration, UserSinkIntegrationSetting,
        UserSinkIntegrationSettingKind, UserSinkIntegrations, UserWeightUnit, UserYankIntegration,
        UserYankIntegrationSetting, UserYankIntegrationSettingKind, UserYankIntegrations,
    },
    utils::{
        associate_user_with_metadata, convert_naive_to_utc, get_case_insensitive_like_query,
        get_user_and_metadata_association, user_id_from_token, MemoryAuthData, MemoryDatabase,
        AUTHOR, COOKIE_NAME, PAGE_LIMIT, USER_AGENT_STR, VERSION,
    },
};

type Provider = Box<(dyn MediaProvider + Send + Sync)>;

#[derive(Debug)]
pub enum MediaStateChanged {
    StatusChanged,
    EpisodeReleased,
    ReleaseDateChanged,
    NumberOfSeasonsChanged,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct CreateCustomMediaInput {
    title: String,
    lot: MetadataLot,
    description: Option<String>,
    creators: Option<Vec<String>>,
    genres: Option<Vec<String>>,
    images: Option<Vec<String>>,
    publish_year: Option<i32>,
    audio_book_specifics: Option<AudioBookSpecifics>,
    book_specifics: Option<BookSpecifics>,
    movie_specifics: Option<MovieSpecifics>,
    podcast_specifics: Option<PodcastSpecifics>,
    show_specifics: Option<ShowSpecifics>,
    video_game_specifics: Option<VideoGameSpecifics>,
    manga_specifics: Option<MangaSpecifics>,
    anime_specifics: Option<AnimeSpecifics>,
}

#[derive(Enum, Serialize, Deserialize, Clone, Debug, Copy, PartialEq, Eq)]
enum UserIntegrationLot {
    Yank,
    Sink,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct GraphqlUserIntegration {
    id: usize,
    description: String,
    timestamp: DateTimeUtc,
    lot: UserIntegrationLot,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct CreateUserYankIntegrationInput {
    lot: UserYankIntegrationSettingKind,
    base_url: String,
    #[graphql(secret)]
    token: String,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct GraphqlUserNotificationPlatform {
    id: usize,
    description: String,
    timestamp: DateTimeUtc,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct CreateUserNotificationPlatformInput {
    lot: UserNotificationSettingKind,
    base_url: Option<String>,
    #[graphql(secret)]
    api_token: Option<String>,
    priority: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct CreateUserSinkIntegrationInput {
    lot: UserSinkIntegrationSettingKind,
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
enum CreateCustomMediaErrorVariant {
    LotDoesNotMatchSpecifics,
}

#[derive(Debug, SimpleObject)]
struct ProviderLanguageInformation {
    source: MetadataSource,
    supported: Vec<String>,
    default: String,
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
enum UserDetailsErrorVariant {
    AuthTokenInvalid,
}

#[derive(Debug, SimpleObject)]
struct UserDetailsError {
    error: UserDetailsErrorVariant,
}

#[derive(Union)]
enum UserDetailsResult {
    Ok(Box<user::Model>),
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

#[derive(Debug, InputObject)]
struct UpdateUserPreferenceInput {
    property: String,
    value: String,
}

#[derive(Debug, InputObject)]
struct CollectionContentsInput {
    collection_id: i32,
    page: Option<u64>,
    take: Option<u64>,
}

#[derive(Debug, SimpleObject)]
struct CollectionContents {
    details: collection::Model,
    results: SearchResults<MediaSearchItemWithLot>,
    user: user::Model,
}

#[derive(Debug, SimpleObject)]
struct ReviewPostedBy {
    id: i32,
    name: String,
}

#[derive(Debug, SimpleObject)]
struct ReviewItem {
    id: i32,
    posted_on: DateTimeUtc,
    rating: Option<Decimal>,
    text: Option<String>,
    visibility: Visibility,
    spoiler: bool,
    posted_by: ReviewPostedBy,
    show_season: Option<i32>,
    show_episode: Option<i32>,
    podcast_episode: Option<i32>,
}

#[derive(Debug, SimpleObject)]
struct CollectionItem {
    id: i32,
    name: String,
    num_items: u64,
    description: Option<String>,
    visibility: Visibility,
}

#[derive(SimpleObject)]
struct GeneralFeatures {
    file_storage: bool,
    signup_allowed: bool,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct MetadataCreatorGroupedByRole {
    name: String,
    items: Vec<creator::Model>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct CreatorDetails {
    details: creator::Model,
    contents: Vec<CreatorDetailsGroupedByRole>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct CreatorDetailsGroupedByRole {
    /// The name of the role performed.
    name: String,
    /// The media items in which this role was performed.
    items: Vec<MediaSearchItemWithLot>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MediaBaseData {
    model: metadata::Model,
    creators: Vec<MetadataCreatorGroupedByRole>,
    poster_images: Vec<String>,
    backdrop_images: Vec<String>,
    genres: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct GraphqlMediaDetails {
    id: i32,
    title: String,
    identifier: String,
    description: Option<String>,
    production_status: String,
    lot: MetadataLot,
    source: MetadataSource,
    creators: Vec<MetadataCreatorGroupedByRole>,
    genres: Vec<String>,
    poster_images: Vec<String>,
    backdrop_images: Vec<String>,
    publish_year: Option<i32>,
    publish_date: Option<NaiveDate>,
    book_specifics: Option<BookSpecifics>,
    movie_specifics: Option<MovieSpecifics>,
    show_specifics: Option<ShowSpecifics>,
    video_game_specifics: Option<VideoGameSpecifics>,
    audio_book_specifics: Option<AudioBookSpecifics>,
    podcast_specifics: Option<PodcastSpecifics>,
    manga_specifics: Option<MangaSpecifics>,
    music_specifics: Option<MusicSpecifics>,
    anime_specifics: Option<AnimeSpecifics>,
    source_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
enum MediaSortOrder {
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
enum MediaSortBy {
    Title,
    #[default]
    ReleaseDate,
    LastSeen,
    LastUpdated,
    Rating,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct MediaSortInput {
    #[graphql(default)]
    order: MediaSortOrder,
    #[graphql(default)]
    by: MediaSortBy,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, Copy, Eq, PartialEq)]
enum MediaGeneralFilter {
    All,
    Rated,
    Unrated,
    InProgress,
    Dropped,
    OnAHold,
    Completed,
    Unseen,
    ExplicitlyMonitored,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct MediaFilter {
    general: Option<MediaGeneralFilter>,
    collection: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct MediaListInput {
    page: i32,
    lot: MetadataLot,
    query: Option<String>,
    filter: Option<MediaFilter>,
    sort: Option<MediaSortInput>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct CollectionInput {
    name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct MediaConsumedInput {
    identifier: String,
    lot: MetadataLot,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct UserAuthToken {
    token: String,
    last_used_on: DateTimeUtc,
}

#[derive(Enum, Eq, PartialEq, Copy, Clone)]
enum UpgradeType {
    Minor,
    Major,
}

#[derive(SimpleObject)]
struct CoreDetails {
    docs_link: String,
    version: String,
    author_name: String,
    repository_link: String,
    default_credentials: bool,
    password_change_allowed: bool,
    preferences_change_allowed: bool,
    username_change_allowed: bool,
    item_details_height: u32,
    reviews_disabled: bool,
    /// Whether an upgrade is required
    upgrade: Option<UpgradeType>,
    /// The number of elements on a page
    page_limit: i32,
}

#[derive(Debug, Ord, PartialEq, Eq, PartialOrd, Clone)]
struct ProgressUpdateCache {
    user_id: i32,
    metadata_id: i32,
    show_season_number: Option<i32>,
    show_episode_number: Option<i32>,
    podcast_episode_number: Option<i32>,
}

#[derive(SimpleObject)]
struct UserCreatorDetails {
    reviews: Vec<ReviewItem>,
}

#[derive(SimpleObject)]
struct UserMediaDetails {
    /// The collections in which this media is present.
    collections: Vec<collection::Model>,
    /// The public reviews of this media.
    reviews: Vec<ReviewItem>,
    /// The seen history of this media.
    history: Vec<seen::Model>,
    /// The seen item if it is in progress.
    in_progress: Option<seen::Model>,
    /// The next episode of this media.
    next_episode: Option<UserMediaNextEpisode>,
    /// Whether the user is monitoring this media.
    is_monitored: bool,
    /// The reminder that the user has set for this media.
    reminder: Option<UserMediaReminder>,
    /// The number of users who have seen this media
    seen_by: i32,
}

#[derive(SimpleObject)]
struct UserMediaNextEpisode {
    season_number: Option<i32>,
    episode_number: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct CreateMediaReminderInput {
    metadata_id: i32,
    remind_on: NaiveDate,
    message: String,
}

fn create_cookie(
    ctx: &Context<'_>,
    api_key: &str,
    expires: bool,
    insecure_cookie: bool,
    samesite_none: bool,
    token_valid_till: i64,
) -> Result<()> {
    let mut cookie = Cookie::build(COOKIE_NAME, api_key.to_string()).secure(!insecure_cookie);
    cookie = if expires {
        cookie.expires(OffsetDateTime::now_utc())
    } else {
        cookie
            .expires(OffsetDateTime::now_utc().checked_add(CookieDuration::days(token_valid_till)))
    };
    cookie = if samesite_none {
        cookie.same_site(SameSite::None)
    } else {
        cookie.same_site(SameSite::Strict)
    };
    let cookie = cookie.finish();
    ctx.insert_http_header(SET_COOKIE, cookie.to_string());
    Ok(())
}

fn get_password_hasher() -> Argon2<'static> {
    Argon2::default()
}

fn get_id_hasher(salt: &str) -> Harsh {
    Harsh::builder().length(10).salt(salt).build().unwrap()
}

#[derive(Default)]
pub struct MiscellaneousQuery;

#[Object]
impl MiscellaneousQuery {
    /// Get some primary information about the service.
    async fn core_details(&self, gql_ctx: &Context<'_>) -> Result<CoreDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.core_details().await
    }

    /// Get a review by its ID.
    async fn review_by_id(&self, gql_ctx: &Context<'_>, review_id: i32) -> Result<ReviewItem> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.review_by_id(review_id).await
    }

    /// Get all collections for the currently logged in user.
    async fn collections(
        &self,
        gql_ctx: &Context<'_>,
        input: Option<CollectionInput>,
    ) -> Result<Vec<CollectionItem>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.collections(user_id, input).await
    }

    /// Get the contents of a collection and respect visibility.
    async fn collection_contents(
        &self,
        gql_ctx: &Context<'_>,
        input: CollectionContentsInput,
    ) -> Result<CollectionContents> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await.ok();
        service.collection_contents(user_id, input).await
    }

    /// Get details about a media present in the database.
    async fn media_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: i32,
    ) -> Result<GraphqlMediaDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.media_details(metadata_id).await
    }

    /// Get details about a creator present in the database.
    async fn creator_details(
        &self,
        gql_ctx: &Context<'_>,
        creator_id: i32,
    ) -> Result<CreatorDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.creator_details(creator_id).await
    }

    /// Get all the media items related to a user for a specific media type.
    async fn media_list(
        &self,
        gql_ctx: &Context<'_>,
        input: MediaListInput,
    ) -> Result<SearchResults<MediaListItem>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.media_list(user_id, input).await
    }

    /// Get a presigned URL (valid for 90 minutes) for a given key.
    async fn get_presigned_url(&self, gql_ctx: &Context<'_>, key: String) -> String {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.files_storage_service.get_presigned_url(key).await
    }

    /// Get all the features that are enabled for the service
    async fn core_enabled_features(&self, gql_ctx: &Context<'_>) -> Result<GeneralFeatures> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.core_enabled_features().await
    }

    /// Get a user's preferences.
    async fn user_preferences(&self, gql_ctx: &Context<'_>) -> Result<UserPreferences> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_preferences(user_id).await
    }

    /// Search for a list of media for a given type.
    async fn media_search(
        &self,
        gql_ctx: &Context<'_>,
        lot: MetadataLot,
        source: MetadataSource,
        input: SearchInput,
    ) -> Result<SearchResults<MediaSearchItemResponse>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.media_search(lot, source, input).await
    }

    /// Check if a media with the given metadata and identifier exists in the database.
    async fn media_exists_in_database(
        &self,
        gql_ctx: &Context<'_>,
        identifier: String,
        lot: MetadataLot,
        source: MetadataSource,
    ) -> Result<Option<IdObject>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service
            .media_exists_in_database(lot, source, &identifier)
            .await
    }

    /// Get all the metadata sources possible for a lot.
    async fn media_sources_for_lot(
        &self,
        gql_ctx: &Context<'_>,
        lot: MetadataLot,
    ) -> Vec<MetadataSource> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.media_sources_for_lot(lot).await
    }

    /// Get all languages supported by all the providers.
    async fn providers_language_information(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Vec<ProviderLanguageInformation> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.providers_language_information()
    }

    /// Get details about all the users in the service.
    async fn users_list(&self, gql_ctx: &Context<'_>) -> Result<Vec<user::Model>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.admin_account_guard(user_id).await?;
        service.users_list().await
    }

    /// Get details about the currently logged in user.
    async fn user_details(&self, gql_ctx: &Context<'_>) -> Result<UserDetailsResult> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let token = service.user_auth_token_from_ctx(gql_ctx)?;
        service.user_details(&token).await
    }

    /// Get a summary of all the media items that have been consumed by this user.
    async fn latest_user_summary(&self, gql_ctx: &Context<'_>) -> Result<UserSummary> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.latest_user_summary(user_id).await
    }

    /// Get all the integrations for the currently logged in user.
    async fn user_integrations(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<Vec<GraphqlUserIntegration>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_integrations(user_id).await
    }

    /// Get all the notification platforms for the currently logged in user.
    async fn user_notification_platforms(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<Vec<GraphqlUserNotificationPlatform>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_notification_platforms(user_id).await
    }

    /// Get all the auth tokens issued to the currently logged in user.
    async fn user_auth_tokens(&self, gql_ctx: &Context<'_>) -> Result<Vec<UserAuthToken>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_auth_tokens(user_id).await
    }

    /// Get details that can be displayed to a user for a media.
    async fn user_media_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: i32,
    ) -> Result<UserMediaDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_media_details(user_id, metadata_id).await
    }

    /// Get details that can be displayed to a user for a creator.
    async fn user_creator_details(
        &self,
        gql_ctx: &Context<'_>,
        creator_id: i32,
    ) -> Result<UserCreatorDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_creator_details(user_id, creator_id).await
    }

    /// Get paginated list of creators.
    async fn creators_list(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<SearchResults<MediaCreatorSearchItem>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.creators_list(input).await
    }
}

#[derive(Default)]
pub struct MiscellaneousMutation;

#[Object]
impl MiscellaneousMutation {
    /// Create or update a review.
    async fn post_review(&self, gql_ctx: &Context<'_>, input: PostReviewInput) -> Result<IdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.post_review(user_id, input).await
    }

    /// Delete a review if it belongs to the currently logged in user.
    async fn delete_review(&self, gql_ctx: &Context<'_>, review_id: i32) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.delete_review(user_id, review_id).await
    }

    /// Create a new collection for the logged in user or edit details of an existing one.
    async fn create_or_update_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateOrUpdateCollectionInput,
    ) -> Result<IdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.create_or_update_collection(user_id, input).await
    }

    /// Add a media item to a collection if it is not there, otherwise do nothing.
    async fn add_media_to_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: AddMediaToCollection,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.add_media_to_collection(user_id, input).await
    }

    /// Remove a media item from a collection if it is not there, otherwise do nothing.
    async fn remove_media_from_collection(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: i32,
        collection_name: String,
    ) -> Result<IdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service
            .remove_media_item_from_collection(user_id, &metadata_id, &collection_name)
            .await
    }

    /// Delete a collection.
    async fn delete_collection(
        &self,
        gql_ctx: &Context<'_>,
        collection_name: String,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.delete_collection(user_id, &collection_name).await
    }

    /// Delete a seen item from a user's history.
    async fn delete_seen_item(&self, gql_ctx: &Context<'_>, seen_id: i32) -> Result<IdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.delete_seen_item(seen_id, user_id).await
    }

    /// Deploy jobs to update all media item's metadata.
    async fn update_all_metadata(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.update_all_metadata().await
    }

    /// Create a custom media item.
    async fn create_custom_media(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateCustomMediaInput,
    ) -> Result<CreateCustomMediaResult> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.create_custom_media(input, user_id).await
    }

    /// Mark a user's progress on a specific media item.
    async fn progress_update(
        &self,
        gql_ctx: &Context<'_>,
        input: ProgressUpdateInput,
    ) -> Result<ProgressUpdateResultUnion> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.progress_update(input, user_id).await
    }

    /// Update progress in bulk.
    async fn bulk_progress_update(
        &self,
        gql_ctx: &Context<'_>,
        input: Vec<ProgressUpdateInput>,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.bulk_progress_update(user_id, input).await
    }

    /// Deploy a job to update a media item's metadata.
    async fn deploy_update_metadata_job(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: i32,
    ) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.deploy_update_metadata_job(metadata_id).await
    }

    /// Merge a media item into another. This will move all `seen` and `review`
    /// items with the new user and then delete the old media item completely.
    async fn merge_metadata(
        &self,
        gql_ctx: &Context<'_>,
        merge_from: i32,
        merge_into: i32,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.merge_metadata(merge_from, merge_into).await
    }

    /// Fetch details about a media and create a media item in the database.
    async fn commit_media(
        &self,
        gql_ctx: &Context<'_>,
        lot: MetadataLot,
        source: MetadataSource,
        identifier: String,
    ) -> Result<IdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.commit_media(lot, source, &identifier).await
    }

    /// Create a new user for the service. Also set their `lot` as admin if
    /// they are the first user.
    async fn register_user(
        &self,
        gql_ctx: &Context<'_>,
        input: UserInput,
    ) -> Result<RegisterResult> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service
            .register_user(&input.username, &input.password)
            .await
    }

    /// Login a user using their username and password and return an auth token.
    async fn login_user(&self, gql_ctx: &Context<'_>, input: UserInput) -> Result<LoginResult> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service
            .login_user(&input.username, &input.password, gql_ctx)
            .await
    }

    /// Logout a user from the server and delete their login token.
    async fn logout_user(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_auth_token_from_ctx(gql_ctx)?;
        service.logout_user(&user_id, gql_ctx).await
    }

    /// Update a user's profile details.
    async fn update_user(&self, gql_ctx: &Context<'_>, input: UpdateUserInput) -> Result<IdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.update_user(user_id, input).await
    }

    /// Delete all summaries for the currently logged in user and then generate one from scratch.
    pub async fn regenerate_user_summary(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.deploy_recalculate_summary_job(user_id).await.ok();
        Ok(true)
    }

    /// Change a user's preferences.
    async fn update_user_preference(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateUserPreferenceInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.update_user_preference(input, user_id).await
    }

    /// Generate an auth token without any expiry.
    async fn generate_application_token(&self, gql_ctx: &Context<'_>) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.generate_application_token(user_id).await
    }

    /// Create a sink based integrations for the currently logged in user.
    async fn create_user_sink_integration(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateUserSinkIntegrationInput,
    ) -> Result<usize> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.create_user_sink_integration(user_id, input).await
    }

    /// Create a yank based integrations for the currently logged in user.
    async fn create_user_yank_integration(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateUserYankIntegrationInput,
    ) -> Result<usize> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.create_user_yank_integration(user_id, input).await
    }

    /// Delete an integration for the currently logged in user.
    async fn delete_user_integration(
        &self,
        gql_ctx: &Context<'_>,
        integration_id: usize,
        integration_lot: UserIntegrationLot,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service
            .delete_user_integration(user_id, integration_id, integration_lot)
            .await
    }

    /// Add a notification platform for the currently logged in user.
    async fn create_user_notification_platform(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateUserNotificationPlatformInput,
    ) -> Result<usize> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service
            .create_user_notification_platform(user_id, input)
            .await
    }

    /// Test all notification platforms for the currently logged in user.
    async fn test_user_notification_platforms(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service
            .send_notifications_to_user_platforms(user_id, "Test notification message triggered.")
            .await
    }

    /// Delete a notification platform for the currently logged in user.
    async fn delete_user_notification_platform(
        &self,
        gql_ctx: &Context<'_>,
        notification_id: usize,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service
            .delete_user_notification_platform(user_id, notification_id)
            .await
    }

    /// Yank data from all integrations for the currently logged in user.
    async fn yank_integration_data(&self, gql_ctx: &Context<'_>) -> Result<usize> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.yank_integrations_data_for_user(user_id).await
    }

    /// Delete an auth token for the currently logged in user.
    async fn delete_user_auth_token(&self, gql_ctx: &Context<'_>, token: String) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.delete_user_auth_token(user_id, token).await
    }

    /// Delete a user. The account making the user must an `Admin`.
    async fn delete_user(&self, gql_ctx: &Context<'_>, to_delete_user_id: i32) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.admin_account_guard(user_id).await?;
        service.delete_user(to_delete_user_id).await
    }

    /// Toggle the monitor on a media for a user.
    async fn toggle_media_monitor(
        &self,
        gql_ctx: &Context<'_>,
        to_monitor_metadata_id: i32,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service
            .toggle_media_monitor(user_id, to_monitor_metadata_id)
            .await
    }

    /// Create or update a reminder on a media for a user.
    async fn create_media_reminder(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateMediaReminderInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.create_media_reminder(user_id, input).await
    }

    /// Delete a reminder on a media for a user if it exists.
    async fn delete_media_reminder(&self, gql_ctx: &Context<'_>, metadata_id: i32) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.delete_media_reminder(user_id, metadata_id).await
    }
}

pub struct MiscellaneousService {
    pub db: DatabaseConnection,
    pub auth_db: MemoryDatabase,
    pub config: Arc<AppConfig>,
    pub files_storage_service: Arc<FileStorageService>,
    pub audible_service: AudibleService,
    pub google_books_service: GoogleBooksService,
    pub igdb_service: IgdbService,
    pub itunes_service: ITunesService,
    pub listennotes_service: ListennotesService,
    pub openlibrary_service: OpenlibraryService,
    pub tmdb_movies_service: TmdbMovieService,
    pub tmdb_shows_service: TmdbShowService,
    pub anilist_anime_service: AnilistAnimeService,
    pub anilist_manga_service: AnilistMangaService,
    pub music_brainz_service: MusicBrainzService,
    pub integration_service: IntegrationService,
    pub update_metadata: SqliteStorage<UpdateMetadataJob>,
    pub recalculate_user_summary: SqliteStorage<RecalculateUserSummaryJob>,
    pub user_created: SqliteStorage<UserCreatedJob>,
    seen_progress_cache: Arc<Cache<ProgressUpdateCache, ()>>,
}

impl AuthProvider for MiscellaneousService {
    fn get_auth_db(&self) -> &MemoryDatabase {
        &self.auth_db
    }
}

impl MiscellaneousService {
    #[allow(clippy::too_many_arguments)]
    pub async fn new(
        db: &DatabaseConnection,
        config: Arc<AppConfig>,
        auth_db: MemoryDatabase,
        files_storage_service: Arc<FileStorageService>,
        update_metadata: &SqliteStorage<UpdateMetadataJob>,
        recalculate_user_summary: &SqliteStorage<RecalculateUserSummaryJob>,
        user_created: &SqliteStorage<UserCreatedJob>,
    ) -> Self {
        let openlibrary_service = OpenlibraryService::new(&config.books.openlibrary).await;
        let google_books_service = GoogleBooksService::new(&config.books.google_books).await;
        let tmdb_movies_service = TmdbMovieService::new(&config.movies.tmdb).await;
        let tmdb_shows_service = TmdbShowService::new(&config.shows.tmdb).await;
        let music_brainz_service = MusicBrainzService::new(&config.music.music_brainz).await;
        let audible_service = AudibleService::new(&config.audio_books.audible).await;
        let igdb_service = IgdbService::new(&config.video_games).await;
        let itunes_service = ITunesService::new(&config.podcasts.itunes).await;
        let listennotes_service = ListennotesService::new(&config.podcasts).await;
        let anilist_anime_service = AnilistAnimeService::new(&config.anime.anilist).await;
        let anilist_manga_service = AnilistMangaService::new(&config.manga.anilist).await;
        let integration_service = IntegrationService::new().await;

        let seen_progress_cache = Arc::new(Cache::new());
        let cache_clone = seen_progress_cache.clone();

        tokio::spawn(async move {
            cache_clone
                .monitor(4, 0.25, ChronoDuration::minutes(3).to_std().unwrap())
                .await
        });

        Self {
            db: db.clone(),
            auth_db,
            config,
            files_storage_service,
            seen_progress_cache,
            audible_service,
            google_books_service,
            igdb_service,
            itunes_service,
            listennotes_service,
            openlibrary_service,
            tmdb_movies_service,
            tmdb_shows_service,
            anilist_anime_service,
            anilist_manga_service,
            music_brainz_service,
            integration_service,
            update_metadata: update_metadata.clone(),
            recalculate_user_summary: recalculate_user_summary.clone(),
            user_created: user_created.clone(),
        }
    }
}

impl MiscellaneousService {
    async fn core_details(&self) -> Result<CoreDetails> {
        let latest_version_storage: OnceLock<String> = OnceLock::new();

        let tag = if let Some(tag) = latest_version_storage.get() {
            tag.clone()
        } else {
            #[derive(Serialize, Deserialize, Debug)]
            struct GithubResponse {
                tag_name: String,
            }
            let github_response =
                surf::get("https://api.github.com/repos/ignisda/ryot/releases/latest")
                    .header(USER_AGENT, USER_AGENT_STR)
                    .await
                    .map_err(|e| anyhow!(e))?
                    .body_json::<GithubResponse>()
                    .await
                    .map_err(|e| anyhow!(e))?;
            let tag = github_response
                .tag_name
                .strip_prefix("v")
                .unwrap()
                .to_owned();
            latest_version_storage.set(tag.clone()).ok();
            tag
        };
        let latest_version = Version::parse(&tag).unwrap();
        let current_version = Version::parse(VERSION).unwrap();
        let upgrade = if latest_version > current_version {
            Some(if latest_version.major > current_version.major {
                UpgradeType::Major
            } else {
                UpgradeType::Minor
            })
        } else {
            None
        };
        Ok(CoreDetails {
            docs_link: "https://ignisda.github.io/ryot".to_owned(),
            repository_link: "https://github.com/ignisda/ryot".to_owned(),
            version: VERSION.to_owned(),
            author_name: AUTHOR.to_owned(),
            username_change_allowed: self.config.users.allow_changing_username,
            password_change_allowed: self.config.users.allow_changing_password,
            preferences_change_allowed: self.config.users.allow_changing_preferences,
            default_credentials: self.config.server.default_credentials,
            item_details_height: self.config.frontend.item_details_height,
            reviews_disabled: self.config.users.reviews_disabled,
            upgrade,
            page_limit: PAGE_LIMIT,
        })
    }

    async fn get_stored_image(&self, m: MetadataImageUrl) -> String {
        match m {
            MetadataImageUrl::Url(u) => u,
            MetadataImageUrl::S3(u) => self.files_storage_service.get_presigned_url(u).await,
        }
    }

    async fn metadata_images(&self, meta: &metadata::Model) -> Result<(Vec<String>, Vec<String>)> {
        let mut poster_images = vec![];
        let mut backdrop_images = vec![];
        for i in meta.images.0.clone() {
            match i.lot {
                MetadataImageLot::Backdrop => {
                    backdrop_images.push(self.get_stored_image(i.url).await);
                }
                MetadataImageLot::Poster => {
                    poster_images.push(self.get_stored_image(i.url).await);
                }
            };
        }
        Ok((poster_images, backdrop_images))
    }

    async fn generic_metadata(&self, metadata_id: i32) -> Result<MediaBaseData> {
        let mut meta = match Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
        {
            Some(m) => m,
            None => return Err(Error::new("The record does not exist".to_owned())),
        };
        let genres = meta
            .find_related(Genre)
            .all(&self.db)
            .await
            .unwrap()
            .into_iter()
            .map(|g| g.name)
            .collect();
        let mut creators: HashMap<String, Vec<creator::Model>> = HashMap::new();
        for cl in MetadataToCreator::find()
            .filter(metadata_to_creator::Column::MetadataId.eq(meta.id))
            .order_by_asc(metadata_to_creator::Column::Index)
            .all(&self.db)
            .await?
        {
            let creator = cl.find_related(Creator).one(&self.db).await?.unwrap();
            creators
                .entry(cl.role)
                .and_modify(|e| {
                    e.push(creator.clone());
                })
                .or_insert(vec![creator]);
        }
        let (poster_images, backdrop_images) = self.metadata_images(&meta).await.unwrap();
        if let Some(ref mut d) = meta.description {
            *d = markdown_to_html_opts(
                d,
                &Options {
                    compile: CompileOptions {
                        allow_dangerous_html: true,
                        allow_dangerous_protocol: true,
                        ..CompileOptions::default()
                    },
                    ..Options::default()
                },
            )
            .unwrap();
        }
        let creators = creators
            .into_iter()
            .map(|(name, items)| MetadataCreatorGroupedByRole { name, items })
            .collect_vec();
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
            MetadataSource::MusicBrainz => todo!(),
            MetadataSource::Itunes => Some(format!(
                "https://podcasts.apple.com/us/podcast/{slug}/id{identifier}"
            )),
            MetadataSource::GoogleBooks => Some(format!(
                "https://www.google.co.in/books/edition/{slug}/{identifier}"
            )),
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
            production_status: model.production_status,
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
            music_specifics: None,
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
            MediaSpecifics::Music(a) => {
                resp.music_specifics = Some(a);
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

    async fn user_media_details(&self, user_id: i32, metadata_id: i32) -> Result<UserMediaDetails> {
        let media_details = self.media_details(metadata_id).await?;
        let collections = self.media_in_collections(user_id, metadata_id).await?;
        let reviews = self.item_reviews(user_id, Some(metadata_id), None).await?;
        let history = self.seen_history(user_id, metadata_id).await?;
        let in_progress = history
            .iter()
            .find(|h| h.state == SeenState::InProgress || h.state == SeenState::OnAHold)
            .cloned();
        let next_episode = history.first().and_then(|h| {
            if let Some(s) = &media_details.show_specifics {
                let all_episodes = s
                    .seasons
                    .iter()
                    .flat_map(|s| s.episodes.iter().map(|e| (e, s.season_number)))
                    .collect_vec();
                let current = all_episodes.iter().position(|s| {
                    s.0.episode_number == h.show_information.as_ref().unwrap().episode
                        && s.1 == h.show_information.as_ref().unwrap().season
                });
                current.and_then(|i| {
                    all_episodes.get(i + 1).map(|ep| UserMediaNextEpisode {
                        season_number: Some(ep.1),
                        episode_number: Some(ep.0.episode_number),
                    })
                })
            } else if let Some(p) = &media_details.podcast_specifics {
                let current = p
                    .episodes
                    .iter()
                    .position(|p| p.number == h.podcast_information.as_ref().unwrap().episode);
                current.map(|i| UserMediaNextEpisode {
                    season_number: None,
                    episode_number: p.episodes.get(i + 1).map(|e| e.number),
                })
            } else {
                None
            }
        });
        let next_episode = next_episode.filter(|ne| ne.episode_number.is_some());
        let is_monitored = self.get_monitored_status(user_id, metadata_id).await?;
        let metadata_alias = Alias::new("m");
        let seen_alias = Alias::new("s");
        let seen_select = Query::select()
            .expr_as(
                Expr::col((metadata_alias.clone(), TempMetadata::Id)),
                Alias::new("metadata_id"),
            )
            .expr_as(
                Func::count(Expr::col((seen_alias.clone(), TempSeen::MetadataId))),
                Alias::new("num_times_seen"),
            )
            .from_as(TempMetadata::Table, metadata_alias.clone())
            .join_as(
                JoinType::LeftJoin,
                TempSeen::Table,
                seen_alias.clone(),
                Expr::col((metadata_alias.clone(), TempMetadata::Id))
                    .equals((seen_alias.clone(), TempSeen::MetadataId)),
            )
            .and_where(Expr::col((metadata_alias.clone(), TempMetadata::Id)).eq(metadata_id))
            .group_by_col((metadata_alias.clone(), TempMetadata::Id))
            .to_owned();
        let stmt = self.get_db_stmt(seen_select);
        let seen_by = self
            .db
            .query_one(stmt)
            .await?
            .map(|qr| qr.try_get_by_index::<i64>(1).unwrap())
            .unwrap();
        let seen_by: i32 = seen_by.try_into().unwrap();
        let reminder = UserToMetadata::find()
            .filter(user_to_metadata::Column::UserId.eq(user_id))
            .filter(user_to_metadata::Column::MetadataId.eq(metadata_id))
            .one(&self.db)
            .await?
            .and_then(|n| n.reminder);

        Ok(UserMediaDetails {
            collections,
            reviews,
            history,
            in_progress,
            next_episode,
            is_monitored,
            seen_by,
            reminder,
        })
    }

    async fn user_creator_details(
        &self,
        user_id: i32,
        creator_id: i32,
    ) -> Result<UserCreatorDetails> {
        let reviews = self.item_reviews(user_id, None, Some(creator_id)).await?;
        Ok(UserCreatorDetails { reviews })
    }

    async fn seen_history(&self, user_id: i32, metadata_id: i32) -> Result<Vec<seen::Model>> {
        let mut seen = Seen::find()
            .filter(seen::Column::UserId.eq(user_id))
            .filter(seen::Column::MetadataId.eq(metadata_id))
            .order_by_desc(seen::Column::LastUpdatedOn)
            .all(&self.db)
            .await
            .unwrap();
        modify_seen_elements(&mut seen);
        Ok(seen)
    }

    async fn media_list(
        &self,
        user_id: i32,
        input: MediaListInput,
    ) -> Result<SearchResults<MediaListItem>> {
        let meta = UserToMetadata::find()
            .filter(user_to_metadata::Column::UserId.eq(user_id))
            .apply_if(
                match input.filter.as_ref().and_then(|f| f.general) {
                    Some(MediaGeneralFilter::ExplicitlyMonitored) => Some(true),
                    _ => None,
                },
                |query, v| query.filter(user_to_metadata::Column::Monitored.eq(v)),
            )
            .all(&self.db)
            .await
            .unwrap();
        let distinct_meta_ids = meta.into_iter().map(|m| m.metadata_id).collect_vec();

        let metadata_alias = Alias::new("m");
        let seen_alias = Alias::new("s");
        let review_alias = Alias::new("r");
        let mtu_alias = Alias::new("mtu");

        let mut main_select = Query::select()
            .expr(Expr::col((metadata_alias.clone(), Asterisk)))
            .from_as(TempMetadata::Table, metadata_alias.clone())
            .and_where(Expr::col((metadata_alias.clone(), TempMetadata::Lot)).eq(input.lot))
            .and_where(
                Expr::col((metadata_alias.clone(), TempMetadata::Id))
                    .is_in(distinct_meta_ids.clone()),
            )
            .to_owned();

        if let Some(v) = input.query {
            let get_contains_expr = |col: metadata::Column| {
                get_case_insensitive_like_query(
                    Func::cast_as(Expr::col((metadata_alias.clone(), col)), Alias::new("text")),
                    &v,
                )
            };
            main_select = main_select
                .cond_where(
                    Cond::any()
                        .add(get_contains_expr(metadata::Column::Title))
                        .add(get_contains_expr(metadata::Column::Description)),
                )
                .to_owned();
        };

        let order_by = input
            .sort
            .as_ref()
            .map(|a| Order::from(a.order))
            .unwrap_or(Order::Asc);

        match input.sort {
            None => {
                main_select = main_select
                    .order_by((metadata_alias.clone(), metadata::Column::Title), order_by)
                    .to_owned();
            }
            Some(s) => {
                match s.by {
                    MediaSortBy::Title => {
                        main_select = main_select
                            .order_by((metadata_alias.clone(), metadata::Column::Title), order_by)
                            .to_owned();
                    }
                    MediaSortBy::ReleaseDate => {
                        main_select = main_select
                            .order_by_with_nulls(
                                (metadata_alias.clone(), metadata::Column::PublishYear),
                                order_by,
                                NullOrdering::Last,
                            )
                            .to_owned();
                    }
                    MediaSortBy::LastSeen => {
                        let last_seen = Alias::new("last_seen");
                        let sub_select = Query::select()
                            .column(TempSeen::MetadataId)
                            .expr_as(
                                Func::max(Expr::col(TempSeen::FinishedOn)),
                                last_seen.clone(),
                            )
                            .from(TempSeen::Table)
                            .and_where(Expr::col(TempSeen::UserId).eq(user_id))
                            .group_by_col(TempSeen::MetadataId)
                            .to_owned();
                        main_select = main_select
                            .join_subquery(
                                JoinType::LeftJoin,
                                sub_select,
                                seen_alias.clone(),
                                Expr::col((metadata_alias.clone(), TempMetadata::Id))
                                    .equals((seen_alias.clone(), TempSeen::MetadataId)),
                            )
                            .order_by_with_nulls(
                                (seen_alias.clone(), last_seen),
                                order_by,
                                NullOrdering::Last,
                            )
                            .to_owned();
                    }
                    MediaSortBy::LastUpdated => {
                        main_select = main_select
                            .join_as(
                                JoinType::LeftJoin,
                                TempUserToMetadata::Table,
                                mtu_alias.clone(),
                                Expr::col((metadata_alias.clone(), TempMetadata::Id))
                                    .equals((mtu_alias.clone(), TempUserToMetadata::MetadataId))
                                    .and(
                                        Expr::col((mtu_alias.clone(), TempUserToMetadata::UserId))
                                            .eq(user_id),
                                    ),
                            )
                            .order_by(
                                (mtu_alias.clone(), TempUserToMetadata::LastUpdatedOn),
                                order_by,
                            )
                            .to_owned();
                    }
                    MediaSortBy::Rating => {
                        let alias_name = "average_rating";
                        main_select = main_select
                            .expr_as(
                                Func::avg(Expr::col((review_alias.clone(), TempReview::Rating))),
                                Alias::new(alias_name),
                            )
                            .join_as(
                                JoinType::LeftJoin,
                                TempReview::Table,
                                review_alias.clone(),
                                Expr::col((metadata_alias.clone(), TempMetadata::Id))
                                    .equals((review_alias.clone(), TempReview::MetadataId))
                                    .and(
                                        Expr::col((review_alias.clone(), TempReview::UserId))
                                            .eq(user_id),
                                    ),
                            )
                            .group_by_col((metadata_alias.clone(), TempMetadata::Id))
                            .order_by_expr_with_nulls(
                                Expr::cust(alias_name),
                                order_by,
                                NullOrdering::Last,
                            )
                            .to_owned();
                    }
                };
            }
        };

        if let Some(f) = input.filter {
            if let Some(s) = f.collection {
                let all_media = MetadataToCollection::find()
                    .filter(metadata_to_collection::Column::CollectionId.eq(s))
                    .all(&self.db)
                    .await?;
                let collections = all_media.into_iter().map(|m| m.metadata_id).collect_vec();
                main_select = main_select
                    .and_where(
                        Expr::col((metadata_alias.clone(), TempMetadata::Id)).is_in(collections),
                    )
                    .to_owned();
            }
            if let Some(s) = f.general {
                let reviews = if matches!(s, MediaGeneralFilter::All) {
                    vec![]
                } else {
                    Review::find()
                        .filter(review::Column::UserId.eq(user_id))
                        .all(&self.db)
                        .await?
                        .into_iter()
                        .map(|r| r.metadata_id)
                        .collect_vec()
                };
                match s {
                    MediaGeneralFilter::ExplicitlyMonitored => {}
                    MediaGeneralFilter::All => {}
                    MediaGeneralFilter::Rated => {
                        main_select = main_select
                            .and_where(
                                Expr::col((metadata_alias.clone(), TempMetadata::Id))
                                    .is_in(reviews),
                            )
                            .to_owned();
                    }
                    MediaGeneralFilter::Unrated => {
                        main_select = main_select
                            .and_where(
                                Expr::col((metadata_alias.clone(), TempMetadata::Id))
                                    .is_not_in(reviews),
                            )
                            .to_owned();
                    }
                    MediaGeneralFilter::Dropped
                    | MediaGeneralFilter::InProgress
                    | MediaGeneralFilter::Completed
                    | MediaGeneralFilter::OnAHold => {
                        let state = match s {
                            MediaGeneralFilter::Dropped => SeenState::Dropped,
                            MediaGeneralFilter::InProgress => SeenState::InProgress,
                            MediaGeneralFilter::Completed => SeenState::Completed,
                            MediaGeneralFilter::OnAHold => SeenState::OnAHold,
                            _ => unreachable!(),
                        };
                        let filtered_ids = Seen::find()
                            .filter(seen::Column::UserId.eq(user_id))
                            .filter(seen::Column::State.eq(state))
                            .all(&self.db)
                            .await?
                            .into_iter()
                            .map(|r| r.metadata_id)
                            .collect_vec();
                        main_select = main_select
                            .and_where(
                                Expr::col((metadata_alias.clone(), TempMetadata::Id))
                                    .is_in(filtered_ids),
                            )
                            .to_owned();
                    }
                    MediaGeneralFilter::Unseen => {
                        main_select = main_select
                            .join_as(
                                JoinType::LeftJoin,
                                TempReview::Table,
                                review_alias.clone(),
                                Expr::col((metadata_alias.clone(), TempMetadata::Id))
                                    .equals((seen_alias.clone(), TempSeen::MetadataId)),
                            )
                            .and_where(
                                Expr::col((seen_alias.clone(), TempSeen::MetadataId)).is_null(),
                            )
                            .to_owned();
                    }
                };
            }
        };

        #[derive(Debug, FromQueryResult)]
        struct InnerMediaSearchItem {
            id: i32,
            title: String,
            publish_year: Option<i32>,
            images: serde_json::Value,
        }

        let count_select = Query::select()
            .expr(Func::count(Expr::col(Asterisk)))
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
        let metas = InnerMediaSearchItem::find_by_statement(stmt)
            .all(&self.db)
            .await?;
        let mut items = vec![];
        // FIXME: Use correct function once https://github.com/SeaQL/sea-query/pull/671 is resolved
        struct RoundFunction;
        impl Iden for RoundFunction {
            fn unquoted(&self, s: &mut dyn sea_query::Write) {
                write!(s, "ROUND").unwrap();
            }
        }
        for m in metas {
            let avg_select = Query::select()
                .expr(Func::cust(RoundFunction).arg(Func::avg(Expr::col((
                    TempReview::Table,
                    TempReview::Rating,
                )))))
                .from(TempReview::Table)
                .cond_where(
                    Cond::all()
                        .add(Expr::col((TempReview::Table, TempReview::UserId)).eq(user_id))
                        .add(Expr::col((TempReview::Table, TempReview::MetadataId)).eq(m.id)),
                )
                .to_owned();
            let stmt = self.get_db_stmt(avg_select);
            let avg = self
                .db
                .query_one(stmt)
                .await?
                .map(|qr| qr.try_get_by_index::<Decimal>(0).ok())
                .unwrap();
            let images = serde_json::from_value(m.images).unwrap();
            let (poster_images, _) = self
                .metadata_images(&metadata::Model {
                    images,
                    ..Default::default()
                })
                .await?;
            let m_small = MediaListItem {
                data: MediaSearchItem {
                    identifier: m.id.to_string(),
                    title: m.title,
                    image: poster_images.get(0).cloned(),
                    publish_year: m.publish_year,
                },
                average_rating: avg,
            };
            items.push(m_small);
        }
        let next_page = if total - ((input.page) * PAGE_LIMIT) > 0 {
            Some(input.page + 1)
        } else {
            None
        };
        Ok(SearchResults {
            details: SearchDetails { next_page, total },
            items,
        })
    }

    // DEV: First we update progress only if media has not been consumed for
    // this user in the last `n` duration.
    pub async fn progress_update(
        &self,
        input: ProgressUpdateInput,
        user_id: i32,
    ) -> Result<ProgressUpdateResultUnion> {
        let cache = ProgressUpdateCache {
            user_id,
            metadata_id: input.metadata_id,
            show_season_number: input.show_season_number,
            show_episode_number: input.show_episode_number,
            podcast_episode_number: input.podcast_episode_number,
        };

        if self.seen_progress_cache.get(&cache).await.is_some() {
            return Ok(ProgressUpdateResultUnion::Error(ProgressUpdateError {
                error: ProgressUpdateErrorVariant::AlreadySeen,
            }));
        }

        let prev_seen = Seen::find()
            .filter(seen::Column::Progress.lt(100))
            .filter(seen::Column::UserId.eq(user_id))
            .filter(seen::Column::State.ne(SeenState::Dropped))
            .filter(seen::Column::MetadataId.eq(input.metadata_id))
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
            ChangeState,
        }
        let action = match input.change_state {
            None => match input.progress {
                None => ProgressUpdateAction::ChangeState,
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
            },
            Some(_) => ProgressUpdateAction::ChangeState,
        };
        let err = || {
            Ok(ProgressUpdateResultUnion::Error(ProgressUpdateError {
                error: ProgressUpdateErrorVariant::NoSeenInProgress,
            }))
        };
        let seen_item = match action {
            ProgressUpdateAction::Update => {
                let progress = input.progress.unwrap();
                let mut last_seen: seen::ActiveModel = prev_seen[0].clone().into();
                last_seen.state = ActiveValue::Set(SeenState::InProgress);
                last_seen.progress = ActiveValue::Set(progress);
                last_seen.last_updated_on = ActiveValue::Set(Utc::now());
                if progress == 100 {
                    last_seen.finished_on = ActiveValue::Set(Some(Utc::now().date_naive()));
                }
                last_seen.update(&self.db).await.unwrap()
            }
            ProgressUpdateAction::ChangeState => {
                let new_state = input.change_state.unwrap_or(SeenState::Dropped);
                let last_seen = Seen::find()
                    .filter(seen::Column::UserId.eq(user_id))
                    .filter(seen::Column::MetadataId.eq(input.metadata_id))
                    .order_by_desc(seen::Column::LastUpdatedOn)
                    .one(&self.db)
                    .await
                    .unwrap();
                match last_seen {
                    Some(ls) => {
                        let mut last_seen: seen::ActiveModel = ls.into();
                        last_seen.state = ActiveValue::Set(new_state);
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
                let extra_infomation = match meta.lot {
                    MetadataLot::Show => {
                        if let (Some(season), Some(episode), MediaSpecifics::Show(spec)) = (
                            input.show_season_number,
                            input.show_episode_number,
                            meta.specifics,
                        ) {
                            let mut is_there = false;
                            for s in spec.seasons.iter() {
                                for e in s.episodes.iter() {
                                    if s.season_number == season && e.episode_number == episode {
                                        is_there = true;
                                        break;
                                    }
                                }
                            }
                            if !is_there {
                                return Ok(ProgressUpdateResultUnion::Error(ProgressUpdateError {
                                    error: ProgressUpdateErrorVariant::InvalidUpdate,
                                }));
                            }
                            Some(SeenOrReviewExtraInformation::Show(
                                SeenShowExtraInformation { season, episode },
                            ))
                        } else {
                            return Ok(ProgressUpdateResultUnion::Error(ProgressUpdateError {
                                error: ProgressUpdateErrorVariant::InvalidUpdate,
                            }));
                        }
                    }
                    MetadataLot::Podcast => {
                        if let (Some(episode), MediaSpecifics::Podcast(spec)) =
                            (input.podcast_episode_number, meta.specifics)
                        {
                            let mut is_there = false;
                            for e in spec.episodes.iter() {
                                if e.number == episode {
                                    is_there = true;
                                    break;
                                }
                            }
                            if !is_there {
                                return Ok(ProgressUpdateResultUnion::Error(ProgressUpdateError {
                                    error: ProgressUpdateErrorVariant::InvalidUpdate,
                                }));
                            }
                            Some(SeenOrReviewExtraInformation::Podcast(
                                SeenPodcastExtraInformation { episode },
                            ))
                        } else {
                            return Ok(ProgressUpdateResultUnion::Error(ProgressUpdateError {
                                error: ProgressUpdateErrorVariant::InvalidUpdate,
                            }));
                        }
                    }
                    _ => None,
                };
                let finished_on = if action == ProgressUpdateAction::JustStarted {
                    None
                } else {
                    input.date
                };
                let (progress, started_on) = if matches!(action, ProgressUpdateAction::JustStarted)
                {
                    (0, Some(Utc::now().date_naive()))
                } else {
                    (100, None)
                };
                let seen_insert = seen::ActiveModel {
                    progress: ActiveValue::Set(progress),
                    user_id: ActiveValue::Set(user_id),
                    metadata_id: ActiveValue::Set(input.metadata_id),
                    started_on: ActiveValue::Set(started_on),
                    finished_on: ActiveValue::Set(finished_on),
                    last_updated_on: ActiveValue::Set(Utc::now()),
                    extra_information: ActiveValue::Set(extra_infomation),
                    state: ActiveValue::Set(SeenState::InProgress),
                    ..Default::default()
                };
                seen_insert.insert(&self.db).await.unwrap()
            }
        };
        let id = seen_item.id;
        if seen_item.state == SeenState::Completed {
            self.seen_progress_cache
                .insert(
                    cache,
                    (),
                    ChronoDuration::hours(self.config.server.progress_update_threshold)
                        .to_std()
                        .unwrap(),
                )
                .await;
        }
        self.after_media_seen_tasks(seen_item).await?;
        Ok(ProgressUpdateResultUnion::Ok(IdObject { id }))
    }

    pub async fn bulk_progress_update(
        &self,
        user_id: i32,
        input: Vec<ProgressUpdateInput>,
    ) -> Result<bool> {
        if input.len() < 2 {
            return Err(Error::new("Atleast two bulk update elements are required"));
        }
        // DEV: We have to do this sorcery because the `associate_user_with_metadata` operation
        // fails if we do all of them together. So we perform one update and then the rest together.
        let mut updates = input
            .into_iter()
            .map(|i| self.progress_update(i, user_id))
            .collect_vec();
        updates.drain(..1).collect_vec().pop().unwrap().await?;
        join_all(updates).await;
        Ok(true)
    }

    pub async fn deploy_recalculate_summary_job(&self, user_id: i32) -> Result<()> {
        let mut storage = self.recalculate_user_summary.clone();
        storage.push(RecalculateUserSummaryJob { user_id }).await?;
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
            // if the metadata is monitored
            let is_monitored = u.monitored;
            // if user has set a reminder
            let is_reminder_active = u.reminder.is_some();
            if seen_count + reviewed_count == 0
                && !is_in_collection
                && !is_monitored
                && !is_reminder_active
            {
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
        specifics: MediaSpecifics,
        creators: Vec<MetadataCreator>,
        genres: Vec<String>,
        production_status: String,
        publish_year: Option<i32>,
    ) -> Result<Vec<(String, MediaStateChanged)>> {
        let mut notifications = vec![];

        let meta = Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();

        if meta.production_status != production_status {
            notifications.push((
                format!(
                    "Status changed from {:#?} to {:#?}",
                    meta.production_status, production_status
                ),
                MediaStateChanged::StatusChanged,
            ));
        }

        if let (Some(p1), Some(p2)) = (meta.publish_year, publish_year) {
            if p1 != p2 {
                notifications.push((
                    format!("Publish year from {:#?} to {:#?}", p1, p2),
                    MediaStateChanged::ReleaseDateChanged,
                ));
            }
        }

        match (&meta.specifics, &specifics) {
            (MediaSpecifics::Show(s1), MediaSpecifics::Show(s2)) => {
                if s1.seasons.len() != s2.seasons.len() {
                    notifications.push((
                        format!(
                            "Number of seasons changed from {:#?} to {:#?}",
                            s1.seasons.len(),
                            s2.seasons.len()
                        ),
                        MediaStateChanged::NumberOfSeasonsChanged,
                    ));
                } else {
                    for (s1, s2) in zip(s1.seasons.iter(), s2.seasons.iter()) {
                        if s1.episodes.len() != s2.episodes.len() {
                            notifications.push((
                                format!(
                                    "Number of episodes changed from {:#?} to {:#?} (Season {})",
                                    s1.episodes.len(),
                                    s2.episodes.len(),
                                    s1.season_number
                                ),
                                MediaStateChanged::EpisodeReleased,
                            ));
                        }
                    }
                }
            }
            (MediaSpecifics::Podcast(p1), MediaSpecifics::Podcast(p2)) => {
                if p1.episodes.len() != p2.episodes.len() {
                    notifications.push((
                        format!(
                            "Number of episodes changed from {:#?} to {:#?}",
                            p1.episodes.len(),
                            p2.episodes.len()
                        ),
                        MediaStateChanged::EpisodeReleased,
                    ));
                }
            }
            _ => {}
        }

        let notifications = notifications
            .into_iter()
            .map(|n| (format!("{} for {:?}.", n.0, meta.title), n.1))
            .collect_vec();

        let mut meta: metadata::ActiveModel = meta.into();
        meta.title = ActiveValue::Set(title);
        meta.description = ActiveValue::Set(description);
        meta.images = ActiveValue::Set(MetadataImages(images));
        meta.last_updated_on = ActiveValue::Set(Utc::now());
        meta.production_status = ActiveValue::Set(production_status);
        meta.publish_year = ActiveValue::Set(publish_year);
        meta.specifics = ActiveValue::Set(specifics);
        let metadata = meta.update(&self.db).await.unwrap();

        MetadataToCreator::delete_many()
            .filter(metadata_to_creator::Column::MetadataId.eq(metadata.id))
            .exec(&self.db)
            .await?;
        self.associate_creator_with_metadata(metadata.id, creators)
            .await
            .ok();
        MetadataToGenre::delete_many()
            .filter(metadata_to_genre::Column::MetadataId.eq(metadata.id))
            .exec(&self.db)
            .await?;
        for genre in genres {
            self.associate_genre_with_metadata(genre, metadata_id)
                .await
                .ok();
        }

        Ok(notifications)
    }

    async fn associate_creator_with_metadata(
        &self,
        metadata_id: i32,
        data: Vec<MetadataCreator>,
    ) -> Result<()> {
        for (idx, creator) in data.into_iter().enumerate() {
            let db_creator = if let Some(db_creator) = Creator::find()
                .filter(creator::Column::Name.eq(&creator.name))
                .one(&self.db)
                .await
                .unwrap()
            {
                if db_creator.image.is_none() {
                    let mut new: creator::ActiveModel = db_creator.clone().into();
                    new.image = ActiveValue::Set(creator.image);
                    new.update(&self.db).await?;
                }
                db_creator
            } else {
                let c = creator::ActiveModel {
                    name: ActiveValue::Set(creator.name),
                    image: ActiveValue::Set(creator.image),
                    extra_information: ActiveValue::Set(CreatorExtraInformation { active: true }),
                    ..Default::default()
                };
                c.insert(&self.db).await.unwrap()
            };
            let intermediate = metadata_to_creator::ActiveModel {
                metadata_id: ActiveValue::Set(metadata_id),
                creator_id: ActiveValue::Set(db_creator.id),
                role: ActiveValue::Set(creator.role),
                index: ActiveValue::Set(idx.try_into().unwrap()),
            };
            intermediate.insert(&self.db).await.ok();
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
            source: ActiveValue::Set(details.source),
            title: ActiveValue::Set(details.title),
            description: ActiveValue::Set(details.description),
            publish_year: ActiveValue::Set(details.publish_year),
            publish_date: ActiveValue::Set(details.publish_date),
            images: ActiveValue::Set(MetadataImages(details.images)),
            identifier: ActiveValue::Set(details.identifier),
            specifics: ActiveValue::Set(details.specifics),
            production_status: ActiveValue::Set(details.production_status),
            ..Default::default()
        };
        let metadata = metadata.insert(&self.db).await.unwrap();
        MetadataToCreator::delete_many()
            .filter(metadata_to_creator::Column::MetadataId.eq(metadata.id))
            .exec(&self.db)
            .await?;
        self.associate_creator_with_metadata(metadata.id, details.creators)
            .await
            .ok();
        MetadataToGenre::delete_many()
            .filter(metadata_to_genre::Column::MetadataId.eq(metadata.id))
            .exec(&self.db)
            .await?;
        for genre in details.genres {
            self.associate_genre_with_metadata(genre, metadata.id)
                .await
                .ok();
        }
        Ok(IdObject { id: metadata.id })
    }

    pub async fn cleanup_data_without_associated_user_activities(&self) -> Result<()> {
        tracing::trace!("Cleaning up media items without associated user activities");
        let mut all_metadata = Metadata::find().stream(&self.db).await?;
        while let Some(metadata) = all_metadata.try_next().await? {
            let num_associations = UserToMetadata::find()
                .filter(user_to_metadata::Column::MetadataId.eq(metadata.id))
                .count(&self.db)
                .await
                .unwrap();
            if num_associations == 0 {
                metadata.delete(&self.db).await.ok();
            }
        }
        tracing::trace!("Cleaning up genres without associated metadata");
        let mut all_genre = Genre::find().stream(&self.db).await?;
        while let Some(genre) = all_genre.try_next().await? {
            let num_associations = MetadataToGenre::find()
                .filter(metadata_to_genre::Column::GenreId.eq(genre.id))
                .count(&self.db)
                .await
                .unwrap();
            if num_associations == 0 {
                genre.delete(&self.db).await.ok();
            }
        }
        tracing::trace!("Cleaning up creators without associated metadata");
        let mut all_creators = Creator::find().stream(&self.db).await?;
        while let Some(creator) = all_creators.try_next().await? {
            let num_associations = MetadataToCreator::find()
                .filter(metadata_to_creator::Column::CreatorId.eq(creator.id))
                .count(&self.db)
                .await
                .unwrap();
            let num_reviews = Review::find()
                .filter(review::Column::CreatorId.eq(creator.id))
                .count(&self.db)
                .await
                .unwrap();
            if num_associations + num_reviews == 0 {
                creator.delete(&self.db).await.ok();
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
                metadata_id: ActiveValue::Set(Some(merge_into)),
                ..old_review_active
            };
            new_review.insert(&self.db).await?;
            old_review.delete(&self.db).await?;
        }
        Metadata::delete_by_id(merge_from).exec(&self.db).await?;
        Ok(true)
    }

    async fn user_preferences(&self, user_id: i32) -> Result<UserPreferences> {
        let mut prefs = self.user_by_id(user_id).await?.preferences;
        prefs.features_enabled.media.music =
            self.config.music.is_enabled() && prefs.features_enabled.media.music;
        prefs.features_enabled.media.anime =
            self.config.anime.is_enabled() && prefs.features_enabled.media.anime;
        prefs.features_enabled.media.audio_book =
            self.config.audio_books.is_enabled() && prefs.features_enabled.media.audio_book;
        prefs.features_enabled.media.book =
            self.config.books.is_enabled() && prefs.features_enabled.media.book;
        prefs.features_enabled.media.show =
            self.config.shows.is_enabled() && prefs.features_enabled.media.show;
        prefs.features_enabled.media.manga =
            self.config.manga.is_enabled() && prefs.features_enabled.media.manga;
        prefs.features_enabled.media.movie =
            self.config.movies.is_enabled() && prefs.features_enabled.media.movie;
        prefs.features_enabled.media.podcast =
            self.config.podcasts.is_enabled() && prefs.features_enabled.media.podcast;
        prefs.features_enabled.media.video_game =
            self.config.video_games.is_enabled() && prefs.features_enabled.media.video_game;
        Ok(prefs)
    }

    async fn core_enabled_features(&self) -> Result<GeneralFeatures> {
        let mut files_enabled = self.config.file_storage.is_enabled();
        if files_enabled && !self.files_storage_service.is_enabled().await {
            files_enabled = false;
        }
        let general = GeneralFeatures {
            file_storage: files_enabled,
            signup_allowed: self.config.users.allow_registration,
        };
        Ok(general)
    }

    async fn media_search(
        &self,
        lot: MetadataLot,
        source: MetadataSource,
        input: SearchInput,
    ) -> Result<SearchResults<MediaSearchItemResponse>> {
        if let Some(q) = input.query {
            if q.is_empty() {
                return Ok(SearchResults {
                    details: SearchDetails {
                        total: 0,
                        next_page: None,
                    },
                    items: vec![],
                });
            }
            let provider = self.get_provider(lot, source)?;
            let results = provider.search(&q, input.page).await?;
            let mut all_idens = results
                .items
                .iter()
                .map(|i| i.identifier.to_owned())
                .collect_vec();
            let data = if all_idens.is_empty() {
                vec![]
            } else {
                #[derive(Iden)]
                #[iden = "identifiers"]
                enum TempIdentifiers {
                    #[iden = "identifiers"]
                    Alias,
                    Identifier,
                }
                let metadata_alias = Alias::new("m");
                // This can be done with `select id from metadata where identifier = '...'
                // and lot = '...'` in a loop. But, I wanted to write a performant query.
                let first_iden = all_idens.drain(..1).collect_vec().pop().unwrap();
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
                            Expr::col((metadata_alias.clone(), TempMetadata::Id)).is_not_null(),
                            Expr::col((metadata_alias.clone(), TempMetadata::Id)),
                        )
                        .finally(Keyword::Null),
                        TempMetadata::Id,
                    )
                    .from_subquery(subquery, TempIdentifiers::Alias)
                    .join_as(
                        JoinType::LeftJoin,
                        TempMetadata::Table,
                        metadata_alias.clone(),
                        Expr::col((TempIdentifiers::Alias, TempIdentifiers::Identifier))
                            .equals((metadata_alias.clone(), TempMetadata::Identifier)),
                    )
                    .and_where(
                        Expr::col((metadata_alias.clone(), TempMetadata::Lot))
                            .eq(lot)
                            .and(
                                Expr::col((metadata_alias.clone(), TempMetadata::Source))
                                    .eq(source),
                            )
                            .or(Expr::col((metadata_alias.clone(), TempMetadata::Lot)).is_null()),
                    )
                    .to_owned();
                let stmt = self.get_db_stmt(identifiers_query);
                #[derive(Debug, FromQueryResult)]
                struct DbResponse {
                    identifier: String,
                    id: Option<i32>,
                }
                let identifiers = DbResponse::find_by_statement(stmt).all(&self.db).await?;
                results
                    .items
                    .into_iter()
                    .map(|i| MediaSearchItemResponse {
                        database_id: identifiers
                            .iter()
                            .find(|&f| f.identifier == i.identifier)
                            .and_then(|i| i.id),
                        item: i,
                    })
                    .collect()
            };
            let results = SearchResults {
                details: results.details,
                items: data,
            };
            Ok(results)
        } else {
            Err(Error::new("Can not search without a query"))
        }
    }

    async fn details_from_provider_for_existing_media(
        &self,
        metadata_id: i32,
    ) -> Result<MediaDetails> {
        let metadata = Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let results = self
            .details_from_provider(metadata.lot, metadata.source, &metadata.identifier)
            .await?;
        Ok(results)
    }

    fn get_provider(&self, lot: MetadataLot, source: MetadataSource) -> Result<Provider> {
        let err = || Err(Error::new("This source is not supported".to_owned()));
        let service: Provider = match source {
            MetadataSource::MusicBrainz => Box::new(self.music_brainz_service.clone()),
            MetadataSource::Openlibrary => Box::new(self.openlibrary_service.clone()),
            MetadataSource::Itunes => Box::new(self.itunes_service.clone()),
            MetadataSource::GoogleBooks => Box::new(self.google_books_service.clone()),
            MetadataSource::Audible => Box::new(self.audible_service.clone()),
            MetadataSource::Listennotes => Box::new(self.listennotes_service.clone()),
            MetadataSource::Tmdb => match lot {
                MetadataLot::Show => Box::new(self.tmdb_shows_service.clone()),
                MetadataLot::Movie => Box::new(self.tmdb_movies_service.clone()),
                _ => return err(),
            },
            MetadataSource::Anilist => match lot {
                MetadataLot::Anime => Box::new(self.anilist_anime_service.clone()),
                MetadataLot::Manga => Box::new(self.anilist_manga_service.clone()),
                _ => return err(),
            },
            MetadataSource::Igdb => Box::new(self.igdb_service.clone()),
            MetadataSource::Custom => return err(),
        };
        Ok(service)
    }

    async fn details_from_provider(
        &self,
        lot: MetadataLot,
        source: MetadataSource,
        identifier: &str,
    ) -> Result<MediaDetails> {
        let provider = self.get_provider(lot, source)?;
        let results = provider.details(identifier).await?;
        Ok(results)
    }

    pub async fn commit_media(
        &self,
        lot: MetadataLot,
        source: MetadataSource,
        identifier: &str,
    ) -> Result<IdObject> {
        if let Some(m) = self
            .media_exists_in_database(lot, source, identifier)
            .await?
        {
            Ok(m)
        } else {
            let details = self.details_from_provider(lot, source, identifier).await?;
            let media_id = self.commit_media_internal(details).await?;
            Ok(media_id)
        }
    }

    async fn review_by_id(&self, review_id: i32) -> Result<ReviewItem> {
        let review = Review::find_by_id(review_id).one(&self.db).await?;
        match review {
            Some(r) => {
                let user = r.find_related(User).one(&self.db).await.unwrap().unwrap();
                let (show_se, show_ep, podcast_ep) = match r.extra_information {
                    Some(s) => match s {
                        SeenOrReviewExtraInformation::Show(d) => {
                            (Some(d.season), Some(d.episode), None)
                        }
                        SeenOrReviewExtraInformation::Podcast(d) => (None, None, Some(d.episode)),
                    },
                    None => (None, None, None),
                };
                Ok(ReviewItem {
                    id: r.id,
                    posted_on: r.posted_on,
                    rating: r.rating,
                    spoiler: r.spoiler,
                    text: r.text,
                    visibility: r.visibility,
                    show_season: show_se,
                    show_episode: show_ep,
                    podcast_episode: podcast_ep,
                    posted_by: ReviewPostedBy {
                        id: user.id,
                        name: user.name,
                    },
                })
            }
            None => Err(Error::new("Unable to find review".to_owned())),
        }
    }

    async fn item_reviews(
        &self,
        user_id: i32,
        metadata_id: Option<i32>,
        creator_id: Option<i32>,
    ) -> Result<Vec<ReviewItem>> {
        let all_reviews = Review::find()
            .order_by_desc(review::Column::PostedOn)
            .apply_if(metadata_id, |query, v| {
                query.filter(review::Column::MetadataId.eq(v))
            })
            .apply_if(creator_id, |query, v| {
                query.filter(review::Column::CreatorId.eq(v))
            })
            .all(&self.db)
            .await
            .unwrap();
        let mut reviews = vec![];
        for r in all_reviews {
            reviews.push(self.review_by_id(r.id).await?);
        }
        let all_reviews = reviews
            .into_iter()
            .filter(|r| match r.visibility {
                Visibility::Private => r.posted_by.id == user_id,
                _ => true,
            })
            .map(|r| ReviewItem {
                text: r.text.map(|t| markdown_to_html(&t)),
                ..r
            })
            .collect();
        Ok(all_reviews)
    }

    async fn collections(
        &self,
        user_id: i32,
        input: Option<CollectionInput>,
    ) -> Result<Vec<CollectionItem>> {
        let collections = Collection::find()
            .filter(collection::Column::UserId.eq(user_id))
            .apply_if(input.clone().and_then(|i| i.name), |query, v| {
                query.filter(collection::Column::Name.eq(v))
            })
            .order_by_asc(collection::Column::CreatedOn)
            .all(&self.db)
            .await
            .unwrap();
        let mut data = vec![];
        for collection in collections.into_iter() {
            let num_items = collection.find_related(Metadata).count(&self.db).await?;
            data.push(CollectionItem {
                id: collection.id,
                name: collection.name,
                description: collection.description,
                visibility: collection.visibility,
                num_items,
            });
        }
        Ok(data)
    }

    async fn media_in_collections(
        &self,
        user_id: i32,
        metadata_id: i32,
    ) -> Result<Vec<collection::Model>> {
        let user_collections = Collection::find()
            .filter(collection::Column::UserId.eq(user_id))
            .all(&self.db)
            .await
            .unwrap();
        let mtc = MetadataToCollection::find()
            .filter(metadata_to_collection::Column::MetadataId.eq(metadata_id))
            .filter(
                metadata_to_collection::Column::CollectionId
                    .is_in(user_collections.into_iter().map(|c| c.id).collect_vec()),
            )
            .find_also_related(Collection)
            .all(&self.db)
            .await
            .unwrap();
        let mut resp = vec![];
        mtc.into_iter().for_each(|(_, b)| {
            if let Some(m) = b {
                resp.push(m);
            }
        });
        Ok(resp)
    }

    async fn collection_contents(
        &self,
        user_id: Option<i32>,
        input: CollectionContentsInput,
    ) -> Result<CollectionContents> {
        let page = input.page.unwrap_or(1);
        let collection = Collection::find_by_id(input.collection_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        if collection.visibility != Visibility::Public {
            match user_id {
                None => {
                    return Err(Error::new(
                        "Need to be logged in to view a private collection".to_owned(),
                    ));
                }
                Some(u) => {
                    if u != collection.user_id {
                        return Err(Error::new("This collection is not public".to_owned()));
                    }
                }
            }
        }
        let metas = collection.find_related(Metadata).paginate(
            &self.db,
            input.take.unwrap_or_else(|| PAGE_LIMIT.try_into().unwrap()),
        );

        let ItemsAndPagesNumber {
            number_of_items,
            number_of_pages,
        } = metas.num_items_and_pages().await?;
        let mut meta_data = vec![];
        for meta in metas.fetch_page(page - 1).await? {
            let m = Metadata::find_by_id(meta.id)
                .one(&self.db)
                .await
                .unwrap()
                .unwrap();
            let u_t_m = UserToMetadata::find()
                .filter(user_to_metadata::Column::UserId.eq(collection.user_id))
                .filter(user_to_metadata::Column::MetadataId.eq(meta.id))
                .one(&self.db)
                .await?;
            meta_data.push((
                MediaSearchItem {
                    identifier: m.id.to_string(),
                    image: self.metadata_images(&m).await?.0.first().cloned(),
                    title: m.title,
                    publish_year: m.publish_year,
                },
                u_t_m.map(|d| d.last_updated_on).unwrap_or_default(),
                m.lot,
            ));
        }
        meta_data.sort_by_key(|item| item.1);
        let items = meta_data
            .into_iter()
            .rev()
            .map(|a| MediaSearchItemWithLot {
                details: a.0,
                lot: a.2,
            })
            .collect();
        let user = collection.find_related(User).one(&self.db).await?.unwrap();
        Ok(CollectionContents {
            details: collection,
            results: SearchResults {
                details: SearchDetails {
                    total: number_of_items.try_into().unwrap(),
                    next_page: if page < number_of_pages {
                        Some((page + 1).try_into().unwrap())
                    } else {
                        None
                    },
                },
                items,
            },
            user,
        })
    }

    pub async fn post_review(&self, user_id: i32, input: PostReviewInput) -> Result<IdObject> {
        if self.config.users.reviews_disabled {
            return Err(Error::new("Posting reviews on this instance is disabled"));
        }
        let review_id = match input.review_id {
            Some(i) => ActiveValue::Set(i),
            None => ActiveValue::NotSet,
        };
        let extra_infomation = if let (Some(season), Some(episode)) =
            (input.show_season_number, input.show_episode_number)
        {
            Some(SeenOrReviewExtraInformation::Show(
                SeenShowExtraInformation { season, episode },
            ))
        } else {
            input.podcast_episode_number.map(|episode| {
                SeenOrReviewExtraInformation::Podcast(SeenPodcastExtraInformation { episode })
            })
        };

        let mut review_obj = review::ActiveModel {
            id: review_id,
            rating: ActiveValue::Set(input.rating),
            text: ActiveValue::Set(input.text),
            user_id: ActiveValue::Set(user_id.to_owned()),
            metadata_id: ActiveValue::Set(input.metadata_id),
            creator_id: ActiveValue::Set(input.creator_id),
            extra_information: ActiveValue::Set(extra_infomation),
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
        let insert = review_obj.save(&self.db).await.unwrap();
        Ok(IdObject {
            id: insert.id.unwrap(),
        })
    }

    pub async fn delete_review(&self, user_id: i32, review_id: i32) -> Result<bool> {
        let review = Review::find()
            .filter(review::Column::Id.eq(review_id))
            .one(&self.db)
            .await
            .unwrap();
        match review {
            Some(r) => {
                if r.user_id == user_id {
                    r.delete(&self.db).await?;
                    Ok(true)
                } else {
                    Err(Error::new("This review does not belong to you".to_owned()))
                }
            }
            None => Ok(false),
        }
    }

    pub async fn create_or_update_collection(
        &self,
        user_id: i32,
        input: CreateOrUpdateCollectionInput,
    ) -> Result<IdObject> {
        let meta = Collection::find()
            .filter(collection::Column::Name.eq(input.name.clone()))
            .filter(collection::Column::UserId.eq(user_id.to_owned()))
            .one(&self.db)
            .await
            .unwrap();
        match meta {
            Some(m) if input.update_id.is_none() => Ok(IdObject { id: m.id }),
            _ => {
                let col = collection::ActiveModel {
                    id: match input.update_id {
                        Some(i) => ActiveValue::Unchanged(i),
                        None => ActiveValue::NotSet,
                    },
                    name: ActiveValue::Set(input.name),
                    user_id: ActiveValue::Set(user_id.to_owned()),
                    description: ActiveValue::Set(input.description),
                    visibility: match input.visibility {
                        None => ActiveValue::NotSet,
                        Some(v) => ActiveValue::Set(v),
                    },
                    ..Default::default()
                };
                let inserted = col.save(&self.db).await.map_err(|_| {
                    Error::new("There was an error creating the collection".to_owned())
                })?;
                Ok(IdObject {
                    id: inserted.id.unwrap(),
                })
            }
        }
    }

    pub async fn delete_collection(&self, user_id: i32, name: &str) -> Result<bool> {
        if DefaultCollection::iter().any(|col_name| col_name.to_string() == name) {
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
        user_id: i32,
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
        Ok(IdObject { id })
    }

    pub async fn add_media_to_collection(
        &self,
        user_id: i32,
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
            metadata_id: ActiveValue::Set(input.media_id),
            collection_id: ActiveValue::Set(collection.id),
        };
        Ok(col.clone().insert(&self.db).await.is_ok())
    }

    pub async fn delete_seen_item(&self, seen_id: i32, user_id: i32) -> Result<IdObject> {
        let seen_item = Seen::find_by_id(seen_id).one(&self.db).await.unwrap();
        if let Some(si) = seen_item {
            // FIXME: Also should be removed from cache but this is a very small edge case.
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
                    user_id,
                    &metadata_id,
                    &DefaultCollection::InProgress.to_string(),
                )
                .await
                .ok();
            }
            Ok(IdObject { id: seen_id })
        } else {
            Err(Error::new("This seen item does not exist".to_owned()))
        }
    }

    pub async fn update_metadata(
        &self,
        metadata_id: i32,
    ) -> Result<Vec<(String, MediaStateChanged)>> {
        tracing::trace!("Updating metadata for {:?}", metadata_id);
        let maybe_details = self
            .details_from_provider_for_existing_media(metadata_id)
            .await;
        let notifs = match maybe_details {
            Ok(details) => {
                self.update_media(
                    metadata_id,
                    details.title,
                    details.description,
                    details.images,
                    details.specifics,
                    details.creators,
                    details.genres,
                    details.production_status,
                    details.publish_year,
                )
                .await?
            }
            Err(e) => {
                tracing::error!("Error while updating: {:?}", e);
                vec![]
            }
        };
        tracing::trace!("Updated metadata for {:?}", metadata_id);
        Ok(notifs)
    }

    pub async fn update_all_metadata(&self) -> Result<bool> {
        let metadatas = Metadata::find()
            .select_only()
            .column(metadata::Column::Id)
            .order_by_asc(metadata::Column::Id)
            .into_tuple::<i32>()
            .all(&self.db)
            .await
            .unwrap();
        for metadata_id in metadatas {
            self.deploy_update_metadata_job(metadata_id).await?;
        }
        Ok(true)
    }

    async fn user_details(&self, token: &str) -> Result<UserDetailsResult> {
        let found_token = user_id_from_token(token.to_owned(), self.get_auth_db()).await;
        if let Ok(user_id) = found_token {
            let user = self.user_by_id(user_id).await?;
            Ok(UserDetailsResult::Ok(Box::new(user)))
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

    async fn latest_user_summary(&self, user_id: i32) -> Result<UserSummary> {
        let ls = self.user_by_id(user_id).await?;
        Ok(ls.summary.unwrap_or_default())
    }

    pub async fn calculate_user_summary(&self, user_id: i32) -> Result<IdObject> {
        let mut ls = UserSummary {
            calculated_on: Utc::now(),
            ..Default::default()
        };

        let num_reviews = Review::find()
            .filter(review::Column::UserId.eq(user_id.to_owned()))
            .count(&self.db)
            .await?;

        let num_measurements = UserMeasurement::find()
            .filter(user_measurement::Column::UserId.eq(user_id.to_owned()))
            .count(&self.db)
            .await?;

        ls.media.reviews_posted = num_reviews;
        ls.fitness.measurements_recorded = num_measurements;

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
        let mut unique_creators = HashSet::new();
        while let Some((seen, metadata)) = seen_items.try_next().await.unwrap() {
            let meta = metadata.to_owned().unwrap();
            meta.find_related(Creator)
                .all(&self.db)
                .await?
                .into_iter()
                .for_each(|c| {
                    unique_creators.insert(c.id);
                });
            match meta.specifics {
                MediaSpecifics::AudioBook(item) => {
                    ls.media.audio_books.played += 1;
                    if let Some(r) = item.runtime {
                        ls.media.audio_books.runtime += r;
                    }
                }
                MediaSpecifics::Anime(item) => {
                    ls.media.anime.watched += 1;
                    if let Some(r) = item.episodes {
                        ls.media.anime.episodes += r;
                    }
                }
                MediaSpecifics::Manga(item) => {
                    ls.media.manga.read += 1;
                    if let Some(r) = item.chapters {
                        ls.media.manga.chapters += r;
                    }
                }
                MediaSpecifics::Book(item) => {
                    ls.media.books.read += 1;
                    if let Some(pg) = item.pages {
                        ls.media.books.pages += pg;
                    }
                }
                MediaSpecifics::Podcast(item) => {
                    unique_podcasts.insert(seen.metadata_id);
                    for episode in item.episodes {
                        match seen.extra_information.to_owned() {
                            None => continue,
                            Some(sei) => match sei {
                                SeenOrReviewExtraInformation::Show(_) => unreachable!(),
                                SeenOrReviewExtraInformation::Podcast(s) => {
                                    if s.episode == episode.number {
                                        if let Some(r) = episode.runtime {
                                            ls.media.podcasts.runtime += r;
                                        }
                                        unique_podcast_episodes.insert((s.episode, episode.id));
                                    }
                                }
                            },
                        }
                    }
                }
                MediaSpecifics::Movie(item) => {
                    ls.media.movies.watched += 1;
                    if let Some(r) = item.runtime {
                        ls.media.movies.runtime += r;
                    }
                }
                MediaSpecifics::Music(item) => {
                    ls.media.music.listened += 1;
                    if let Some(r) = item.runtime {
                        ls.media.music.runtime += r;
                    }
                }
                MediaSpecifics::Show(item) => {
                    unique_shows.insert(seen.metadata_id);
                    for season in item.seasons {
                        for episode in season.episodes {
                            match seen.extra_information.to_owned().unwrap() {
                                SeenOrReviewExtraInformation::Podcast(_) => unreachable!(),
                                SeenOrReviewExtraInformation::Show(s) => {
                                    if s.season == season.season_number
                                        && s.episode == episode.episode_number
                                    {
                                        if let Some(r) = episode.runtime {
                                            ls.media.shows.runtime += r;
                                        }
                                        ls.media.shows.watched_episodes += 1;
                                        unique_show_seasons.insert((s.season, season.id));
                                    }
                                }
                            }
                        }
                    }
                }
                MediaSpecifics::VideoGame(_item) => {
                    ls.media.video_games.played += 1;
                }
                MediaSpecifics::Unknown => {}
            }
        }

        ls.media.podcasts.played += i32::try_from(unique_podcasts.len()).unwrap();
        ls.media.podcasts.played_episodes += i32::try_from(unique_podcast_episodes.len()).unwrap();

        ls.media.shows.watched = i32::try_from(unique_shows.len()).unwrap();
        ls.media.shows.watched_seasons += i32::try_from(unique_show_seasons.len()).unwrap();
        ls.media.creators_interacted_with += unique_creators.len();

        let user_model = user::ActiveModel {
            id: ActiveValue::Unchanged(user_id),
            summary: ActiveValue::Set(Some(ls)),
            ..Default::default()
        };
        let obj = user_model.update(&self.db).await.unwrap();
        Ok(IdObject { id: obj.id })
    }

    async fn register_user(&self, username: &str, password: &str) -> Result<RegisterResult> {
        if !self.config.users.allow_registration {
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
            preferences: ActiveValue::Set(UserPreferences::default()),
            sink_integrations: ActiveValue::Set(UserSinkIntegrations(vec![])),
            notifications: ActiveValue::Set(UserNotifications(vec![])),
            ..Default::default()
        };
        let user = user.insert(&self.db).await.unwrap();
        storage.push(UserCreatedJob { user_id: user.id }).await?;
        Ok(RegisterResult::Ok(IdObject { id: user.id }))
    }

    async fn login_user(
        &self,
        username: &str,
        password: &str,
        gql_ctx: &Context<'_>,
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
        if get_password_hasher()
            .verify_password(password.as_bytes(), &parsed_hash)
            .is_err()
        {
            return Ok(LoginResult::Error(LoginError {
                error: LoginErrorVariant::CredentialsMismatch,
            }));
        }
        let api_key = Uuid::new_v4().to_string();

        if self.set_auth_token(&api_key, user.id).await.is_err() {
            return Ok(LoginResult::Error(LoginError {
                error: LoginErrorVariant::MutexError,
            }));
        };
        create_cookie(
            gql_ctx,
            &api_key,
            false,
            self.config.server.insecure_cookie,
            self.config.server.samesite_none,
            self.config.users.token_valid_for_days,
        )?;
        Ok(LoginResult::Ok(LoginResponse { api_key }))
    }

    async fn logout_user(&self, token: &str, gql_ctx: &Context<'_>) -> Result<bool> {
        create_cookie(
            gql_ctx,
            "",
            true,
            self.config.server.insecure_cookie,
            self.config.server.samesite_none,
            self.config.users.token_valid_for_days,
        )?;
        let found_token = user_id_from_token(token.to_owned(), self.get_auth_db()).await;
        if found_token.is_ok() {
            self.get_auth_db().remove(token.to_owned()).await.unwrap();
            Ok(true)
        } else {
            Ok(false)
        }
    }

    // this job is run when a user is created for the first time
    pub async fn user_created_job(&self, user_id: i32) -> Result<()> {
        for col in DefaultCollection::iter() {
            self.create_or_update_collection(
                user_id,
                CreateOrUpdateCollectionInput {
                    name: col.to_string(),
                    description: Some(col.meta().to_owned()),
                    ..Default::default()
                },
            )
            .await
            .ok();
        }
        Ok(())
    }

    async fn update_user(&self, user_id: i32, input: UpdateUserInput) -> Result<IdObject> {
        let mut user_obj: user::ActiveModel = User::find_by_id(user_id.to_owned())
            .one(&self.db)
            .await
            .unwrap()
            .unwrap()
            .into();
        if let Some(n) = input.username {
            if self.config.users.allow_changing_username {
                user_obj.name = ActiveValue::Set(n);
            }
        }
        if let Some(e) = input.email {
            user_obj.email = ActiveValue::Set(Some(e));
        }
        if let Some(p) = input.password {
            if self.config.users.allow_changing_password {
                user_obj.password = ActiveValue::Set(p);
            }
        }
        let user_obj = user_obj.update(&self.db).await.unwrap();
        Ok(IdObject { id: user_obj.id })
    }

    pub async fn regenerate_user_summaries(&self) -> Result<()> {
        let all_users = User::find()
            .select_only()
            .column(user::Column::Id)
            .into_tuple::<i32>()
            .all(&self.db)
            .await
            .unwrap();
        for user_id in all_users {
            self.calculate_user_summary(user_id).await?;
        }
        Ok(())
    }

    async fn create_custom_media(
        &self,
        input: CreateCustomMediaInput,
        user_id: i32,
    ) -> Result<CreateCustomMediaResult> {
        let mut input = input;
        let err = || {
            Ok(CreateCustomMediaResult::Error(CreateCustomMediaError {
                error: CreateCustomMediaErrorVariant::LotDoesNotMatchSpecifics,
            }))
        };
        let specifics = match input.lot {
            MetadataLot::Music => todo!(),
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
                image: None,
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
            production_status: "Released".to_owned(),
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

    pub async fn export(&self, user_id: i32) -> Result<Vec<ImportOrExportItem<String>>> {
        let related_metadata = UserToMetadata::find()
            .filter(user_to_metadata::Column::UserId.eq(user_id))
            .all(&self.db)
            .await
            .unwrap();
        let distinct_meta_ids = related_metadata
            .into_iter()
            .map(|m| m.metadata_id)
            .collect_vec();
        let metas = Metadata::find()
            .filter(metadata::Column::Id.is_in(distinct_meta_ids))
            .order_by(metadata::Column::Id, Order::Asc)
            .all(&self.db)
            .await?;

        let mut resp = vec![];

        for m in metas {
            let mut seen_history = m
                .find_related(Seen)
                .filter(seen::Column::UserId.eq(user_id))
                .all(&self.db)
                .await
                .unwrap();
            modify_seen_elements(&mut seen_history);
            let seen_history = seen_history
                .into_iter()
                .map(|s| {
                    let (show_season_number, show_episode_number) = match s.show_information {
                        Some(d) => (Some(d.season), Some(d.episode)),
                        None => (None, None),
                    };
                    let podcast_episode_number = s.podcast_information.map(|d| d.episode);
                    ImportOrExportItemSeen {
                        started_on: s.started_on.map(convert_naive_to_utc),
                        ended_on: s.finished_on.map(convert_naive_to_utc),
                        show_season_number,
                        show_episode_number,
                        podcast_episode_number,
                    }
                })
                .collect();
            let db_reviews = m
                .find_related(Review)
                .filter(review::Column::UserId.eq(user_id))
                .all(&self.db)
                .await
                .unwrap();
            let mut reviews = vec![];
            for r in db_reviews {
                let rev = self.review_by_id(r.id).await.unwrap();
                reviews.push(ImportOrExportItemRating {
                    review: Some(ImportOrExportItemReview {
                        date: Some(rev.posted_on),
                        spoiler: Some(rev.spoiler),
                        text: rev.text,
                    }),
                    rating: rev.rating,
                    show_season_number: rev.show_season,
                    show_episode_number: rev.show_episode,
                    podcast_episode_number: rev.podcast_episode,
                });
            }
            let collections = self
                .media_in_collections(user_id, m.id)
                .await?
                .into_iter()
                .map(|c| c.name)
                .collect();
            let exp = ImportOrExportItem {
                source_id: m.id.to_string(),
                lot: m.lot,
                source: m.source,
                identifier: m.identifier,
                seen_history,
                reviews,
                collections,
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
        Statement::from_sql_and_values(self.db.get_database_backend(), sql, values)
    }

    async fn update_user_preference(
        &self,
        input: UpdateUserPreferenceInput,
        user_id: i32,
    ) -> Result<bool> {
        if !self.config.users.allow_changing_preferences {
            return Ok(false);
        }
        let err = || Error::new("Incorrect property value encountered");
        let user_model = self.user_by_id(user_id).await?;
        let mut preferences = user_model.preferences.clone();
        let (left, right) = input.property.split_once('.').ok_or_else(err)?;
        let value_bool = input.value.parse::<bool>();
        let value_usize = input.value.parse::<usize>();
        match left {
            "fitness" => {
                let (left, right) = right.split_once('.').ok_or_else(err)?;
                match left {
                    "measurements" => {
                        let (left, right) = right.split_once('.').ok_or_else(err)?;
                        match left {
                            "custom" => {
                                let value_vector = serde_json::from_str(&input.value).unwrap();
                                preferences.fitness.measurements.custom = value_vector;
                            }
                            "inbuilt" => match right {
                                "weight" => {
                                    preferences.fitness.measurements.inbuilt.weight =
                                        value_bool.unwrap();
                                }
                                "body_mass_index" => {
                                    preferences.fitness.measurements.inbuilt.body_mass_index =
                                        value_bool.unwrap();
                                }
                                "total_body_water" => {
                                    preferences.fitness.measurements.inbuilt.total_body_water =
                                        value_bool.unwrap();
                                }
                                "muscle" => {
                                    preferences.fitness.measurements.inbuilt.muscle =
                                        value_bool.unwrap();
                                }
                                "lean_body_mass" => {
                                    preferences.fitness.measurements.inbuilt.lean_body_mass =
                                        value_bool.unwrap();
                                }
                                "body_fat" => {
                                    preferences.fitness.measurements.inbuilt.body_fat =
                                        value_bool.unwrap();
                                }
                                "bone_mass" => {
                                    preferences.fitness.measurements.inbuilt.bone_mass =
                                        value_bool.unwrap();
                                }
                                "visceral_fat" => {
                                    preferences.fitness.measurements.inbuilt.visceral_fat =
                                        value_bool.unwrap();
                                }
                                "waist_circumference" => {
                                    preferences.fitness.measurements.inbuilt.waist_circumference =
                                        value_bool.unwrap();
                                }
                                "waist_to_height_ratio" => {
                                    preferences
                                        .fitness
                                        .measurements
                                        .inbuilt
                                        .waist_to_height_ratio = value_bool.unwrap();
                                }
                                "hip_circumference" => {
                                    preferences.fitness.measurements.inbuilt.hip_circumference =
                                        value_bool.unwrap();
                                }
                                "waist_to_hip_ratio" => {
                                    preferences.fitness.measurements.inbuilt.waist_to_hip_ratio =
                                        value_bool.unwrap();
                                }
                                "chest_circumference" => {
                                    preferences.fitness.measurements.inbuilt.chest_circumference =
                                        value_bool.unwrap();
                                }
                                "thigh_circumference" => {
                                    preferences.fitness.measurements.inbuilt.thigh_circumference =
                                        value_bool.unwrap();
                                }
                                "biceps_circumference" => {
                                    preferences
                                        .fitness
                                        .measurements
                                        .inbuilt
                                        .biceps_circumference = value_bool.unwrap();
                                }
                                "neck_circumference" => {
                                    preferences.fitness.measurements.inbuilt.neck_circumference =
                                        value_bool.unwrap();
                                }
                                "body_fat_caliper" => {
                                    preferences.fitness.measurements.inbuilt.body_fat_caliper =
                                        value_bool.unwrap();
                                }
                                "chest_skinfold" => {
                                    preferences.fitness.measurements.inbuilt.chest_skinfold =
                                        value_bool.unwrap();
                                }
                                "abdominal_skinfold" => {
                                    preferences.fitness.measurements.inbuilt.abdominal_skinfold =
                                        value_bool.unwrap();
                                }
                                "thigh_skinfold" => {
                                    preferences.fitness.measurements.inbuilt.thigh_skinfold =
                                        value_bool.unwrap();
                                }
                                "basal_metabolic_rate" => {
                                    preferences
                                        .fitness
                                        .measurements
                                        .inbuilt
                                        .basal_metabolic_rate = value_bool.unwrap();
                                }
                                "total_daily_energy_expenditure" => {
                                    preferences
                                        .fitness
                                        .measurements
                                        .inbuilt
                                        .total_daily_energy_expenditure = value_bool.unwrap();
                                }
                                "calories" => {
                                    preferences.fitness.measurements.inbuilt.calories =
                                        value_bool.unwrap();
                                }
                                _ => return Err(err()),
                            },
                            _ => return Err(err()),
                        }
                    }
                    "exercises" => match right {
                        "save_history" => {
                            preferences.fitness.exercises.save_history = value_usize.unwrap()
                        }
                        "distance_unit" => {
                            preferences.fitness.exercises.distance_unit =
                                UserDistanceUnit::from_str(&input.value).unwrap();
                        }
                        "weight_unit" => {
                            preferences.fitness.exercises.weight_unit =
                                UserWeightUnit::from_str(&input.value).unwrap();
                        }
                        _ => return Err(err()),
                    },
                    _ => return Err(err()),
                }
            }
            "features_enabled" => {
                let (left, right) = right.split_once('.').ok_or_else(err)?;
                match left {
                    "fitness" => match right {
                        "enabled" => {
                            preferences.features_enabled.fitness.enabled = value_bool.unwrap()
                        }
                        _ => return Err(err()),
                    },
                    "media" => {
                        match right {
                            "enabled" => {
                                preferences.features_enabled.media.enabled = value_bool.unwrap()
                            }
                            "audio_book" => {
                                preferences.features_enabled.media.audio_book = value_bool.unwrap()
                            }
                            "book" => preferences.features_enabled.media.book = value_bool.unwrap(),
                            "movie" => {
                                preferences.features_enabled.media.movie = value_bool.unwrap()
                            }
                            "music" => {
                                preferences.features_enabled.media.music = value_bool.unwrap()
                            }
                            "podcast" => {
                                preferences.features_enabled.media.podcast = value_bool.unwrap()
                            }
                            "show" => preferences.features_enabled.media.show = value_bool.unwrap(),
                            "video_game" => {
                                preferences.features_enabled.media.video_game = value_bool.unwrap()
                            }
                            "manga" => {
                                preferences.features_enabled.media.manga = value_bool.unwrap()
                            }
                            "anime" => {
                                preferences.features_enabled.media.anime = value_bool.unwrap()
                            }
                            _ => return Err(err()),
                        };
                    }
                    _ => return Err(err()),
                }
            }
            "notifications" => match right {
                "episode_released" => {
                    preferences.notifications.episode_released = value_bool.unwrap()
                }
                "status_changed" => preferences.notifications.status_changed = value_bool.unwrap(),
                "release_date_changed" => {
                    preferences.notifications.release_date_changed = value_bool.unwrap()
                }
                "number_of_seasons_changed" => {
                    preferences.notifications.number_of_seasons_changed = value_bool.unwrap()
                }
                _ => return Err(err()),
            },
            _ => return Err(err()),
        };
        let mut user_model: user::ActiveModel = user_model.into();
        user_model.preferences = ActiveValue::Set(preferences);
        user_model.update(&self.db).await?;
        Ok(true)
    }

    async fn generate_application_token(&self, user_id: i32) -> Result<String> {
        let api_token = nanoid!(10);
        self.set_auth_token(&api_token, user_id)
            .await
            .map_err(|_| Error::new("Could not set auth token"))?;
        Ok(api_token)
    }

    async fn user_integrations(&self, user_id: i32) -> Result<Vec<GraphqlUserIntegration>> {
        let user = self.user_by_id(user_id).await?;
        let mut all_integrations = vec![];
        let yank_integrations = if let Some(i) = user.yank_integrations {
            i.0
        } else {
            vec![]
        };
        yank_integrations.into_iter().for_each(|i| {
            let description = match i.settings {
                UserYankIntegrationSetting::Audiobookshelf { base_url, .. } => {
                    format!("Audiobookshelf URL: {}", base_url)
                }
            };
            all_integrations.push(GraphqlUserIntegration {
                id: i.id,
                lot: UserIntegrationLot::Yank,
                description,
                timestamp: i.timestamp,
            })
        });
        let sink_integrations = user.sink_integrations.0;
        sink_integrations.into_iter().for_each(|i| {
            let description = match i.settings {
                UserSinkIntegrationSetting::Jellyfin { slug } => {
                    format!("Jellyfin slug: {}", slug)
                }
            };
            all_integrations.push(GraphqlUserIntegration {
                id: i.id,
                lot: UserIntegrationLot::Sink,
                description,
                timestamp: i.timestamp,
            })
        });
        Ok(all_integrations)
    }

    async fn user_notification_platforms(
        &self,
        user_id: i32,
    ) -> Result<Vec<GraphqlUserNotificationPlatform>> {
        let user = self.user_by_id(user_id).await?;
        let mut all_notifications = vec![];
        let notifications = user.notifications.0;
        notifications.into_iter().for_each(|n| {
            let description = match n.settings {
                UserNotificationSetting::Apprise { url, key } => {
                    format!("Apprise URL: {}, Key: {}", url, key)
                }
                UserNotificationSetting::Discord { url } => {
                    format!("Discord webhook: {}", url)
                }
                UserNotificationSetting::Gotify { url, token, .. } => {
                    format!("Gotify URL: {}, Token: {}", url, token)
                }
                UserNotificationSetting::Ntfy { url, topic, .. } => {
                    format!("Ntfy URL: {:?}, Topic: {}", url, topic)
                }
                UserNotificationSetting::PushBullet { api_token } => {
                    format!("Pushbullet API Token: {}", api_token)
                }
                UserNotificationSetting::PushOver { key, app_key } => {
                    format!("PushOver Key: {}, App Key: {:?}", key, app_key)
                }
                UserNotificationSetting::PushSafer { key } => {
                    format!("PushSafer Key: {}", key)
                }
            };
            all_notifications.push(GraphqlUserNotificationPlatform {
                id: n.id,
                description,
                timestamp: n.timestamp,
            })
        });
        Ok(all_notifications)
    }

    async fn create_user_sink_integration(
        &self,
        user_id: i32,
        input: CreateUserSinkIntegrationInput,
    ) -> Result<usize> {
        let user = self.user_by_id(user_id).await?;
        let mut integrations = user.sink_integrations.clone().0;
        let new_integration_id = integrations.len() + 1;
        let new_integration = UserSinkIntegration {
            id: new_integration_id,
            timestamp: Utc::now(),
            settings: match input.lot {
                UserSinkIntegrationSettingKind::Jellyfin => {
                    let slug = get_id_hasher(&self.config.integration.hasher_salt)
                        .encode(&[user_id.try_into().unwrap()]);
                    let slug = format!("{}--{}", slug, nanoid!(5));
                    UserSinkIntegrationSetting::Jellyfin { slug }
                }
            },
        };
        integrations.insert(0, new_integration);
        let mut user: user::ActiveModel = user.into();
        user.sink_integrations = ActiveValue::Set(UserSinkIntegrations(integrations));
        user.update(&self.db).await?;
        Ok(new_integration_id)
    }

    async fn create_user_yank_integration(
        &self,
        user_id: i32,
        input: CreateUserYankIntegrationInput,
    ) -> Result<usize> {
        let user = self.user_by_id(user_id).await?;
        let mut integrations = if let Some(i) = user.yank_integrations.clone() {
            i.0
        } else {
            vec![]
        };
        let new_integration_id = integrations.len() + 1;
        let new_integration = UserYankIntegration {
            id: new_integration_id,
            timestamp: Utc::now(),
            settings: match input.lot {
                UserYankIntegrationSettingKind::Audiobookshelf => {
                    UserYankIntegrationSetting::Audiobookshelf {
                        base_url: input.base_url,
                        token: input.token,
                    }
                }
            },
        };
        integrations.insert(0, new_integration);
        let mut user: user::ActiveModel = user.into();
        user.yank_integrations = ActiveValue::Set(Some(UserYankIntegrations(integrations)));
        user.update(&self.db).await?;
        Ok(new_integration_id)
    }

    async fn delete_user_integration(
        &self,
        user_id: i32,
        integration_id: usize,
        integration_type: UserIntegrationLot,
    ) -> Result<bool> {
        let user = self.user_by_id(user_id).await?;
        let mut user_db: user::ActiveModel = user.clone().into();
        match integration_type {
            UserIntegrationLot::Yank => {
                let integrations = if let Some(i) = user.yank_integrations.clone() {
                    i.0
                } else {
                    vec![]
                };
                let remaining_integrations = integrations
                    .into_iter()
                    .filter(|i| i.id != integration_id)
                    .collect_vec();
                let update_value = if remaining_integrations.is_empty() {
                    None
                } else {
                    Some(UserYankIntegrations(remaining_integrations))
                };
                user_db.yank_integrations = ActiveValue::Set(update_value);
            }
            UserIntegrationLot::Sink => {
                let integrations = user.sink_integrations.clone().0;
                let remaining_integrations = integrations
                    .into_iter()
                    .filter(|i| i.id != integration_id)
                    .collect_vec();
                let update_value = UserSinkIntegrations(remaining_integrations);
                user_db.sink_integrations = ActiveValue::Set(update_value);
            }
        };
        user_db.update(&self.db).await?;
        Ok(true)
    }

    async fn create_user_notification_platform(
        &self,
        user_id: i32,
        input: CreateUserNotificationPlatformInput,
    ) -> Result<usize> {
        let user = self.user_by_id(user_id).await?;
        let mut notifications = user.notifications.clone().0;
        let new_notification_id = notifications.len() + 1;
        let new_notification = UserNotification {
            id: new_notification_id,
            timestamp: Utc::now(),
            settings: match input.lot {
                UserNotificationSettingKind::Apprise => UserNotificationSetting::Apprise {
                    url: input.base_url.unwrap(),
                    key: input.api_token.unwrap(),
                },
                UserNotificationSettingKind::Discord => UserNotificationSetting::Discord {
                    url: input.base_url.unwrap(),
                },
                UserNotificationSettingKind::Gotify => UserNotificationSetting::Gotify {
                    url: input.base_url.unwrap(),
                    token: input.api_token.unwrap(),
                    priority: input.priority,
                },
                UserNotificationSettingKind::Ntfy => UserNotificationSetting::Ntfy {
                    url: input.base_url,
                    topic: input.api_token.unwrap(),
                    priority: input.priority,
                },
                UserNotificationSettingKind::PushBullet => UserNotificationSetting::PushBullet {
                    api_token: input.api_token.unwrap(),
                },
                UserNotificationSettingKind::PushOver => UserNotificationSetting::PushOver {
                    key: input.api_token.unwrap(),
                    app_key: input.base_url,
                },
                UserNotificationSettingKind::PushSafer => UserNotificationSetting::PushSafer {
                    key: input.api_token.unwrap(),
                },
            },
        };

        notifications.insert(0, new_notification);
        let mut user: user::ActiveModel = user.into();
        user.notifications = ActiveValue::Set(UserNotifications(notifications));
        user.update(&self.db).await?;
        Ok(new_notification_id)
    }

    async fn delete_user_notification_platform(
        &self,
        user_id: i32,
        notification_id: usize,
    ) -> Result<bool> {
        let user = self.user_by_id(user_id).await?;
        let mut user_db: user::ActiveModel = user.clone().into();
        let notifications = user.notifications.clone().0;
        let remaining_notifications = notifications
            .into_iter()
            .filter(|i| i.id != notification_id)
            .collect_vec();
        let update_value = UserNotifications(remaining_notifications);
        user_db.notifications = ActiveValue::Set(update_value);
        user_db.update(&self.db).await?;
        Ok(true)
    }

    async fn set_auth_token(&self, api_key: &str, user_id: i32) -> anyhow::Result<()> {
        self.get_auth_db()
            .insert(
                api_key.to_owned(),
                MemoryAuthData {
                    user_id: user_id.to_owned(),
                    last_used_on: Utc::now(),
                },
            )
            .await
            .unwrap();
        Ok(())
    }

    async fn media_exists_in_database(
        &self,
        lot: MetadataLot,
        source: MetadataSource,
        identifier: &str,
    ) -> Result<Option<IdObject>> {
        let media = Metadata::find()
            .filter(metadata::Column::Lot.eq(lot))
            .filter(metadata::Column::Source.eq(source))
            .filter(metadata::Column::Identifier.eq(identifier))
            .one(&self.db)
            .await?;
        Ok(media.map(|m| IdObject { id: m.id }))
    }

    async fn media_sources_for_lot(&self, lot: MetadataLot) -> Vec<MetadataSource> {
        match lot {
            MetadataLot::Music => vec![MetadataSource::MusicBrainz],
            MetadataLot::AudioBook => vec![MetadataSource::Audible],
            MetadataLot::Book => vec![MetadataSource::Openlibrary, MetadataSource::GoogleBooks],
            MetadataLot::Podcast => vec![MetadataSource::Itunes, MetadataSource::Listennotes],
            MetadataLot::VideoGame => vec![MetadataSource::Igdb],
            MetadataLot::Anime | MetadataLot::Manga => vec![MetadataSource::Anilist],
            MetadataLot::Movie | MetadataLot::Show => vec![MetadataSource::Tmdb],
        }
    }

    fn providers_language_information(&self) -> Vec<ProviderLanguageInformation> {
        MetadataSource::iter()
            .map(|source| {
                let (supported, default) = match source {
                    MetadataSource::MusicBrainz => (
                        MusicBrainzService::supported_languages(),
                        MusicBrainzService::default_language(),
                    ),
                    MetadataSource::Itunes => (
                        ITunesService::supported_languages(),
                        ITunesService::default_language(),
                    ),
                    MetadataSource::Audible => (
                        AudibleService::supported_languages(),
                        AudibleService::default_language(),
                    ),
                    MetadataSource::Openlibrary => (
                        OpenlibraryService::supported_languages(),
                        OpenlibraryService::default_language(),
                    ),
                    MetadataSource::Tmdb => (
                        TmdbService::supported_languages(),
                        TmdbService::default_language(),
                    ),
                    MetadataSource::Listennotes => (
                        ListennotesService::supported_languages(),
                        ListennotesService::default_language(),
                    ),
                    MetadataSource::GoogleBooks => (
                        GoogleBooksService::supported_languages(),
                        GoogleBooksService::default_language(),
                    ),
                    MetadataSource::Igdb => (
                        IgdbService::supported_languages(),
                        IgdbService::default_language(),
                    ),
                    MetadataSource::Anilist => (
                        AnilistService::supported_languages(),
                        AnilistService::default_language(),
                    ),
                    MetadataSource::Custom => (
                        CustomService::supported_languages(),
                        CustomService::default_language(),
                    ),
                };
                ProviderLanguageInformation {
                    supported,
                    default,
                    source,
                }
            })
            .collect()
    }

    pub async fn yank_integrations_data_for_user(&self, user_id: i32) -> Result<usize> {
        if let Some(integrations) = self.user_by_id(user_id).await?.yank_integrations {
            let mut progress_updates = vec![];
            for integration in integrations.0.iter() {
                let response = match &integration.settings {
                    UserYankIntegrationSetting::Audiobookshelf { base_url, token } => {
                        self.integration_service
                            .audiobookshelf_progress(base_url, token)
                            .await
                    }
                };
                if let Ok(data) = response {
                    progress_updates.extend(data);
                }
            }
            let mut updated_count = 0;
            for pu in progress_updates.into_iter() {
                if self.integration_progress_update(pu, user_id).await.is_ok() {
                    updated_count += 1
                }
            }
            Ok(updated_count)
        } else {
            Ok(0)
        }
    }

    pub async fn yank_integrations_data(&self) -> Result<()> {
        let users_with_integrations = User::find()
            .filter(user::Column::YankIntegrations.is_not_null())
            .select_only()
            .column(user::Column::Id)
            .into_tuple::<i32>()
            .all(&self.db)
            .await?;
        for user_id in users_with_integrations {
            self.yank_integrations_data_for_user(user_id).await?;
        }
        Ok(())
    }

    async fn all_user_auth_tokens(&self, user_id: i32) -> Result<Vec<UserAuthToken>> {
        let tokens = self
            .get_auth_db()
            .iter()
            .filter_map(|r| {
                if r.user_id == user_id {
                    Some(UserAuthToken {
                        token: r.key().clone(),
                        last_used_on: r.last_used_on,
                    })
                } else {
                    None
                }
            })
            .collect_vec();
        let tokens = tokens
            .into_iter()
            .sorted_unstable_by_key(|t| t.last_used_on)
            .rev()
            .collect();
        Ok(tokens)
    }

    pub async fn delete_expired_user_auth_tokens(&self) -> Result<()> {
        let mut deleted_tokens = 0;
        for user in self.users_list().await? {
            let tokens = self.all_user_auth_tokens(user.id).await?;
            for token in tokens {
                if Utc::now() - token.last_used_on
                    > ChronoDuration::days(self.config.users.token_valid_for_days)
                    && self.get_auth_db().remove(token.token).await.is_ok()
                {
                    deleted_tokens += 1;
                }
            }
        }
        tracing::debug!("Deleted {} expired user auth tokens", deleted_tokens);
        Ok(())
    }

    async fn user_auth_tokens(&self, user_id: i32) -> Result<Vec<UserAuthToken>> {
        let mut tokens = self.all_user_auth_tokens(user_id).await?;
        tokens.iter_mut().for_each(|t| {
            // taken from https://users.rust-lang.org/t/take-last-n-characters-from-string/44638/4
            t.token.drain(0..t.token.len() - 6);
        });
        Ok(tokens)
    }

    async fn delete_user_auth_token(&self, user_id: i32, token: String) -> Result<bool> {
        let tokens = self.all_user_auth_tokens(user_id).await?;
        let resp = if let Some(t) = tokens.into_iter().find(|t| t.token.ends_with(&token)) {
            self.get_auth_db().remove(t.token).await.unwrap();
            true
        } else {
            false
        };
        Ok(resp)
    }

    async fn admin_account_guard(&self, user_id: i32) -> Result<()> {
        let main_user = self.user_by_id(user_id).await?;
        if main_user.lot != UserLot::Admin {
            return Err(Error::new("Only admins can perform this operation."));
        }
        Ok(())
    }

    async fn users_list(&self) -> Result<Vec<user::Model>> {
        Ok(User::find()
            .order_by_asc(user::Column::Id)
            .all(&self.db)
            .await?)
    }

    async fn delete_user(&self, to_delete_user_id: i32) -> Result<bool> {
        let maybe_user = User::find_by_id(to_delete_user_id).one(&self.db).await?;
        if let Some(u) = maybe_user {
            if self
                .users_list()
                .await?
                .into_iter()
                .filter(|u| u.lot == UserLot::Admin)
                .collect_vec()
                .len()
                == 1
                && u.lot == UserLot::Admin
            {
                return Ok(false);
            }
            u.delete(&self.db).await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub async fn process_integration_webhook(
        &self,
        user_hash_id: String,
        integration: String,
        payload: String,
    ) -> Result<()> {
        let integration = match integration.as_str() {
            "jellyfin" => UserSinkIntegrationSettingKind::Jellyfin,
            _ => return Err(anyhow!("Incorrect integration requested").into()),
        };
        let (user_hash, _) = user_hash_id
            .split_once("--")
            .ok_or(anyhow!("Unexpected format"))?;
        let user_id = get_id_hasher(&self.config.integration.hasher_salt).decode(user_hash)?;
        let user_id: i32 = user_id
            .first()
            .ok_or(anyhow!("Incorrect hash id provided"))?
            .to_owned()
            .try_into()?;
        let user = self.user_by_id(user_id).await?;
        for db_integration in user.sink_integrations.0.into_iter() {
            let progress = match db_integration.settings {
                UserSinkIntegrationSetting::Jellyfin { slug } => {
                    if slug == user_hash_id
                        && integration == UserSinkIntegrationSettingKind::Jellyfin
                    {
                        self.integration_service
                            .jellyfin_progress(&payload)
                            .await
                            .ok()
                    } else {
                        None
                    }
                }
            };
            if let Some(pu) = progress {
                self.integration_progress_update(pu, user_id).await.ok();
            }
        }
        Ok(())
    }

    async fn integration_progress_update(&self, pu: IntegrationMedia, user_id: i32) -> Result<()> {
        if pu.progress < self.config.integration.minimum_progress_limit {
            return Err(Error::new("Progress outside bound"));
        }
        let progress = if pu.progress > self.config.integration.maximum_progress_limit {
            100
        } else {
            pu.progress
        };
        let IdObject { id } = self.commit_media(pu.lot, pu.source, &pu.identifier).await?;
        self.progress_update(
            ProgressUpdateInput {
                metadata_id: id,
                progress: Some(progress),
                date: Some(Utc::now().date_naive()),
                show_season_number: pu.show_season_number,
                show_episode_number: pu.show_episode_number,
                podcast_episode_number: pu.podcast_episode_number,
                change_state: None,
            },
            user_id,
        )
        .await
        .ok();
        Ok(())
    }

    pub async fn after_media_seen_tasks(&self, seen: seen::Model) -> Result<()> {
        self.remove_media_item_from_collection(
            seen.user_id,
            &seen.metadata_id,
            &DefaultCollection::Watchlist.to_string(),
        )
        .await
        .ok();
        match seen.state {
            SeenState::InProgress => {
                self.add_media_to_collection(
                    seen.user_id,
                    AddMediaToCollection {
                        collection_name: DefaultCollection::InProgress.to_string(),
                        media_id: seen.metadata_id,
                    },
                )
                .await
                .ok();
            }
            SeenState::Dropped | SeenState::OnAHold => {
                self.remove_media_item_from_collection(
                    seen.user_id,
                    &seen.metadata_id,
                    &DefaultCollection::InProgress.to_string(),
                )
                .await
                .ok();
            }
            SeenState::Completed => {
                let metadata = self.generic_metadata(seen.metadata_id).await?;
                if metadata.model.lot == MetadataLot::Podcast
                    || metadata.model.lot == MetadataLot::Show
                {
                    // If the last `n` seen elements (`n` = number of episodes, excluding Specials)
                    // correspond to each episode exactly once, it means the show can be removed
                    // from the "In Progress" collection.
                    let all_episodes = match metadata.model.specifics {
                        MediaSpecifics::Show(s) => s
                            .seasons
                            .into_iter()
                            .filter(|s| s.name != "Specials")
                            .flat_map(|s| {
                                s.episodes.into_iter().map(move |e| {
                                    format!("{}-{}", s.season_number, e.episode_number)
                                })
                            })
                            .collect_vec(),
                        MediaSpecifics::Podcast(p) => p
                            .episodes
                            .into_iter()
                            .map(|e| format!("{}", e.number))
                            .collect_vec(),
                        _ => unreachable!(),
                    };
                    let seen_history = self.seen_history(seen.user_id, seen.metadata_id).await?;
                    let mut bag = HashMap::<String, i32>::from_iter(
                        all_episodes.iter().cloned().map(|e| (e, 0)),
                    );
                    seen_history
                        .into_iter()
                        .map(|h| {
                            if let Some(s) = h.show_information {
                                format!("{}-{}", s.season, s.episode)
                            } else if let Some(p) = h.podcast_information {
                                format!("{}", p.episode)
                            } else {
                                String::new()
                            }
                        })
                        .take_while_inclusive(|h| h != all_episodes.first().unwrap())
                        .for_each(|ep| {
                            bag.entry(ep).and_modify(|c| *c += 1);
                        });
                    let is_complete = bag.values().all(|&e| e == 1);
                    if is_complete {
                        self.remove_media_item_from_collection(
                            seen.user_id,
                            &seen.metadata_id,
                            &DefaultCollection::InProgress.to_string(),
                        )
                        .await
                        .ok();
                    } else {
                        self.add_media_to_collection(
                            seen.user_id,
                            AddMediaToCollection {
                                collection_name: DefaultCollection::InProgress.to_string(),
                                media_id: seen.metadata_id,
                            },
                        )
                        .await
                        .ok();
                    }
                } else {
                    self.remove_media_item_from_collection(
                        seen.user_id,
                        &seen.metadata_id,
                        &DefaultCollection::InProgress.to_string(),
                    )
                    .await
                    .ok();
                };
            }
        };
        Ok(())
    }

    pub async fn send_notifications_to_user_platforms(
        &self,
        user_id: i32,
        msg: &str,
    ) -> Result<bool> {
        let user = self.user_by_id(user_id).await?;
        let mut success = true;
        for notification in user.notifications.0 {
            if notification.settings.send_message(msg).await.is_err() {
                success = false;
            }
        }
        Ok(success)
    }

    /// Given a metadata id, get all the users that need to be sent notifications
    /// for it's state change.
    pub async fn users_to_be_notified_for_state_changes(
        &self,
        metadata_id: i32,
    ) -> Result<Vec<i32>> {
        let mut user_ids = vec![];
        let collections = Collection::find()
            .filter(collection::Column::Name.eq(DefaultCollection::Watchlist.to_string()))
            .find_with_related(Metadata)
            .all(&self.db)
            .await?;
        for (col, metadatas) in collections {
            for metadata in metadatas {
                if metadata.id == metadata_id {
                    user_ids.push(col.user_id);
                }
            }
        }
        let monitored_media = UserToMetadata::find()
            .filter(user_to_metadata::Column::Monitored.eq(true))
            .filter(user_to_metadata::Column::MetadataId.eq(metadata_id))
            .all(&self.db)
            .await?;
        for meta in monitored_media {
            if meta.metadata_id == metadata_id {
                user_ids.push(meta.user_id);
            }
        }
        Ok(user_ids)
    }

    pub async fn update_watchlist_media_and_send_notifications(&self) -> Result<()> {
        let mut meta_map = HashMap::new();
        for metadata_id in Metadata::find()
            .select_only()
            .column(metadata::Column::Id)
            .into_tuple::<i32>()
            .all(&self.db)
            .await?
        {
            let user_ids = self
                .users_to_be_notified_for_state_changes(metadata_id)
                .await?;
            meta_map.insert(metadata_id, user_ids);
        }

        for (meta, users) in meta_map {
            let notifications = self.update_metadata(meta).await?;
            for user in users {
                for notification in notifications.iter() {
                    self.send_media_state_changed_notification_for_user(user, notification)
                        .await?;
                }
            }
        }
        Ok(())
    }

    pub async fn send_media_state_changed_notification_for_user(
        &self,
        user_id: i32,
        notification: &(String, MediaStateChanged),
    ) -> Result<()> {
        let (notification, change) = notification;
        let preferences = self.user_preferences(user_id).await?;
        if matches!(change, MediaStateChanged::StatusChanged)
            && preferences.notifications.status_changed
        {
            self.send_notifications_to_user_platforms(user_id, notification)
                .await
                .ok();
        }
        if matches!(change, MediaStateChanged::EpisodeReleased)
            && preferences.notifications.episode_released
        {
            self.send_notifications_to_user_platforms(user_id, notification)
                .await
                .ok();
        }
        if matches!(change, MediaStateChanged::ReleaseDateChanged)
            && preferences.notifications.release_date_changed
        {
            self.send_notifications_to_user_platforms(user_id, notification)
                .await
                .ok();
        }
        if matches!(change, MediaStateChanged::NumberOfSeasonsChanged)
            && preferences.notifications.number_of_seasons_changed
        {
            self.send_notifications_to_user_platforms(user_id, notification)
                .await
                .ok();
        }
        Ok(())
    }

    async fn toggle_media_monitor(
        &self,
        user_id: i32,
        to_monitor_metadata_id: i32,
    ) -> Result<bool> {
        let metadata =
            associate_user_with_metadata(&user_id, &to_monitor_metadata_id, &self.db).await?;
        let new_monitored_value = !metadata.monitored;
        let mut metadata: user_to_metadata::ActiveModel = metadata.into();
        metadata.monitored = ActiveValue::Set(new_monitored_value);
        metadata.save(&self.db).await?;
        Ok(new_monitored_value)
    }

    async fn get_monitored_status(
        &self,
        user_id: i32,
        to_monitor_metadata_id: i32,
    ) -> Result<bool> {
        let metadata =
            get_user_and_metadata_association(&user_id, &to_monitor_metadata_id, &self.db).await;
        Ok(if let Some(m) = metadata {
            m.monitored
        } else {
            false
        })
    }

    pub async fn creators_list(
        &self,
        input: SearchInput,
    ) -> Result<SearchResults<MediaCreatorSearchItem>> {
        let page: u64 = input.page.unwrap_or(1).try_into().unwrap();
        let alias = "media_count";
        let query = Creator::find()
            .apply_if(input.query, |query, v| {
                query.filter(Condition::all().add(get_case_insensitive_like_query(
                    Expr::col(creator::Column::Name),
                    &v,
                )))
            })
            .column_as(
                Expr::expr(Func::count(Expr::col(
                    metadata_to_collection::Column::MetadataId,
                ))),
                alias,
            )
            .join_rev(
                JoinType::LeftJoin,
                MetadataToCreator::belongs_to(Creator)
                    .from(metadata_to_creator::Column::CreatorId)
                    .to(creator::Column::Id)
                    .into(),
            )
            .group_by(creator::Column::Id)
            .group_by(creator::Column::Name)
            .order_by(Expr::col(Alias::new(alias)), Order::Desc);
        let creators_paginator = query
            .clone()
            .into_model::<MediaCreatorSearchItem>()
            .paginate(&self.db, PAGE_LIMIT.try_into().unwrap());
        let ItemsAndPagesNumber {
            number_of_items,
            number_of_pages,
        } = creators_paginator.num_items_and_pages().await?;
        let mut creators = vec![];
        for c in creators_paginator.fetch_page(page - 1).await? {
            creators.push(c);
        }
        Ok(SearchResults {
            details: SearchDetails {
                total: number_of_items.try_into().unwrap(),
                next_page: if page < number_of_pages {
                    Some((page + 1).try_into().unwrap())
                } else {
                    None
                },
            },
            items: creators,
        })
    }

    async fn creator_details(&self, creator_id: i32) -> Result<CreatorDetails> {
        let details = Creator::find_by_id(creator_id)
            .one(&self.db)
            .await?
            .unwrap();
        let associations = MetadataToCreator::find()
            .filter(metadata_to_creator::Column::CreatorId.eq(creator_id))
            .find_also_related(Metadata)
            .all(&self.db)
            .await?;
        let mut contents: HashMap<_, Vec<_>> = HashMap::new();
        for (assoc, metadata) in associations {
            let m = metadata.unwrap();
            let image = if let Some(i) = m.images.0.first() {
                Some(self.get_stored_image(i.url.clone()).await)
            } else {
                None
            };
            let metadata = MediaSearchItemWithLot {
                details: MediaSearchItem {
                    identifier: m.id.to_string(),
                    title: m.title,
                    publish_year: m.publish_year,
                    image,
                },
                lot: m.lot,
            };
            contents
                .entry(assoc.role)
                .and_modify(|e| {
                    e.push(metadata.clone());
                })
                .or_insert(vec![metadata]);
        }
        let contents = contents
            .into_iter()
            .map(|(name, items)| CreatorDetailsGroupedByRole { name, items })
            .collect_vec();
        Ok(CreatorDetails { details, contents })
    }

    async fn create_media_reminder(
        &self,
        user_id: i32,
        input: CreateMediaReminderInput,
    ) -> Result<bool> {
        if input.remind_on < Utc::now().date_naive() {
            return Ok(false);
        }
        let utm = associate_user_with_metadata(&user_id, &input.metadata_id, &self.db).await?;
        if utm.reminder.is_some() {
            self.delete_media_reminder(user_id, input.metadata_id)
                .await?;
        }
        let mut utm: user_to_metadata::ActiveModel = utm.into();
        utm.reminder = ActiveValue::Set(Some(UserMediaReminder {
            remind_on: input.remind_on,
            message: input.message,
        }));
        utm.update(&self.db).await?;
        Ok(true)
    }

    async fn delete_media_reminder(&self, user_id: i32, metadata_id: i32) -> Result<bool> {
        let utm = associate_user_with_metadata(&user_id, &metadata_id, &self.db).await?;
        let mut utm: user_to_metadata::ActiveModel = utm.into();
        utm.reminder = ActiveValue::Set(None);
        utm.update(&self.db).await?;
        Ok(true)
    }

    pub async fn send_pending_media_reminders(&self) -> Result<()> {
        for utm in UserToMetadata::find()
            .filter(user_to_metadata::Column::Reminder.is_not_null())
            .all(&self.db)
            .await?
        {
            if let Some(reminder) = utm.reminder {
                if Utc::now().date_naive() == reminder.remind_on {
                    self.send_notifications_to_user_platforms(utm.user_id, &reminder.message)
                        .await?;
                    self.delete_media_reminder(utm.user_id, utm.metadata_id)
                        .await?;
                }
            }
        }
        Ok(())
    }
}

fn modify_seen_elements(all_seen: &mut [seen::Model]) {
    all_seen.iter_mut().for_each(|s| {
        if let Some(i) = s.extra_information.as_ref() {
            match i {
                SeenOrReviewExtraInformation::Show(sea) => {
                    s.show_information = Some(sea.clone());
                }
                SeenOrReviewExtraInformation::Podcast(sea) => {
                    s.podcast_information = Some(sea.clone());
                }
            };
        }
    });
}
