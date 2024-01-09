use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{BufWriter, Write},
    iter::zip,
    path::PathBuf,
    str::FromStr,
    sync::Arc,
};

use anyhow::anyhow;
use apalis::{prelude::Storage as ApalisStorage, sqlite::SqliteStorage};
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use async_graphql::{
    Context, Enum, Error, InputObject, InputType, Object, OneofObject, Result, SimpleObject, Union,
};
use chrono::{Datelike, Days, Duration as ChronoDuration, NaiveDate, Utc};
use database::{
    AliasedExercise, AliasedMetadata, AliasedMetadataGroup, AliasedMetadataToGenre, AliasedPerson,
    AliasedReview, AliasedSeen, AliasedUserToEntity, MetadataLot, MetadataSource,
    MetadataToMetadataRelation, SeenState, UserLot, Visibility,
};
use enum_meta::Meta;
use futures::TryStreamExt;
use harsh::Harsh;
use itertools::Itertools;
use markdown::{
    to_html as markdown_to_html, to_html_with_options as markdown_to_html_opts, CompileOptions,
    Options,
};
use nanoid::nanoid;
use retainer::Cache;
use rs_utils::{convert_naive_to_utc, get_first_and_last_day_of_month, IsFeatureEnabled};
use rust_decimal::{prelude::ToPrimitive, Decimal};
use rust_decimal_macros::dec;
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, ActiveValue, ColumnTrait, ConnectionTrait,
    DatabaseBackend, DatabaseConnection, EntityTrait, FromQueryResult, ItemsAndPagesNumber,
    Iterable, JoinType, ModelTrait, Order, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect,
    QueryTrait, RelationTrait, Statement,
};
use sea_query::{
    Alias, Asterisk, Cond, Condition, Expr, Func, NullOrdering, PostgresQueryBuilder, Query,
    SelectStatement, Value, Values,
};
use semver::Version;
use serde::{Deserialize, Serialize};
use surf::http::headers::USER_AGENT;
use tracing::instrument;
use uuid::Uuid;

use crate::{
    background::ApplicationJob,
    entities::{
        calendar_event, collection, collection_to_entity, exercise, genre, metadata,
        metadata_group, metadata_to_genre, metadata_to_metadata, metadata_to_metadata_group,
        metadata_to_person, person,
        prelude::{
            CalendarEvent, Collection, CollectionToEntity, Exercise, Genre, Metadata,
            MetadataGroup, MetadataToGenre, MetadataToMetadata, MetadataToMetadataGroup,
            MetadataToPerson, Person, Review, Seen, User, UserMeasurement, UserToEntity, Workout,
        },
        review, seen,
        user::{
            self, UserWithOnlyIntegrationsAndNotifications, UserWithOnlyPreferences,
            UserWithOnlySummary,
        },
        user_measurement, user_to_entity, workout,
    },
    file_storage::FileStorageService,
    fitness::resolver::ExerciseService,
    integrations::{IntegrationMedia, IntegrationService},
    jwt,
    miscellaneous::{CustomService, DefaultCollection},
    models::{
        fitness::UserUnitSystem,
        media::{
            AnimeSpecifics, AudioBookSpecifics, BookSpecifics, CreateOrUpdateCollectionInput,
            GenreListItem, ImportOrExportItemRating, ImportOrExportItemReview,
            ImportOrExportItemReviewComment, ImportOrExportMediaItem, ImportOrExportMediaItemSeen,
            ImportOrExportPersonItem, MangaSpecifics, MediaCreatorSearchItem, MediaDetails,
            MediaListItem, MediaSearchItem, MediaSearchItemResponse, MediaSearchItemWithLot,
            MediaSpecifics, MetadataFreeCreator, MetadataGroupListItem, MetadataImage,
            MetadataImageForMediaDetails, MetadataImageLot, MetadataVideo, MetadataVideoSource,
            MovieSpecifics, PartialMetadata, PartialMetadataPerson, PartialMetadataWithoutId,
            PodcastSpecifics, PostReviewInput, ProgressUpdateError, ProgressUpdateErrorVariant,
            ProgressUpdateInput, ProgressUpdateResultUnion, PublicCollectionItem,
            ReviewCommentUser, ReviewPostedEvent, SeenOrReviewOrCalendarEventExtraInformation,
            SeenPodcastExtraInformation, SeenShowExtraInformation, ShowSpecifics,
            UserMediaOwnership, UserMediaReminder, UserSummary, VideoGameSpecifics,
            VisualNovelSpecifics,
        },
        BackgroundJob, ChangeCollectionToEntityInput, EntityLot, IdAndNamedObject, IdObject,
        SearchDetails, SearchInput, SearchResults, StoredUrl,
    },
    providers::{
        anilist::{
            AnilistAnimeService, AnilistMangaService, AnilistService, NonMediaAnilistService,
        },
        audible::AudibleService,
        google_books::GoogleBooksService,
        igdb::IgdbService,
        itunes::ITunesService,
        listennotes::ListennotesService,
        mal::{MalAnimeService, MalMangaService, MalService, NonMediaMalService},
        manga_updates::MangaUpdatesService,
        openlibrary::OpenlibraryService,
        tmdb::{NonMediaTmdbService, TmdbMovieService, TmdbService, TmdbShowService},
        vndb::VndbService,
    },
    traits::{
        AuthProvider, DatabaseAssetsAsSingleUrl, DatabaseAssetsAsUrls, MediaProvider,
        MediaProviderLanguages,
    },
    users::{
        UserNotification, UserNotificationSetting, UserNotificationSettingKind, UserPreferences,
        UserReviewScale, UserSinkIntegration, UserSinkIntegrationSetting,
        UserSinkIntegrationSettingKind, UserYankIntegration, UserYankIntegrationSetting,
        UserYankIntegrationSettingKind,
    },
    utils::{
        add_entity_to_collection, associate_user_with_metadata, entity_in_collections,
        get_current_date, get_ilike_query, get_stored_asset, get_user_and_metadata_association,
        partial_user_by_id, user_by_id, user_id_from_token, AUTHOR, TEMP_DIR, USER_AGENT_STR,
        VERSION,
    },
};

type Provider = Box<(dyn MediaProvider + Send + Sync)>;

#[derive(Debug)]
pub enum MediaStateChanged {
    StatusChanged,
    ReleaseDateChanged,
    NumberOfSeasonsChanged,
    EpisodeReleased,
    EpisodeNameChanged,
    ChaptersOrEpisodesChanged,
    EpisodeImagesChanged,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct CreateCustomMediaInput {
    title: String,
    lot: MetadataLot,
    description: Option<String>,
    creators: Option<Vec<String>>,
    genres: Option<Vec<String>>,
    images: Option<Vec<String>>,
    videos: Option<Vec<String>>,
    is_nsfw: Option<bool>,
    publish_year: Option<i32>,
    audio_book_specifics: Option<AudioBookSpecifics>,
    book_specifics: Option<BookSpecifics>,
    movie_specifics: Option<MovieSpecifics>,
    podcast_specifics: Option<PodcastSpecifics>,
    show_specifics: Option<ShowSpecifics>,
    video_game_specifics: Option<VideoGameSpecifics>,
    manga_specifics: Option<MangaSpecifics>,
    anime_specifics: Option<AnimeSpecifics>,
    visual_novel_specifics: Option<VisualNovelSpecifics>,
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
    slug: Option<String>,
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
    #[graphql(secret)]
    auth_header: Option<String>,
    priority: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct CreateUserSinkIntegrationInput {
    lot: UserSinkIntegrationSettingKind,
    username: Option<String>,
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
}

#[derive(Debug, SimpleObject)]
struct LoginError {
    error: LoginErrorVariant,
}

#[derive(Debug, SimpleObject)]
struct LoginResponse {
    api_key: String,
    valid_for: i64,
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
    /// Dot delimited path to the property that needs to be changed. Setting it\
    /// to empty resets the preferences to default.
    property: String,
    value: String,
}

#[derive(Debug, InputObject)]
struct GenreDetailsInput {
    genre_id: i32,
    page: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
enum CollectionContentsSortBy {
    Title,
    #[default]
    LastUpdatedOn,
    Date,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone, Default)]
struct CollectionContentsFilter {
    entity_type: Option<EntityLot>,
    metadata_lot: Option<MetadataLot>,
}

#[derive(Debug, InputObject)]
struct CollectionContentsInput {
    collection_id: i32,
    search: Option<SearchInput>,
    filter: Option<CollectionContentsFilter>,
    take: Option<u64>,
    sort: Option<SortInput<CollectionContentsSortBy>>,
}

#[derive(Debug, SimpleObject)]
struct CollectionContents {
    details: collection::Model,
    results: SearchResults<MediaSearchItemWithLot>,
    reviews: Vec<ReviewItem>,
    user: user::Model,
}

#[derive(Debug, SimpleObject)]
struct ReviewItem {
    id: i32,
    posted_on: DateTimeUtc,
    rating: Option<Decimal>,
    text: Option<String>,
    visibility: Visibility,
    spoiler: bool,
    posted_by: IdAndNamedObject,
    show_season: Option<i32>,
    show_episode: Option<i32>,
    podcast_episode: Option<i32>,
    comments: Vec<ImportOrExportItemReviewComment>,
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
struct MetadataCreator {
    id: Option<i32>,
    name: String,
    image: Option<String>,
    character: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct MetadataCreatorGroupedByRole {
    name: String,
    items: Vec<MetadataCreator>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct CreatorDetails {
    details: person::Model,
    contents: Vec<CreatorDetailsGroupedByRole>,
    source_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct MetadataGroupDetails {
    details: metadata_group::Model,
    source_url: Option<String>,
    contents: Vec<PartialMetadata>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct GenreDetails {
    details: GenreListItem,
    contents: SearchResults<MediaSearchItemWithLot>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct CreatorDetailsGroupedByRole {
    /// The name of the role performed.
    name: String,
    /// The media items in which this role was performed.
    items: Vec<PartialMetadata>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MediaBaseData {
    model: metadata::Model,
    creators: Vec<MetadataCreatorGroupedByRole>,
    assets: GraphqlMediaAssets,
    genres: Vec<GenreListItem>,
    suggestions: Vec<PartialMetadata>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct GraphqlMediaGroup {
    id: i32,
    name: String,
    part: i32,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct GraphqlVideoAsset {
    video_id: String,
    source: MetadataVideoSource,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct GraphqlMediaAssets {
    images: Vec<String>,
    videos: Vec<GraphqlVideoAsset>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct GraphqlMediaDetails {
    id: i32,
    title: String,
    identifier: String,
    is_nsfw: Option<bool>,
    description: Option<String>,
    original_language: Option<String>,
    provider_rating: Option<Decimal>,
    production_status: Option<String>,
    lot: MetadataLot,
    source: MetadataSource,
    creators: Vec<MetadataCreatorGroupedByRole>,
    genres: Vec<GenreListItem>,
    assets: GraphqlMediaAssets,
    publish_year: Option<i32>,
    publish_date: Option<NaiveDate>,
    book_specifics: Option<BookSpecifics>,
    movie_specifics: Option<MovieSpecifics>,
    show_specifics: Option<ShowSpecifics>,
    video_game_specifics: Option<VideoGameSpecifics>,
    visual_novel_specifics: Option<VisualNovelSpecifics>,
    audio_book_specifics: Option<AudioBookSpecifics>,
    podcast_specifics: Option<PodcastSpecifics>,
    manga_specifics: Option<MangaSpecifics>,
    anime_specifics: Option<AnimeSpecifics>,
    source_url: Option<String>,
    suggestions: Vec<PartialMetadata>,
    group: Option<GraphqlMediaGroup>,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
enum GraphqlSortOrder {
    Desc,
    #[default]
    Asc,
}

impl From<GraphqlSortOrder> for Order {
    fn from(value: GraphqlSortOrder) -> Self {
        match value {
            GraphqlSortOrder::Desc => Self::Desc,
            GraphqlSortOrder::Asc => Self::Asc,
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

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
enum PersonSortBy {
    #[default]
    Name,
    MediaItems,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone, Default)]
#[graphql(concrete(name = "MediaSortInput", params(MediaSortBy)))]
#[graphql(concrete(name = "PersonSortInput", params(PersonSortBy)))]
#[graphql(concrete(name = "CollectionContentsSortInput", params(CollectionContentsSortBy)))]
struct SortInput<T: InputType + Default> {
    #[graphql(default)]
    order: GraphqlSortOrder,
    #[graphql(default)]
    by: T,
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
    Owned,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct MediaFilter {
    general: Option<MediaGeneralFilter>,
    collection: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct MediaListInput {
    search: SearchInput,
    lot: MetadataLot,
    filter: Option<MediaFilter>,
    sort: Option<SortInput<MediaSortBy>>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct PeopleListInput {
    search: SearchInput,
    sort: Option<SortInput<PersonSortBy>>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct MediaConsumedInput {
    identifier: String,
    lot: MetadataLot,
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
    preferences_change_allowed: bool,
    credentials_change_allowed: bool,
    item_details_height: u32,
    reviews_disabled: bool,
    videos_disabled: bool,
    upgrade: Option<UpgradeType>,
    page_limit: i32,
    deploy_admin_jobs_allowed: bool,
    timezone: String,
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
    collections: Vec<collection::Model>,
}

#[derive(SimpleObject)]
struct UserMetadataGroupDetails {
    reviews: Vec<ReviewItem>,
    collections: Vec<collection::Model>,
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
    /// The number of users who have seen this media.
    seen_by: i32,
    /// The average rating of this media in this service.
    average_rating: Option<Decimal>,
    /// The ownership status of the media.
    pub ownership: Option<UserMediaOwnership>,
}

#[derive(SimpleObject, Debug, Clone)]
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

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct EditSeenItemInput {
    seen_id: i32,
    started_on: Option<NaiveDate>,
    finished_on: Option<NaiveDate>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct PresignedPutUrlResponse {
    upload_url: String,
    key: String,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct CreateReviewCommentInput {
    /// The review this comment belongs to.
    review_id: i32,
    comment_id: Option<String>,
    text: Option<String>,
    increment_likes: Option<bool>,
    decrement_likes: Option<bool>,
    should_delete: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, Default)]
struct GraphqlCalendarEvent {
    calendar_event_id: i32,
    date: NaiveDate,
    metadata_id: i32,
    metadata_title: String,
    metadata_image: Option<String>,
    metadata_lot: MetadataLot,
    show_season_number: Option<i32>,
    show_episode_number: Option<i32>,
    podcast_episode_number: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, Default)]
struct GroupedCalendarEvent {
    events: Vec<GraphqlCalendarEvent>,
    date: NaiveDate,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone, Default)]
struct UserCalendarEventInput {
    year: i32,
    month: u32,
}

#[derive(Debug, Serialize, Deserialize, OneofObject, Clone)]
enum UserUpcomingCalendarEventInput {
    /// The number of media to select
    NextMedia(u64),
    /// The number of days to select
    NextDays(u64),
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct PresignedPutUrlInput {
    file_name: String,
    prefix: String,
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
    async fn review(&self, gql_ctx: &Context<'_>, review_id: i32) -> Result<ReviewItem> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.review_by_id(review_id, user_id, true).await
    }

    /// Get all collections for the currently logged in user.
    async fn user_collections_list(
        &self,
        gql_ctx: &Context<'_>,
        name: Option<String>,
    ) -> Result<Vec<CollectionItem>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_collections_list(user_id, name).await
    }

    /// Get a list of publicly visible collections.
    async fn public_collections_list(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<SearchResults<PublicCollectionItem>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.public_collections_list(input).await
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
    async fn person_details(
        &self,
        gql_ctx: &Context<'_>,
        person_id: i32,
    ) -> Result<CreatorDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.person_details(person_id).await
    }

    /// Get details about a genre present in the database.
    async fn genre_details(
        &self,
        gql_ctx: &Context<'_>,
        input: GenreDetailsInput,
    ) -> Result<GenreDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.genre_details(input).await
    }

    /// Get details about a metadata group present in the database.
    async fn metadata_group_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_group_id: i32,
    ) -> Result<MetadataGroupDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.metadata_group_details(metadata_group_id).await
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
    async fn get_presigned_s3_url(&self, gql_ctx: &Context<'_>, key: String) -> String {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.file_storage_service.get_presigned_url(key).await
    }

    /// Get all the features that are enabled for the service
    async fn core_enabled_features(&self, gql_ctx: &Context<'_>) -> Result<GeneralFeatures> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.core_enabled_features().await
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
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.media_search(lot, source, input, user_id).await
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

    /// Get paginated list of genres.
    async fn genres_list(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<SearchResults<GenreListItem>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.genres_list(input).await
    }

    /// Get paginated list of metadata groups.
    async fn metadata_groups_list(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<SearchResults<MetadataGroupListItem>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.metadata_groups_list(input).await
    }

    /// Get all languages supported by all the providers.
    async fn providers_language_information(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Vec<ProviderLanguageInformation> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.providers_language_information()
    }

    /// Get a summary of all the media items that have been consumed by this user.
    async fn latest_user_summary(&self, gql_ctx: &Context<'_>) -> Result<UserSummary> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.latest_user_summary(user_id).await
    }

    /// Get details that can be displayed to a user for a metadata group.
    async fn user_metadata_group_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_group_id: i32,
    ) -> Result<UserMetadataGroupDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service
            .user_metadata_group_details(user_id, metadata_group_id)
            .await
    }

    /// Get a user's preferences.
    async fn user_preferences(&self, gql_ctx: &Context<'_>) -> Result<UserPreferences> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_preferences(user_id).await
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
    async fn user_person_details(
        &self,
        gql_ctx: &Context<'_>,
        person_id: i32,
    ) -> Result<UserCreatorDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_person_details(user_id, person_id).await
    }

    /// Get calendar events for a user between a given date range.
    async fn user_calendar_events(
        &self,
        gql_ctx: &Context<'_>,
        input: UserCalendarEventInput,
    ) -> Result<Vec<GroupedCalendarEvent>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_calendar_events(user_id, input).await
    }

    /// Get upcoming calendar events for the given filter.
    async fn user_upcoming_calendar_events(
        &self,
        gql_ctx: &Context<'_>,
        input: UserUpcomingCalendarEventInput,
    ) -> Result<Vec<GraphqlCalendarEvent>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_upcoming_calendar_events(user_id, input).await
    }

    /// Get paginated list of people.
    async fn people_list(
        &self,
        gql_ctx: &Context<'_>,
        input: PeopleListInput,
    ) -> Result<SearchResults<MediaCreatorSearchItem>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.people_list(input).await
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

    /// Add a entity to a collection if it is not there, otherwise do nothing.
    async fn add_entity_to_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: ChangeCollectionToEntityInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.add_entity_to_collection(user_id, input).await
    }

    /// Remove an entity from a collection if it is not there, otherwise do nothing.
    async fn remove_entity_from_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: ChangeCollectionToEntityInput,
    ) -> Result<IdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.remove_entity_from_collection(user_id, input).await
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

    /// Deploy job to update progress of media items in bulk.
    async fn deploy_bulk_progress_update(
        &self,
        gql_ctx: &Context<'_>,
        input: Vec<ProgressUpdateInput>,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.deploy_bulk_progress_update(user_id, input).await
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

    /// Merge a media item into another. This will move all `seen`, `collection`
    /// and `review` associations with the new user and then delete the old media
    /// item completely.
    async fn merge_metadata(
        &self,
        gql_ctx: &Context<'_>,
        merge_from: i32,
        merge_into: i32,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service
            .merge_metadata(merge_from, merge_into, user_id)
            .await
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
        service.login_user(&input.username, &input.password).await
    }

    /// Update a user's profile details.
    async fn update_user(&self, gql_ctx: &Context<'_>, input: UpdateUserInput) -> Result<IdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.update_user(user_id, input).await
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

    /// Delete a user. The account making the user must an `Admin`.
    async fn delete_user(&self, gql_ctx: &Context<'_>, to_delete_user_id: i32) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.admin_account_guard(user_id).await?;
        service.delete_user(to_delete_user_id).await
    }

    /// Toggle the monitor on a media for a user.
    async fn toggle_media_monitor(&self, gql_ctx: &Context<'_>, metadata_id: i32) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.toggle_media_monitor(user_id, metadata_id).await
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

    /// Mark media as owned or remove ownership.
    async fn toggle_media_ownership(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: i32,
        owned_on: Option<NaiveDate>,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service
            .toggle_media_ownership(user_id, metadata_id, owned_on)
            .await
    }

    /// Get a presigned URL (valid for 10 minutes) for a given file name.
    async fn presigned_put_s3_url(
        &self,
        gql_ctx: &Context<'_>,
        input: PresignedPutUrlInput,
    ) -> Result<PresignedPutUrlResponse> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let (key, upload_url) = service
            .file_storage_service
            .get_presigned_put_url(input.file_name, input.prefix, true, None)
            .await;
        Ok(PresignedPutUrlResponse { upload_url, key })
    }

    /// Delete an S3 object by the given key.
    async fn delete_s3_object(&self, gql_ctx: &Context<'_>, key: String) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let resp = service.file_storage_service.delete_object(key).await;
        Ok(resp)
    }

    /// Generate an auth token without any expiry.
    async fn generate_auth_token(&self, gql_ctx: &Context<'_>) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.generate_auth_token(user_id).await
    }

    /// Create, like or delete a comment on a review.
    async fn create_review_comment(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateReviewCommentInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.create_review_comment(user_id, input).await
    }

    /// Edit the start/end date of a seen item.
    async fn edit_seen_item(
        &self,
        gql_ctx: &Context<'_>,
        input: EditSeenItemInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.edit_seen_item(input, user_id).await
    }

    /// Start a background job.
    async fn deploy_background_job(
        &self,
        gql_ctx: &Context<'_>,
        job_name: BackgroundJob,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.deploy_background_job(job_name, user_id).await
    }
}

pub struct MiscellaneousService {
    pub db: DatabaseConnection,
    pub perform_application_job: SqliteStorage<ApplicationJob>,
    timezone: Arc<chrono_tz::Tz>,
    file_storage_service: Arc<FileStorageService>,
    seen_progress_cache: Arc<Cache<ProgressUpdateCache, ()>>,
    config: Arc<config::AppConfig>,
}

impl AuthProvider for MiscellaneousService {}

impl MiscellaneousService {
    pub async fn new(
        db: &DatabaseConnection,
        config: Arc<config::AppConfig>,
        file_storage_service: Arc<FileStorageService>,
        perform_application_job: &SqliteStorage<ApplicationJob>,
        timezone: Arc<chrono_tz::Tz>,
    ) -> Self {
        let seen_progress_cache = Arc::new(Cache::new());
        let cache_clone = seen_progress_cache.clone();

        tokio::spawn(async move {
            cache_clone
                .monitor(4, 0.25, ChronoDuration::minutes(3).to_std().unwrap())
                .await
        });

        Self {
            db: db.clone(),
            config,
            timezone,
            file_storage_service,
            seen_progress_cache,
            perform_application_job: perform_application_job.clone(),
        }
    }
}

async fn get_service_latest_version() -> Result<String> {
    #[derive(Serialize, Deserialize, Debug)]
    struct GithubResponse {
        tag_name: String,
    }
    let github_response = surf::get("https://api.github.com/repos/ignisda/ryot/releases/latest")
        .header(USER_AGENT, USER_AGENT_STR)
        .await
        .map_err(|e| anyhow!(e))?
        .body_json::<GithubResponse>()
        .await
        .map_err(|e| anyhow!(e))?;
    let tag = github_response
        .tag_name
        .strip_prefix('v')
        .unwrap()
        .to_owned();
    Ok(tag)
}

static FILE: &str = "core_details.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Settings {
    latest_version: String,
}

impl MiscellaneousService {
    async fn core_details(&self) -> Result<CoreDetails> {
        let path = PathBuf::new().join(TEMP_DIR).join(FILE);
        let settings = if !path.exists() {
            let tag = get_service_latest_version().await?;
            let settings = Settings {
                latest_version: tag,
            };
            let data_to_write = serde_json::to_string(&settings);
            fs::write(path, data_to_write.unwrap()).unwrap();
            settings
        } else {
            let data = fs::read_to_string(path).unwrap();
            serde_json::from_str(&data).unwrap()
        };
        let latest_version = Version::parse(&settings.latest_version)
            .unwrap_or_else(|_| Version::parse("0.0.0").unwrap());
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
            upgrade,
            timezone: self.timezone.to_string(),
            version: VERSION.to_owned(),
            author_name: AUTHOR.to_owned(),
            docs_link: "https://ignisda.github.io/ryot".to_owned(),
            repository_link: "https://github.com/ignisda/ryot".to_owned(),
            page_limit: self.config.frontend.page_size,
            videos_disabled: self.config.server.videos_disabled,
            reviews_disabled: self.config.users.reviews_disabled,
            default_credentials: self.config.server.default_credentials,
            item_details_height: self.config.frontend.item_details_height,
            credentials_change_allowed: self.config.users.allow_changing_credentials,
            preferences_change_allowed: self.config.users.allow_changing_preferences,
            deploy_admin_jobs_allowed: self.config.server.deploy_admin_jobs_allowed,
        })
    }

    fn get_integration_service(&self) -> IntegrationService {
        IntegrationService::new()
    }

    async fn metadata_assets(&self, meta: &metadata::Model) -> Result<GraphqlMediaAssets> {
        let images = meta.images.as_urls(&self.file_storage_service).await;
        let mut videos = vec![];
        if let Some(vids) = &meta.videos {
            for v in vids.clone() {
                let url = get_stored_asset(v.identifier, &self.file_storage_service).await;
                videos.push(GraphqlVideoAsset {
                    source: v.source,
                    video_id: url,
                })
            }
        }
        Ok(GraphqlMediaAssets { images, videos })
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
            .into_model::<GenreListItem>()
            .all(&self.db)
            .await
            .unwrap();
        #[derive(Debug, FromQueryResult)]
        struct PartialCreator {
            id: i32,
            name: String,
            images: Option<Vec<MetadataImage>>,
            role: String,
            character: Option<String>,
        }
        let crts = MetadataToPerson::find()
            .expr(Expr::col(Asterisk))
            .filter(metadata_to_person::Column::MetadataId.eq(meta.id))
            .join(
                JoinType::Join,
                metadata_to_person::Relation::Person
                    .def()
                    .on_condition(|left, right| {
                        Condition::all().add(
                            Expr::col((left, metadata_to_person::Column::PersonId))
                                .equals((right, person::Column::Id)),
                        )
                    }),
            )
            .order_by_asc(metadata_to_person::Column::Index)
            .into_model::<PartialCreator>()
            .all(&self.db)
            .await?;
        let mut creators: HashMap<String, Vec<_>> = HashMap::new();
        for cr in crts {
            let image = cr.images.first_as_url(&self.file_storage_service).await;
            let creator = MetadataCreator {
                image,
                name: cr.name,
                id: Some(cr.id),
                character: cr.character,
            };
            creators
                .entry(cr.role)
                .and_modify(|e| {
                    e.push(creator.clone());
                })
                .or_insert(vec![creator.clone()]);
        }
        if let Some(free_creators) = &meta.free_creators {
            for cr in free_creators.clone() {
                let creator = MetadataCreator {
                    id: None,
                    name: cr.name,
                    image: cr.image,
                    character: None,
                };
                creators
                    .entry(cr.role)
                    .and_modify(|e| {
                        e.push(creator.clone());
                    })
                    .or_insert(vec![creator.clone()]);
            }
        }
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
        let partial_metadata_ids = MetadataToMetadata::find()
            .select_only()
            .column(metadata_to_metadata::Column::ToMetadataId)
            .filter(metadata_to_metadata::Column::FromMetadataId.eq(meta.id))
            .filter(
                metadata_to_metadata::Column::Relation.eq(MetadataToMetadataRelation::Suggestion),
            )
            .into_tuple::<i32>()
            .all(&self.db)
            .await?;
        let suggestions_temp = Metadata::find()
            .filter(metadata::Column::Id.is_in(partial_metadata_ids))
            .order_by_asc(metadata::Column::Id)
            .all(&self.db)
            .await?;
        let mut suggestions = vec![];
        for s in suggestions_temp {
            suggestions.push(PartialMetadata {
                id: s.id,
                title: s.title,
                identifier: s.identifier,
                lot: s.lot,
                source: s.source,
                image: s.images.first_as_url(&self.file_storage_service).await,
            })
        }
        let assets = self.metadata_assets(&meta).await.unwrap();
        Ok(MediaBaseData {
            model: meta,
            creators,
            assets,
            genres,
            suggestions,
        })
    }

    async fn media_details(&self, metadata_id: i32) -> Result<GraphqlMediaDetails> {
        let MediaBaseData {
            model,
            creators,
            assets,
            genres,
            suggestions,
        } = self.generic_metadata(metadata_id).await?;
        if model.is_partial.unwrap_or_default() {
            self.deploy_update_metadata_job(metadata_id).await?;
        }
        let slug = slug::slugify(&model.title);
        let identifier = &model.identifier;
        let source_url = match model.source {
            MetadataSource::Custom => None,
            // DEV: This is updated by the specifics
            MetadataSource::MangaUpdates => None,
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
            MetadataSource::Mal => {
                let bw = match model.lot {
                    MetadataLot::Anime => "anime",
                    MetadataLot::Manga => "manga",
                    _ => unreachable!(),
                };
                Some(format!("https://myanimelist.net/{bw}/{identifier}/{slug}"))
            }
            MetadataSource::Vndb => Some(format!("https://vndb.org/{identifier}")),
        };

        let group = {
            let association = MetadataToMetadataGroup::find()
                .filter(metadata_to_metadata_group::Column::MetadataId.eq(metadata_id))
                .one(&self.db)
                .await?;
            match association {
                None => None,
                Some(a) => {
                    let grp = a.find_related(MetadataGroup).one(&self.db).await?.unwrap();
                    Some(GraphqlMediaGroup {
                        id: grp.id,
                        name: grp.title,
                        part: a.part,
                    })
                }
            }
        };

        let mut resp = GraphqlMediaDetails {
            id: model.id,
            lot: model.lot,
            title: model.title,
            source: model.source,
            is_nsfw: model.is_nsfw,
            identifier: model.identifier,
            description: model.description,
            publish_date: model.publish_date,
            publish_year: model.publish_year,
            provider_rating: model.provider_rating,
            production_status: model.production_status,
            original_language: model.original_language,
            book_specifics: None,
            show_specifics: None,
            movie_specifics: None,
            manga_specifics: None,
            anime_specifics: None,
            podcast_specifics: None,
            video_game_specifics: None,
            audio_book_specifics: None,
            visual_novel_specifics: None,
            group,
            genres,
            creators,
            source_url,
            suggestions,
            assets,
        };
        if let Some(specs) = model.specifics {
            match specs {
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
                MediaSpecifics::VisualNovel(a) => {
                    resp.visual_novel_specifics = Some(a);
                }
                MediaSpecifics::Anime(a) => {
                    resp.anime_specifics = Some(a);
                }
                MediaSpecifics::Manga(a) => {
                    if a.url.is_some() {
                        resp.source_url = a.url.clone();
                    }
                    resp.manga_specifics = Some(a);
                }
                MediaSpecifics::Unknown => {}
            };
        }
        Ok(resp)
    }

    async fn user_media_details(&self, user_id: i32, metadata_id: i32) -> Result<UserMediaDetails> {
        let media_details = self.media_details(metadata_id).await?;
        let collections =
            entity_in_collections(&self.db, user_id, metadata_id.to_string(), EntityLot::Media)
                .await?;
        let reviews = self
            .item_reviews(user_id, Some(metadata_id), None, None, None)
            .await?;
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
                    .map(|s| (s.season_number, &s.episodes))
                    .collect_vec()
                    .into_iter()
                    .flat_map(|(s, e)| {
                        e.iter().map(move |e| UserMediaNextEpisode {
                            season_number: Some(s),
                            episode_number: Some(e.episode_number),
                        })
                    })
                    .collect_vec();
                let next = all_episodes.iter().position(|e| {
                    e.season_number == Some(h.show_information.as_ref().unwrap().season)
                        && e.episode_number == Some(h.show_information.as_ref().unwrap().episode)
                });
                Some(all_episodes.get(next? + 1)?.clone())
            } else if let Some(p) = &media_details.podcast_specifics {
                let all_episodes = p
                    .episodes
                    .iter()
                    .map(|e| UserMediaNextEpisode {
                        season_number: None,
                        episode_number: Some(e.number),
                    })
                    .collect_vec();
                let next = all_episodes.iter().position(|e| {
                    e.episode_number == Some(h.podcast_information.as_ref().unwrap().episode)
                });
                Some(all_episodes.get(next? + 1)?.clone())
            } else {
                None
            }
        });
        let is_monitored = self.get_monitored_status(user_id, metadata_id).await?;
        let metadata_alias = Alias::new("m");
        let seen_alias = Alias::new("s");
        let seen_select = Query::select()
            .expr_as(
                Expr::col((metadata_alias.clone(), AliasedMetadata::Id)),
                Alias::new("metadata_id"),
            )
            .expr_as(
                Func::count(Expr::col((seen_alias.clone(), AliasedSeen::MetadataId))),
                Alias::new("num_times_seen"),
            )
            .from_as(AliasedMetadata::Table, metadata_alias.clone())
            .join_as(
                JoinType::LeftJoin,
                AliasedSeen::Table,
                seen_alias.clone(),
                Expr::col((metadata_alias.clone(), AliasedMetadata::Id))
                    .equals((seen_alias.clone(), AliasedSeen::MetadataId)),
            )
            .and_where(Expr::col((metadata_alias.clone(), AliasedMetadata::Id)).eq(metadata_id))
            .group_by_col((metadata_alias.clone(), AliasedMetadata::Id))
            .to_owned();
        let stmt = self.get_db_stmt(seen_select);
        let seen_by = self
            .db
            .query_one(stmt)
            .await?
            .map(|qr| qr.try_get_by_index::<i64>(1).unwrap())
            .unwrap();
        let seen_by: i32 = seen_by.try_into().unwrap();
        let user_to_meta =
            get_user_and_metadata_association(&user_id, &metadata_id, &self.db).await;
        let reminder = user_to_meta.clone().and_then(|n| n.metadata_reminder);
        let ownership = user_to_meta.and_then(|n| n.metadata_ownership);

        let average_rating = if reviews.is_empty() {
            None
        } else {
            let total_rating = reviews.iter().flat_map(|r| r.rating).collect_vec();
            let sum = total_rating.iter().sum::<Decimal>();
            if sum == dec!(0) {
                None
            } else {
                Some(sum / Decimal::from(total_rating.iter().len()))
            }
        };
        Ok(UserMediaDetails {
            collections,
            reviews,
            history,
            in_progress,
            next_episode: next_episode.clone(),
            is_monitored,
            seen_by,
            reminder,
            average_rating,
            ownership,
        })
    }

    async fn user_person_details(
        &self,
        user_id: i32,
        creator_id: i32,
    ) -> Result<UserCreatorDetails> {
        let reviews = self
            .item_reviews(user_id, None, Some(creator_id), None, None)
            .await?;
        let collections =
            entity_in_collections(&self.db, user_id, creator_id.to_string(), EntityLot::Person)
                .await?;
        Ok(UserCreatorDetails {
            reviews,
            collections,
        })
    }

    async fn user_metadata_group_details(
        &self,
        user_id: i32,
        metadata_group_id: i32,
    ) -> Result<UserMetadataGroupDetails> {
        let collections = entity_in_collections(
            &self.db,
            user_id,
            metadata_group_id.to_string(),
            EntityLot::MediaGroup,
        )
        .await?;
        let reviews = self
            .item_reviews(user_id, None, None, Some(metadata_group_id), None)
            .await?;
        Ok(UserMetadataGroupDetails {
            reviews,
            collections,
        })
    }

    async fn get_calendar_events(
        &self,
        user_id: i32,
        only_monitored: bool,
        start_date: Option<NaiveDate>,
        end_date: Option<NaiveDate>,
        media_limit: Option<u64>,
    ) -> Result<Vec<GraphqlCalendarEvent>> {
        #[derive(Debug, FromQueryResult, Clone)]
        struct CalEvent {
            id: i32,
            date: NaiveDate,
            metadata_id: i32,
            m_title: String,
            m_images: Option<Vec<MetadataImage>>,
            m_lot: MetadataLot,
            m_specifics: MediaSpecifics,
            metadata_extra_information: SeenOrReviewOrCalendarEventExtraInformation,
        }
        let all_events = CalendarEvent::find()
            .column_as(
                Expr::col((AliasedMetadata::Table, metadata::Column::Lot)),
                "m_lot",
            )
            .column_as(
                Expr::col((AliasedMetadata::Table, metadata::Column::Title)),
                "m_title",
            )
            .column_as(
                Expr::col((AliasedMetadata::Table, metadata::Column::Images)),
                "m_images",
            )
            .column_as(
                Expr::col((AliasedMetadata::Table, metadata::Column::Specifics)),
                "m_specifics",
            )
            .filter(
                Expr::col((AliasedUserToEntity::Table, user_to_entity::Column::UserId)).eq(user_id),
            )
            .join(JoinType::Join, calendar_event::Relation::Metadata.def())
            .join_rev(
                JoinType::Join,
                UserToEntity::belongs_to(CalendarEvent)
                    .from(user_to_entity::Column::MetadataId)
                    .to(calendar_event::Column::MetadataId)
                    .on_condition(move |left, _right| {
                        Condition::all().add_option(match only_monitored {
                            true => Some(
                                Expr::col((left, user_to_entity::Column::MetadataMonitored))
                                    .eq(true),
                            ),
                            false => None,
                        })
                    })
                    .into(),
            )
            .order_by_asc(calendar_event::Column::Date)
            .apply_if(end_date, |q, v| {
                q.filter(calendar_event::Column::Date.gte(v))
            })
            .apply_if(start_date, |q, v| {
                q.filter(calendar_event::Column::Date.lte(v))
            })
            .limit(media_limit)
            .into_model::<CalEvent>()
            .all(&self.db)
            .await?;
        let mut events = vec![];
        for evt in all_events {
            let mut calc = GraphqlCalendarEvent {
                calendar_event_id: evt.id,
                date: evt.date,
                metadata_id: evt.metadata_id,
                metadata_title: evt.m_title,
                metadata_lot: evt.m_lot,
                ..Default::default()
            };
            let mut image = None;
            match evt.metadata_extra_information {
                SeenOrReviewOrCalendarEventExtraInformation::Show(s) => {
                    calc.show_season_number = Some(s.season);
                    calc.show_episode_number = Some(s.episode);
                    if let MediaSpecifics::Show(sh) = evt.m_specifics {
                        if let Some((_, ep)) = sh.get_episode(s.season, s.episode) {
                            image = ep.poster_images.first().cloned();
                        }
                    }
                }
                SeenOrReviewOrCalendarEventExtraInformation::Podcast(p) => {
                    calc.podcast_episode_number = Some(p.episode);
                    if let MediaSpecifics::Podcast(po) = evt.m_specifics {
                        if let Some(ep) = po.get_episode(p.episode) {
                            image = ep.thumbnail.clone();
                        }
                    };
                }
                SeenOrReviewOrCalendarEventExtraInformation::Other(_) => {}
            }
            if image.is_none() {
                image = evt.m_images.first_as_url(&self.file_storage_service).await
            }
            calc.metadata_image = image;
            events.push(calc);
        }
        Ok(events)
    }

    async fn user_calendar_events(
        &self,
        user_id: i32,
        input: UserCalendarEventInput,
    ) -> Result<Vec<GroupedCalendarEvent>> {
        let (end_date, start_date) = get_first_and_last_day_of_month(input.year, input.month);
        let events = self
            .get_calendar_events(user_id, false, Some(start_date), Some(end_date), None)
            .await?;
        let grouped_events = events
            .into_iter()
            .group_by(|event| event.date)
            .into_iter()
            .map(|(date, events)| GroupedCalendarEvent {
                date,
                events: events.collect(),
            })
            .collect();
        Ok(grouped_events)
    }

    async fn user_upcoming_calendar_events(
        &self,
        user_id: i32,
        input: UserUpcomingCalendarEventInput,
    ) -> Result<Vec<GraphqlCalendarEvent>> {
        let from_date = Utc::now().date_naive();
        let (media_limit, to_date) = match input {
            UserUpcomingCalendarEventInput::NextMedia(l) => (Some(l), None),
            UserUpcomingCalendarEventInput::NextDays(d) => {
                (None, from_date.checked_add_days(Days::new(d)))
            }
        };
        let events = self
            .get_calendar_events(user_id, true, to_date, Some(from_date), media_limit)
            .await?;
        Ok(events)
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
        let metadata_alias = Alias::new("m");
        let seen_alias = Alias::new("s");
        let review_alias = Alias::new("r");
        let mtu_alias = Alias::new("mtu");

        let preferences = partial_user_by_id::<UserWithOnlyPreferences>(&self.db, user_id)
            .await?
            .preferences;
        let distinct_meta_ids = UserToEntity::find()
            .select_only()
            .column(user_to_entity::Column::MetadataId)
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::MetadataId.is_not_null())
            .apply_if(
                match input.filter.as_ref().and_then(|f| f.general) {
                    Some(MediaGeneralFilter::ExplicitlyMonitored) => Some(true),
                    _ => None,
                },
                |query, v| query.filter(user_to_entity::Column::MetadataMonitored.eq(v)),
            )
            .apply_if(
                match input.filter.as_ref().and_then(|f| f.general) {
                    Some(MediaGeneralFilter::Owned) => Some(true),
                    _ => None,
                },
                |query, _v| query.filter(user_to_entity::Column::MetadataOwnership.is_not_null()),
            )
            .into_tuple::<i32>()
            .all(&self.db)
            .await?;

        let mut main_select = Query::select()
            .expr(Expr::col((metadata_alias.clone(), Asterisk)))
            .from_as(AliasedMetadata::Table, metadata_alias.clone())
            .and_where_option(match preferences.general.display_nsfw {
                true => None,
                false => {
                    Some(Expr::col((metadata_alias.clone(), AliasedMetadata::IsNsfw)).eq(false))
                }
            })
            .and_where(Expr::col((metadata_alias.clone(), AliasedMetadata::Lot)).eq(input.lot))
            .and_where(
                Expr::col((metadata_alias.clone(), AliasedMetadata::Id))
                    .is_in(distinct_meta_ids.clone()),
            )
            .to_owned();

        if let Some(v) = input.search.query {
            let get_contains_expr = |col: metadata::Column| {
                get_ilike_query(
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
                            .order_by(
                                (metadata_alias.clone(), metadata::Column::PublishDate),
                                order_by.clone(),
                            )
                            .order_by_with_nulls(
                                (metadata_alias.clone(), metadata::Column::PublishYear),
                                order_by.clone(),
                                NullOrdering::Last,
                            )
                            .order_by((metadata_alias.clone(), metadata::Column::Title), order_by)
                            .to_owned();
                    }
                    MediaSortBy::LastSeen => {
                        let last_seen = Alias::new("last_seen");
                        let sub_select = Query::select()
                            .column(AliasedSeen::MetadataId)
                            .expr_as(
                                Func::max(Expr::col(AliasedSeen::FinishedOn)),
                                last_seen.clone(),
                            )
                            .from(AliasedSeen::Table)
                            .and_where(Expr::col(AliasedSeen::UserId).eq(user_id))
                            .and_where(Expr::col(AliasedReview::MetadataId).is_not_null())
                            .group_by_col(AliasedSeen::MetadataId)
                            .to_owned();
                        main_select = main_select
                            .join_subquery(
                                JoinType::LeftJoin,
                                sub_select,
                                seen_alias.clone(),
                                Expr::col((metadata_alias.clone(), AliasedMetadata::Id))
                                    .equals((seen_alias.clone(), AliasedSeen::MetadataId)),
                            )
                            .order_by_with_nulls(
                                (seen_alias.clone(), last_seen),
                                order_by.clone(),
                                NullOrdering::Last,
                            )
                            .order_by((metadata_alias.clone(), metadata::Column::Title), order_by)
                            .to_owned();
                    }
                    MediaSortBy::LastUpdated => {
                        main_select = main_select
                            .join_as(
                                JoinType::LeftJoin,
                                AliasedUserToEntity::Table,
                                mtu_alias.clone(),
                                Expr::col((metadata_alias.clone(), AliasedMetadata::Id))
                                    .equals((mtu_alias.clone(), AliasedUserToEntity::MetadataId))
                                    .and(
                                        Expr::col((mtu_alias.clone(), AliasedUserToEntity::UserId))
                                            .eq(user_id),
                                    ),
                            )
                            .order_by(
                                (mtu_alias.clone(), AliasedUserToEntity::LastUpdatedOn),
                                order_by,
                            )
                            .to_owned();
                    }
                    MediaSortBy::Rating => {
                        let alias_name = "average_rating";
                        main_select = main_select
                            .expr_as(
                                Func::avg(Expr::col((review_alias.clone(), AliasedReview::Rating))),
                                Alias::new(alias_name),
                            )
                            .join_as(
                                JoinType::LeftJoin,
                                AliasedReview::Table,
                                review_alias.clone(),
                                Expr::col((metadata_alias.clone(), AliasedMetadata::Id))
                                    .equals((review_alias.clone(), AliasedReview::MetadataId))
                                    .and(
                                        Expr::col((review_alias.clone(), AliasedReview::UserId))
                                            .eq(user_id),
                                    ),
                            )
                            .group_by_col((metadata_alias.clone(), AliasedMetadata::Id))
                            .order_by_expr_with_nulls(
                                Expr::cust(alias_name),
                                order_by.clone(),
                                NullOrdering::Last,
                            )
                            .order_by((metadata_alias.clone(), metadata::Column::Title), order_by)
                            .to_owned();
                    }
                };
            }
        };

        if let Some(f) = input.filter {
            if let Some(s) = f.collection {
                let all_media = CollectionToEntity::find()
                    .filter(collection_to_entity::Column::CollectionId.eq(s))
                    .filter(collection_to_entity::Column::MetadataId.is_not_null())
                    .all(&self.db)
                    .await?;
                let collections = all_media.into_iter().map(|m| m.metadata_id).collect_vec();
                main_select = main_select
                    .and_where(
                        Expr::col((metadata_alias.clone(), AliasedMetadata::Id)).is_in(collections),
                    )
                    .to_owned();
            }
            if let Some(s) = f.general {
                let reviews = match s {
                    MediaGeneralFilter::Rated | MediaGeneralFilter::Unrated => {
                        Review::find()
                            .select_only()
                            .column(review::Column::MetadataId)
                            .filter(review::Column::UserId.eq(user_id))
                            .filter(review::Column::MetadataId.is_not_null())
                            .into_tuple::<i32>()
                            .all(&self.db)
                            .await?
                    }
                    _ => vec![],
                };
                match s {
                    MediaGeneralFilter::All => {}
                    MediaGeneralFilter::Owned => {}
                    MediaGeneralFilter::ExplicitlyMonitored => {}
                    MediaGeneralFilter::Rated => {
                        main_select = main_select
                            .and_where(
                                Expr::col((metadata_alias.clone(), AliasedMetadata::Id))
                                    .is_in(reviews),
                            )
                            .to_owned();
                    }
                    MediaGeneralFilter::Unrated => {
                        main_select = main_select
                            .and_where(
                                Expr::col((metadata_alias.clone(), AliasedMetadata::Id))
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
                            .select_only()
                            .column(seen::Column::MetadataId)
                            .filter(seen::Column::UserId.eq(user_id))
                            .filter(seen::Column::State.eq(state))
                            .into_tuple::<i32>()
                            .all(&self.db)
                            .await?;
                        main_select = main_select
                            .and_where(
                                Expr::col((metadata_alias.clone(), AliasedMetadata::Id))
                                    .is_in(filtered_ids),
                            )
                            .to_owned();
                    }
                    MediaGeneralFilter::Unseen => {
                        let filtered_ids = Seen::find()
                            .select_only()
                            .column(seen::Column::MetadataId)
                            .filter(seen::Column::UserId.eq(user_id))
                            .into_tuple::<i32>()
                            .all(&self.db)
                            .await?;
                        main_select = main_select
                            .and_where(
                                Expr::col((metadata_alias.clone(), AliasedMetadata::Id))
                                    .is_not_in(filtered_ids),
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
            .limit(self.config.frontend.page_size as u64)
            .offset(((input.search.page.unwrap() - 1) * self.config.frontend.page_size) as u64)
            .to_owned();
        let stmt = self.get_db_stmt(main_select);
        let metadata_items = InnerMediaSearchItem::find_by_statement(stmt)
            .all(&self.db)
            .await?;
        let mut items = vec![];

        for met in metadata_items {
            let avg_select = Query::select()
                .expr(Func::round_with_precision(
                    Func::avg(
                        Expr::col((AliasedReview::Table, AliasedReview::Rating)).div(
                            match preferences.general.review_scale {
                                UserReviewScale::OutOfFive => 20,
                                UserReviewScale::OutOfHundred => 1,
                            },
                        ),
                    ),
                    match preferences.general.review_scale {
                        UserReviewScale::OutOfFive => 1,
                        UserReviewScale::OutOfHundred => 0,
                    },
                ))
                .from(AliasedReview::Table)
                .cond_where(
                    Cond::all()
                        .add(Expr::col((AliasedReview::Table, AliasedReview::UserId)).eq(user_id))
                        .add(
                            Expr::col((AliasedReview::Table, AliasedReview::MetadataId)).eq(met.id),
                        ),
                )
                .to_owned();
            let stmt = self.get_db_stmt(avg_select);
            let avg = self
                .db
                .query_one(stmt)
                .await?
                .map(|qr| qr.try_get_by_index::<Decimal>(0).ok())
                .unwrap();
            let images = serde_json::from_value(met.images).unwrap();
            let assets = self
                .metadata_assets(&metadata::Model {
                    images,
                    ..Default::default()
                })
                .await?;
            let m_small = MediaListItem {
                data: MediaSearchItem {
                    identifier: met.id.to_string(),
                    title: met.title,
                    image: assets.images.first().cloned(),
                    publish_year: met.publish_year,
                },
                average_rating: avg,
            };
            items.push(m_small);
        }
        let next_page =
            if total - ((input.search.page.unwrap()) * self.config.frontend.page_size) > 0 {
                Some(input.search.page.unwrap() + 1)
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
        let seen = match action {
            ProgressUpdateAction::Update => {
                let progress = input.progress.unwrap();
                let num_times_seen = prev_seen[0].num_times_updated;
                let mut last_seen: seen::ActiveModel = prev_seen[0].clone().into();
                last_seen.state = ActiveValue::Set(SeenState::InProgress);
                last_seen.progress = ActiveValue::Set(progress);
                last_seen.num_times_updated =
                    ActiveValue::Set(Some(num_times_seen.unwrap_or_default() + 1));
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
                        let num_times_seen = ls.num_times_updated;
                        let mut last_seen: seen::ActiveModel = ls.into();
                        last_seen.state = ActiveValue::Set(new_state);
                        last_seen.num_times_updated =
                            ActiveValue::Set(Some(num_times_seen.unwrap_or_default() + 1));
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
                let extra_information = match meta.lot {
                    MetadataLot::Show => {
                        if let (Some(season), Some(episode), Some(MediaSpecifics::Show(spec))) = (
                            input.show_season_number,
                            input.show_episode_number,
                            meta.specifics,
                        ) {
                            let is_there = spec.get_episode(season, episode).is_some();
                            if !is_there {
                                return Ok(ProgressUpdateResultUnion::Error(ProgressUpdateError {
                                    error: ProgressUpdateErrorVariant::InvalidUpdate,
                                }));
                            }
                            Some(SeenOrReviewOrCalendarEventExtraInformation::Show(
                                SeenShowExtraInformation { season, episode },
                            ))
                        } else {
                            return Ok(ProgressUpdateResultUnion::Error(ProgressUpdateError {
                                error: ProgressUpdateErrorVariant::InvalidUpdate,
                            }));
                        }
                    }
                    MetadataLot::Podcast => {
                        if let (Some(episode), Some(MediaSpecifics::Podcast(spec))) =
                            (input.podcast_episode_number, meta.specifics)
                        {
                            let is_there = spec.get_episode(episode).is_some();
                            if !is_there {
                                return Ok(ProgressUpdateResultUnion::Error(ProgressUpdateError {
                                    error: ProgressUpdateErrorVariant::InvalidUpdate,
                                }));
                            }
                            Some(SeenOrReviewOrCalendarEventExtraInformation::Podcast(
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
                    extra_information: ActiveValue::Set(extra_information),
                    state: ActiveValue::Set(SeenState::InProgress),
                    ..Default::default()
                };
                seen_insert.insert(&self.db).await.unwrap()
            }
        };
        let id = seen.id;
        if seen.state == SeenState::Completed {
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
        self.after_media_seen_tasks(seen).await?;
        Ok(ProgressUpdateResultUnion::Ok(IdObject { id }))
    }

    pub async fn deploy_bulk_progress_update(
        &self,
        user_id: i32,
        input: Vec<ProgressUpdateInput>,
    ) -> Result<bool> {
        self.perform_application_job
            .clone()
            .push(ApplicationJob::BulkProgressUpdate(user_id, input))
            .await?;
        Ok(true)
    }

    pub async fn bulk_progress_update(
        &self,
        user_id: i32,
        input: Vec<ProgressUpdateInput>,
    ) -> Result<bool> {
        for seen in input {
            self.progress_update(seen, user_id).await.ok();
        }
        Ok(true)
    }

    pub async fn deploy_background_job(
        &self,
        job_name: BackgroundJob,
        user_id: i32,
    ) -> Result<bool> {
        let sqlite_storage = &mut self.perform_application_job.clone();
        match job_name {
            BackgroundJob::CalculateSummary => {
                sqlite_storage
                    .push(ApplicationJob::RecalculateUserSummary(user_id))
                    .await?;
            }
            BackgroundJob::YankIntegrationsData => {
                sqlite_storage
                    .push(ApplicationJob::YankIntegrationsData(user_id))
                    .await?;
            }
            BackgroundJob::UpdateAllMetadata => {
                if !self.config.server.deploy_admin_jobs_allowed {
                    return Ok(false);
                }
                self.admin_account_guard(user_id).await?;
                let many_metadata = Metadata::find()
                    .select_only()
                    .column(metadata::Column::Id)
                    .filter(metadata::Column::IsPartial.eq(false))
                    .order_by_asc(metadata::Column::LastUpdatedOn)
                    .into_tuple::<i32>()
                    .all(&self.db)
                    .await
                    .unwrap();
                for metadata_id in many_metadata {
                    self.deploy_update_metadata_job(metadata_id).await?;
                }
            }
            BackgroundJob::UpdateAllExercises => {
                self.admin_account_guard(user_id).await?;
                let service = ExerciseService::new(
                    &self.db,
                    self.config.clone(),
                    self.file_storage_service.clone(),
                    &self.perform_application_job,
                );
                service.deploy_update_exercise_library_job().await?;
            }
            BackgroundJob::RecalculateCalendarEvents => {
                self.admin_account_guard(user_id).await?;
                sqlite_storage
                    .push(ApplicationJob::RecalculateCalendarEvents)
                    .await?;
            }
            BackgroundJob::EvaluateWorkouts => {
                sqlite_storage
                    .push(ApplicationJob::ReEvaluateUserWorkouts(user_id))
                    .await?;
            }
        };
        Ok(true)
    }

    pub async fn cleanup_user_and_metadata_association(&self) -> Result<()> {
        let all_user_to_metadata = UserToEntity::find()
            .filter(user_to_entity::Column::MetadataId.is_not_null())
            .all(&self.db)
            .await
            .unwrap();
        for u in all_user_to_metadata {
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
            let meta_ids: Vec<i32> = CollectionToEntity::find()
                .select_only()
                .column(collection_to_entity::Column::MetadataId)
                .filter(collection_to_entity::Column::CollectionId.is_in(collection_ids))
                .filter(collection_to_entity::Column::MetadataId.is_not_null())
                .into_tuple()
                .all(&self.db)
                .await
                .unwrap();
            let is_in_collection = meta_ids.contains(&u.metadata_id.unwrap());
            // if the metadata is monitored
            let is_monitored = u.metadata_monitored.unwrap_or_default();
            // if user has set a reminder
            let is_reminder_active = u.metadata_reminder.is_some();
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
        is_nsfw: Option<bool>,
        description: Option<String>,
        provider_rating: Option<Decimal>,
        url_images: Vec<MetadataImageForMediaDetails>,
        s3_images: Vec<MetadataImageForMediaDetails>,
        videos: Vec<MetadataVideo>,
        specifics: Option<MediaSpecifics>,
        creators: Vec<MetadataFreeCreator>,
        people: Vec<PartialMetadataPerson>,
        genres: Vec<String>,
        production_status: Option<String>,
        original_language: Option<String>,
        publish_year: Option<i32>,
        publish_date: Option<NaiveDate>,
        suggestions: Vec<PartialMetadataWithoutId>,
        group_identifiers: Vec<String>,
    ) -> Result<Vec<(String, MediaStateChanged)>> {
        let mut notifications = vec![];

        let meta = Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();

        if let (Some(p1), Some(p2)) = (&meta.production_status, &production_status) {
            if p1 != p2 {
                notifications.push((
                    format!("Status changed from {:#?} to {:#?}", p1, p2),
                    MediaStateChanged::StatusChanged,
                ));
            }
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
            (Some(MediaSpecifics::Show(s1)), Some(MediaSpecifics::Show(s2))) => {
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
                        } else {
                            for (before_episode, after_episode) in
                                zip(s1.episodes.iter(), s2.episodes.iter())
                            {
                                if before_episode.name != after_episode.name {
                                    notifications.push((
                                        format!(
                                            "Episode name changed from {:#?} to {:#?} (S{}E{})",
                                            before_episode.name,
                                            after_episode.name,
                                            s1.season_number,
                                            before_episode.episode_number
                                        ),
                                        MediaStateChanged::EpisodeNameChanged,
                                    ));
                                }
                                if before_episode.poster_images != after_episode.poster_images {
                                    notifications.push((
                                        format!(
                                            "Episode image changed for S{}E{}",
                                            s1.season_number, before_episode.episode_number
                                        ),
                                        MediaStateChanged::EpisodeImagesChanged,
                                    ));
                                }
                                if let (Some(pd1), Some(pd2)) =
                                    (before_episode.publish_date, after_episode.publish_date)
                                {
                                    if pd1 != pd2 {
                                        notifications.push((
                                            format!(
                                                "Episode release date changed from {:?} to {:?} (S{}E{})",
                                                pd1,
                                                pd2,
                                                s1.season_number,
                                                before_episode.episode_number
                                            ),
                                            MediaStateChanged::ReleaseDateChanged,
                                        ));
                                    }
                                }
                            }
                        }
                    }
                }
            }
            (Some(MediaSpecifics::Anime(a1)), Some(MediaSpecifics::Anime(a2))) => {
                if let (Some(e1), Some(e2)) = (a1.episodes, a2.episodes) {
                    if e1 != e2 {
                        notifications.push((
                            format!("Number of episodes changed from {:#?} to {:#?}", e1, e2),
                            MediaStateChanged::ChaptersOrEpisodesChanged,
                        ));
                    }
                }
            }
            (Some(MediaSpecifics::Manga(p1)), Some(MediaSpecifics::Manga(m2))) => {
                if let (Some(c1), Some(c2)) = (p1.chapters, m2.chapters) {
                    if c1 != c2 {
                        notifications.push((
                            format!("Number of chapters changed from {:#?} to {:#?}", c1, c2),
                            MediaStateChanged::ChaptersOrEpisodesChanged,
                        ));
                    }
                }
            }
            (Some(MediaSpecifics::Podcast(p1)), Some(MediaSpecifics::Podcast(p2))) => {
                if p1.episodes.len() != p2.episodes.len() {
                    notifications.push((
                        format!(
                            "Number of episodes changed from {:#?} to {:#?}",
                            p1.episodes.len(),
                            p2.episodes.len()
                        ),
                        MediaStateChanged::EpisodeReleased,
                    ));
                } else {
                    for (before_episode, after_episode) in
                        zip(p1.episodes.iter(), p2.episodes.iter())
                    {
                        if before_episode.title != after_episode.title {
                            notifications.push((
                                format!(
                                    "Episode name changed from {:#?} to {:#?} (EP{})",
                                    before_episode.title,
                                    after_episode.title,
                                    before_episode.number
                                ),
                                MediaStateChanged::EpisodeNameChanged,
                            ));
                        }
                        if before_episode.thumbnail != after_episode.thumbnail {
                            notifications.push((
                                format!("Episode image changed for EP{}", before_episode.number),
                                MediaStateChanged::EpisodeImagesChanged,
                            ));
                        }
                    }
                }
            }
            _ => {}
        }

        let notifications = notifications
            .into_iter()
            .map(|n| (format!("{} for {:?}.", n.0, meta.title), n.1))
            .collect_vec();

        let mut images = vec![];
        images.extend(url_images.into_iter().map(|i| MetadataImage {
            url: StoredUrl::Url(i.image),
            lot: i.lot,
        }));
        images.extend(s3_images.into_iter().map(|i| MetadataImage {
            url: StoredUrl::S3(i.image),
            lot: i.lot,
        }));
        let free_creators = if creators.is_empty() {
            None
        } else {
            Some(creators)
        };

        let mut meta: metadata::ActiveModel = meta.into();
        meta.last_updated_on = ActiveValue::Set(Utc::now());
        meta.title = ActiveValue::Set(title);
        meta.is_nsfw = ActiveValue::Set(is_nsfw);
        meta.is_partial = ActiveValue::Set(Some(false));
        meta.provider_rating = ActiveValue::Set(provider_rating);
        meta.description = ActiveValue::Set(description);
        meta.images = ActiveValue::Set(Some(images));
        meta.videos = ActiveValue::Set(Some(videos));
        meta.production_status = ActiveValue::Set(production_status);
        meta.original_language = ActiveValue::Set(original_language);
        meta.publish_year = ActiveValue::Set(publish_year);
        meta.publish_date = ActiveValue::Set(publish_date);
        meta.free_creators = ActiveValue::Set(free_creators);
        meta.specifics = ActiveValue::Set(specifics);
        meta.last_processed_on_for_calendar = ActiveValue::Set(None);
        let metadata = meta.update(&self.db).await.unwrap();

        self.change_metadata_associations(
            metadata.id,
            metadata.lot,
            metadata.source,
            genres,
            suggestions,
            group_identifiers,
            people,
        )
        .await?;
        Ok(notifications)
    }

    async fn deploy_associate_person_with_metadata_job(
        &self,
        metadata_id: i32,
        person: PartialMetadataPerson,
        index: usize,
    ) -> Result<()> {
        self.perform_application_job
            .clone()
            .push(ApplicationJob::AssociatePersonWithMetadata(
                metadata_id,
                person,
                index,
            ))
            .await?;
        Ok(())
    }

    async fn deploy_associate_group_with_metadata_job(
        &self,
        lot: MetadataLot,
        source: MetadataSource,
        group_identifier: String,
    ) -> Result<()> {
        self.perform_application_job
            .clone()
            .push(ApplicationJob::AssociateGroupWithMetadata(
                lot,
                source,
                group_identifier,
            ))
            .await?;
        Ok(())
    }

    pub async fn associate_group_with_metadata(
        &self,
        lot: MetadataLot,
        source: MetadataSource,
        group_identifier: String,
    ) -> Result<()> {
        let existing_group = MetadataGroup::find()
            .filter(metadata_group::Column::Identifier.eq(&group_identifier))
            .filter(metadata_group::Column::Lot.eq(lot))
            .filter(metadata_group::Column::Source.eq(source))
            .one(&self.db)
            .await?;
        let provider = self.get_media_provider(lot, source).await?;
        let (group_details, associated_items) = provider.group_details(&group_identifier).await?;
        let group_id = match existing_group {
            Some(eg) => eg.id,
            None => {
                let mut db_group: metadata_group::ActiveModel = group_details.into_model(0).into();
                db_group.id = ActiveValue::NotSet;
                let new_group = db_group.insert(&self.db).await?;
                new_group.id
            }
        };
        for (idx, media) in associated_items.into_iter().enumerate() {
            let db_partial_metadata = self.create_partial_metadata(media).await?;
            MetadataToMetadataGroup::delete_many()
                .filter(metadata_to_metadata_group::Column::MetadataGroupId.eq(group_id))
                .filter(metadata_to_metadata_group::Column::MetadataId.eq(db_partial_metadata.id))
                .exec(&self.db)
                .await
                .ok();
            let intermediate = metadata_to_metadata_group::ActiveModel {
                metadata_group_id: ActiveValue::Set(group_id),
                metadata_id: ActiveValue::Set(db_partial_metadata.id),
                part: ActiveValue::Set((idx + 1).try_into().unwrap()),
            };
            intermediate.insert(&self.db).await.ok();
        }
        Ok(())
    }

    async fn associate_suggestion_with_metadata(
        &self,
        data: PartialMetadataWithoutId,
        metadata_id: i32,
    ) -> Result<()> {
        let db_partial_metadata = self.create_partial_metadata(data).await?;
        let intermediate = metadata_to_metadata::ActiveModel {
            from_metadata_id: ActiveValue::Set(metadata_id),
            to_metadata_id: ActiveValue::Set(db_partial_metadata.id),
            relation: ActiveValue::Set(MetadataToMetadataRelation::Suggestion),
            ..Default::default()
        };
        intermediate.insert(&self.db).await.ok();
        Ok(())
    }

    async fn create_partial_metadata(
        &self,
        data: PartialMetadataWithoutId,
    ) -> Result<PartialMetadata> {
        let mode = if let Some(c) = Metadata::find()
            .filter(metadata::Column::Identifier.eq(&data.identifier))
            .filter(metadata::Column::Lot.eq(data.lot))
            .filter(metadata::Column::Source.eq(data.source))
            .one(&self.db)
            .await
            .unwrap()
        {
            c
        } else {
            let image = data.image.clone().map(|i| {
                vec![MetadataImage {
                    url: StoredUrl::Url(i),
                    lot: MetadataImageLot::Poster,
                }]
            });
            let c = metadata::ActiveModel {
                title: ActiveValue::Set(data.title),
                identifier: ActiveValue::Set(data.identifier),
                lot: ActiveValue::Set(data.lot),
                source: ActiveValue::Set(data.source),
                images: ActiveValue::Set(image),
                is_partial: ActiveValue::Set(Some(true)),
                ..Default::default()
            };
            c.insert(&self.db).await?
        };
        let model = PartialMetadata {
            id: mode.id,
            title: mode.title,
            identifier: mode.identifier,
            lot: mode.lot,
            source: mode.source,
            image: data.image,
        };
        Ok(model)
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

    async fn edit_seen_item(&self, input: EditSeenItemInput, user_id: i32) -> Result<bool> {
        let seen = match Seen::find_by_id(input.seen_id).one(&self.db).await.unwrap() {
            Some(s) => s,
            None => return Err(Error::new("No seen found for this user and metadata")),
        };
        if seen.user_id != user_id {
            return Err(Error::new("No seen found for this user and metadata"));
        }
        let mut seen: seen::ActiveModel = seen.into();
        if let Some(started_on) = input.started_on {
            seen.started_on = ActiveValue::Set(Some(started_on));
        }
        if let Some(finished_on) = input.finished_on {
            seen.finished_on = ActiveValue::Set(Some(finished_on));
        }
        seen.last_updated_on = ActiveValue::Set(Utc::now());
        let seen = seen.update(&self.db).await.unwrap();
        self.after_media_seen_tasks(seen).await?;
        Ok(true)
    }

    pub async fn commit_media_internal(&self, details: MediaDetails) -> Result<IdObject> {
        let mut images = vec![];
        images.extend(details.url_images.into_iter().map(|i| MetadataImage {
            url: StoredUrl::Url(i.image),
            lot: i.lot,
        }));
        images.extend(details.s3_images.into_iter().map(|i| MetadataImage {
            url: StoredUrl::S3(i.image),
            lot: i.lot,
        }));
        let metadata = metadata::ActiveModel {
            lot: ActiveValue::Set(details.lot),
            source: ActiveValue::Set(details.source),
            title: ActiveValue::Set(details.title),
            description: ActiveValue::Set(details.description),
            publish_year: ActiveValue::Set(details.publish_year),
            publish_date: ActiveValue::Set(details.publish_date),
            images: ActiveValue::Set(Some(images)),
            videos: ActiveValue::Set(Some(details.videos)),
            identifier: ActiveValue::Set(details.identifier),
            specifics: ActiveValue::Set(Some(details.specifics)),
            provider_rating: ActiveValue::Set(details.provider_rating),
            production_status: ActiveValue::Set(details.production_status),
            original_language: ActiveValue::Set(details.original_language),
            is_nsfw: ActiveValue::Set(details.is_nsfw),
            free_creators: ActiveValue::Set(if details.creators.is_empty() {
                None
            } else {
                Some(details.creators)
            }),
            ..Default::default()
        };
        let metadata = metadata.insert(&self.db).await?;

        self.change_metadata_associations(
            metadata.id,
            metadata.lot,
            metadata.source,
            details.genres,
            details.suggestions,
            details.group_identifiers,
            details.people,
        )
        .await?;
        Ok(IdObject { id: metadata.id })
    }

    #[allow(clippy::too_many_arguments)]
    async fn change_metadata_associations(
        &self,
        metadata_id: i32,
        lot: MetadataLot,
        source: MetadataSource,
        genres: Vec<String>,
        suggestions: Vec<PartialMetadataWithoutId>,
        groups: Vec<String>,
        people: Vec<PartialMetadataPerson>,
    ) -> Result<()> {
        MetadataToPerson::delete_many()
            .filter(metadata_to_person::Column::MetadataId.eq(metadata_id))
            .exec(&self.db)
            .await?;
        MetadataToGenre::delete_many()
            .filter(metadata_to_genre::Column::MetadataId.eq(metadata_id))
            .exec(&self.db)
            .await?;
        // suggestions
        MetadataToMetadata::delete_many()
            .filter(metadata_to_metadata::Column::FromMetadataId.eq(metadata_id))
            .exec(&self.db)
            .await?;
        for (index, creator) in people.into_iter().enumerate() {
            self.deploy_associate_person_with_metadata_job(metadata_id, creator, index)
                .await
                .ok();
        }
        for genre in genres {
            self.associate_genre_with_metadata(genre, metadata_id)
                .await
                .ok();
        }
        for suggestion in suggestions {
            self.associate_suggestion_with_metadata(suggestion, metadata_id)
                .await
                .ok();
        }
        for group_identifier in groups {
            self.deploy_associate_group_with_metadata_job(lot, source, group_identifier)
                .await
                .ok();
        }
        Ok(())
    }

    pub async fn deploy_update_metadata_job(&self, metadata_id: i32) -> Result<String> {
        let metadata = Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let job_id = self
            .perform_application_job
            .clone()
            .push(ApplicationJob::UpdateMetadata(metadata))
            .await?;
        Ok(job_id.to_string())
    }

    pub async fn merge_metadata(
        &self,
        merge_from: i32,
        merge_into: i32,
        user_id: i32,
    ) -> Result<bool> {
        for old_seen in Seen::find()
            .filter(seen::Column::MetadataId.eq(merge_from))
            .filter(seen::Column::UserId.eq(user_id))
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
            .filter(review::Column::UserId.eq(user_id))
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
        let collections = Collection::find()
            .filter(collection::Column::UserId.eq(user_id))
            .all(&self.db)
            .await
            .unwrap()
            .iter()
            .map(|c| c.id)
            .collect_vec();
        CollectionToEntity::update_many()
            .filter(collection_to_entity::Column::MetadataId.eq(merge_from))
            .filter(collection_to_entity::Column::CollectionId.is_in(collections))
            .set(collection_to_entity::ActiveModel {
                metadata_id: ActiveValue::Set(Some(merge_into)),
                ..Default::default()
            })
            .exec(&self.db)
            .await?;
        if let Some(association) =
            get_user_and_metadata_association(&user_id, &merge_into, &self.db).await
        {
            let old_association =
                get_user_and_metadata_association(&user_id, &merge_from, &self.db)
                    .await
                    .unwrap();
            let mut cloned: user_to_entity::ActiveModel = old_association.clone().into();
            if old_association.metadata_monitored.is_none() {
                cloned.metadata_monitored = ActiveValue::Set(association.metadata_monitored);
            }
            if old_association.metadata_reminder.is_none() {
                cloned.metadata_reminder = ActiveValue::Set(association.metadata_reminder);
            }
            if old_association.metadata_ownership.is_none() {
                cloned.metadata_ownership = ActiveValue::Set(association.metadata_ownership);
            }
            cloned.update(&self.db).await?;
        } else {
            UserToEntity::update_many()
                .filter(user_to_entity::Column::MetadataId.eq(merge_from))
                .filter(user_to_entity::Column::UserId.eq(user_id))
                .set(user_to_entity::ActiveModel {
                    metadata_id: ActiveValue::Set(Some(merge_into)),
                    ..Default::default()
                })
                .exec(&self.db)
                .await?;
        }
        Ok(true)
    }

    async fn user_preferences(&self, user_id: i32) -> Result<UserPreferences> {
        let mut preferences = partial_user_by_id::<UserWithOnlyPreferences>(&self.db, user_id)
            .await?
            .preferences;
        preferences.features_enabled.media.anime =
            self.config.anime_and_manga.is_enabled() && preferences.features_enabled.media.anime;
        preferences.features_enabled.media.audio_book =
            self.config.audio_books.is_enabled() && preferences.features_enabled.media.audio_book;
        preferences.features_enabled.media.book =
            self.config.books.is_enabled() && preferences.features_enabled.media.book;
        preferences.features_enabled.media.show =
            self.config.movies_and_shows.is_enabled() && preferences.features_enabled.media.show;
        preferences.features_enabled.media.manga =
            self.config.anime_and_manga.is_enabled() && preferences.features_enabled.media.manga;
        preferences.features_enabled.media.movie =
            self.config.movies_and_shows.is_enabled() && preferences.features_enabled.media.movie;
        preferences.features_enabled.media.podcast =
            self.config.podcasts.is_enabled() && preferences.features_enabled.media.podcast;
        preferences.features_enabled.media.video_game =
            self.config.video_games.is_enabled() && preferences.features_enabled.media.video_game;
        Ok(preferences)
    }

    async fn core_enabled_features(&self) -> Result<GeneralFeatures> {
        let mut files_enabled = self.config.file_storage.is_enabled();
        if files_enabled && !self.file_storage_service.is_enabled().await {
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
        user_id: i32,
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
            let preferences = partial_user_by_id::<UserWithOnlyPreferences>(&self.db, user_id)
                .await?
                .preferences;
            let provider = self.get_media_provider(lot, source).await?;
            let results = provider
                .search(&q, input.page, preferences.general.display_nsfw)
                .await?;
            let all_identifiers = results
                .items
                .iter()
                .map(|i| i.identifier.to_owned())
                .collect_vec();
            let interactions = Metadata::find()
                .join(
                    JoinType::LeftJoin,
                    metadata::Relation::UserToEntity
                        .def()
                        .on_condition(move |_left, right| {
                            Condition::all()
                                .add(Expr::col((right, user_to_entity::Column::UserId)).eq(user_id))
                        }),
                )
                .select_only()
                .column(metadata::Column::Identifier)
                .column_as(
                    Expr::col((Alias::new("metadata"), metadata::Column::Id)),
                    "database_id",
                )
                .column_as(
                    Expr::col((Alias::new("user_to_entity"), user_to_entity::Column::Id))
                        .is_not_null(),
                    "has_interacted",
                )
                .filter(metadata::Column::Lot.eq(lot))
                .filter(metadata::Column::Source.eq(source))
                .filter(metadata::Column::Identifier.is_in(&all_identifiers))
                .into_tuple::<(String, i32, bool)>()
                .all(&self.db)
                .await?
                .into_iter()
                .map(|(key, value1, value2)| (key, (value1, value2)));
            let interactions = HashMap::<_, _>::from_iter(interactions.into_iter());
            let data = results
                .items
                .into_iter()
                .map(|i| {
                    let interaction = interactions.get(&i.identifier).cloned();
                    MediaSearchItemResponse {
                        has_interacted: interaction.unwrap_or_default().1,
                        database_id: interaction.map(|i| i.0),
                        item: i,
                    }
                })
                .collect();
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

    pub async fn get_openlibrary_service(&self) -> Result<OpenlibraryService> {
        Ok(OpenlibraryService::new(
            &self.config.books.openlibrary,
            self.config.frontend.page_size,
        )
        .await)
    }

    pub async fn get_isbn_service(&self) -> Result<GoogleBooksService> {
        Ok(GoogleBooksService::new(
            &self.config.books.google_books,
            self.config.frontend.page_size,
        )
        .await)
    }

    async fn get_media_provider(
        &self,
        lot: MetadataLot,
        source: MetadataSource,
    ) -> Result<Provider> {
        let err = || Err(Error::new("This source is not supported".to_owned()));
        let service: Provider = match source {
            MetadataSource::Vndb => Box::new(
                VndbService::new(&self.config.visual_novels, self.config.frontend.page_size).await,
            ),
            MetadataSource::Openlibrary => Box::new(self.get_openlibrary_service().await?),
            MetadataSource::Itunes => Box::new(
                ITunesService::new(&self.config.podcasts.itunes, self.config.frontend.page_size)
                    .await,
            ),
            MetadataSource::GoogleBooks => Box::new(self.get_isbn_service().await?),
            MetadataSource::Audible => Box::new(
                AudibleService::new(
                    &self.config.audio_books.audible,
                    self.config.frontend.page_size,
                )
                .await,
            ),
            MetadataSource::Listennotes => Box::new(
                ListennotesService::new(&self.config.podcasts, self.config.frontend.page_size)
                    .await,
            ),
            MetadataSource::Tmdb => match lot {
                MetadataLot::Show => Box::new(
                    TmdbShowService::new(
                        &self.config.movies_and_shows.tmdb,
                        self.config.frontend.page_size,
                    )
                    .await,
                ),
                MetadataLot::Movie => Box::new(
                    TmdbMovieService::new(
                        &self.config.movies_and_shows.tmdb,
                        self.config.frontend.page_size,
                    )
                    .await,
                ),
                _ => return err(),
            },
            MetadataSource::Anilist => match lot {
                MetadataLot::Anime => Box::new(
                    AnilistAnimeService::new(
                        &self.config.anime_and_manga.anilist,
                        self.config.frontend.page_size,
                    )
                    .await,
                ),
                MetadataLot::Manga => Box::new(
                    AnilistMangaService::new(
                        &self.config.anime_and_manga.anilist,
                        self.config.frontend.page_size,
                    )
                    .await,
                ),
                _ => return err(),
            },
            MetadataSource::Mal => match lot {
                MetadataLot::Anime => Box::new(
                    MalAnimeService::new(
                        &self.config.anime_and_manga.mal,
                        self.config.frontend.page_size,
                    )
                    .await,
                ),
                MetadataLot::Manga => Box::new(
                    MalMangaService::new(
                        &self.config.anime_and_manga.mal,
                        self.config.frontend.page_size,
                    )
                    .await,
                ),
                _ => return err(),
            },
            MetadataSource::Igdb => Box::new(
                IgdbService::new(&self.config.video_games, self.config.frontend.page_size).await,
            ),
            MetadataSource::MangaUpdates => Box::new(
                MangaUpdatesService::new(
                    &self.config.anime_and_manga.manga_updates,
                    self.config.frontend.page_size,
                )
                .await,
            ),
            MetadataSource::Custom => return err(),
        };
        Ok(service)
    }

    async fn get_non_media_provider(&self, source: MetadataSource) -> Result<Provider> {
        let err = || Err(Error::new("This source is not supported".to_owned()));
        let service: Provider = match source {
            MetadataSource::Vndb => Box::new(
                VndbService::new(&self.config.visual_novels, self.config.frontend.page_size).await,
            ),
            MetadataSource::Openlibrary => Box::new(self.get_openlibrary_service().await?),
            MetadataSource::Itunes => Box::new(
                ITunesService::new(&self.config.podcasts.itunes, self.config.frontend.page_size)
                    .await,
            ),
            MetadataSource::GoogleBooks => Box::new(
                GoogleBooksService::new(
                    &self.config.books.google_books,
                    self.config.frontend.page_size,
                )
                .await,
            ),
            MetadataSource::Audible => Box::new(
                AudibleService::new(
                    &self.config.audio_books.audible,
                    self.config.frontend.page_size,
                )
                .await,
            ),
            MetadataSource::Listennotes => Box::new(
                ListennotesService::new(&self.config.podcasts, self.config.frontend.page_size)
                    .await,
            ),
            MetadataSource::Igdb => Box::new(
                IgdbService::new(&self.config.video_games, self.config.frontend.page_size).await,
            ),
            MetadataSource::MangaUpdates => Box::new(
                MangaUpdatesService::new(
                    &self.config.anime_and_manga.manga_updates,
                    self.config.frontend.page_size,
                )
                .await,
            ),
            MetadataSource::Tmdb => Box::new(
                NonMediaTmdbService::new(
                    self.config.movies_and_shows.tmdb.access_token.clone(),
                    self.config.movies_and_shows.tmdb.locale.clone(),
                )
                .await,
            ),
            MetadataSource::Anilist => Box::new(NonMediaAnilistService::new().await),
            MetadataSource::Mal => Box::new(NonMediaMalService::new().await),
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
        let provider = self.get_media_provider(lot, source).await?;
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

    async fn review_by_id(
        &self,
        review_id: i32,
        user_id: i32,
        respect_preferences: bool,
    ) -> Result<ReviewItem> {
        let review = Review::find_by_id(review_id).one(&self.db).await?;
        match review {
            Some(r) => {
                let user = r.find_related(User).one(&self.db).await.unwrap().unwrap();
                let (show_se, show_ep, podcast_ep) = match r.extra_information {
                    Some(s) => match s {
                        SeenOrReviewOrCalendarEventExtraInformation::Show(d) => {
                            (Some(d.season), Some(d.episode), None)
                        }
                        SeenOrReviewOrCalendarEventExtraInformation::Podcast(d) => {
                            (None, None, Some(d.episode))
                        }
                        SeenOrReviewOrCalendarEventExtraInformation::Other(_) => (None, None, None),
                    },
                    None => (None, None, None),
                };
                let rating = match respect_preferences {
                    true => {
                        let prefs =
                            partial_user_by_id::<UserWithOnlyPreferences>(&self.db, user_id)
                                .await?
                                .preferences;
                        r.rating.map(|s| {
                            s.checked_div(match prefs.general.review_scale {
                                UserReviewScale::OutOfFive => dec!(20),
                                UserReviewScale::OutOfHundred => dec!(1),
                            })
                            .unwrap()
                            .round_dp(1)
                        })
                    }
                    false => r.rating,
                };
                Ok(ReviewItem {
                    id: r.id,
                    posted_on: r.posted_on,
                    rating,
                    spoiler: r.spoiler,
                    text: r.text,
                    visibility: r.visibility,
                    show_season: show_se,
                    show_episode: show_ep,
                    podcast_episode: podcast_ep,
                    posted_by: IdAndNamedObject {
                        id: user.id,
                        name: user.name,
                    },
                    comments: r.comments,
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
        metadata_group_id: Option<i32>,
        collection_id: Option<i32>,
    ) -> Result<Vec<ReviewItem>> {
        let all_reviews = Review::find()
            .select_only()
            .column(review::Column::Id)
            .order_by_desc(review::Column::PostedOn)
            .apply_if(metadata_id, |query, v| {
                query.filter(review::Column::MetadataId.eq(v))
            })
            .apply_if(metadata_group_id, |query, v| {
                query.filter(review::Column::MetadataGroupId.eq(v))
            })
            .apply_if(creator_id, |query, v| {
                query.filter(review::Column::PersonId.eq(v))
            })
            .apply_if(collection_id, |query, v| {
                query.filter(review::Column::CollectionId.eq(v))
            })
            .into_tuple::<i32>()
            .all(&self.db)
            .await
            .unwrap();
        let mut reviews = vec![];
        for r_id in all_reviews {
            reviews.push(self.review_by_id(r_id, user_id, true).await?);
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

    async fn user_collections_list(
        &self,
        user_id: i32,
        name: Option<String>,
    ) -> Result<Vec<CollectionItem>> {
        let collections = Collection::find()
            .filter(collection::Column::UserId.eq(user_id))
            .apply_if(name, |query, v| {
                query.filter(collection::Column::Name.eq(v))
            })
            .order_by_desc(collection::Column::LastUpdatedOn)
            .all(&self.db)
            .await
            .unwrap();
        let mut data = vec![];
        for collection in collections.into_iter() {
            let num_items = collection
                .find_related(CollectionToEntity)
                .count(&self.db)
                .await?;
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

    async fn public_collections_list(
        &self,
        input: SearchInput,
    ) -> Result<SearchResults<PublicCollectionItem>> {
        let page: u64 = input.page.unwrap_or(1).try_into().unwrap();
        let c_alias = Alias::new("collection");
        let u_alias = Alias::new("user");
        let paginator = Collection::find()
            .select_only()
            .column_as(Expr::col((c_alias.clone(), collection::Column::Id)), "id")
            .column_as(Expr::col((u_alias, user::Column::Name)), "username")
            .column(collection::Column::Name)
            .filter(collection::Column::Visibility.eq(Visibility::Public))
            .apply_if(input.query, |query, v| {
                query.filter(
                    Condition::any()
                        .add(get_ilike_query(
                            Expr::col((c_alias.clone(), collection::Column::Name)),
                            &v,
                        ))
                        .add(get_ilike_query(
                            Expr::col((c_alias.clone(), collection::Column::Description)),
                            &v,
                        )),
                )
            })
            .left_join(User)
            .order_by_desc(collection::Column::LastUpdatedOn)
            .into_model::<PublicCollectionItem>()
            .paginate(&self.db, self.config.frontend.page_size.try_into().unwrap());
        let mut data = vec![];
        let ItemsAndPagesNumber {
            number_of_items,
            number_of_pages,
        } = paginator.num_items_and_pages().await?;
        for collection in paginator.fetch_page(page - 1).await? {
            data.push(collection);
        }
        let results = SearchResults {
            details: SearchDetails {
                total: number_of_items.try_into().unwrap(),
                next_page: if page < number_of_pages {
                    Some((page + 1).try_into().unwrap())
                } else {
                    None
                },
            },
            items: data,
        };
        Ok(results)
    }

    async fn collection_contents(
        &self,
        user_id: Option<i32>,
        input: CollectionContentsInput,
    ) -> Result<CollectionContents> {
        let search = input.search.unwrap_or_default();
        let sort = input.sort.unwrap_or_default();
        let filter = input.filter.unwrap_or_default();
        let page: u64 = search.page.unwrap_or(1).try_into().unwrap();
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

        let take = input
            .take
            .unwrap_or_else(|| self.config.frontend.page_size.try_into().unwrap());
        let results = if take != 0 {
            let paginator = CollectionToEntity::find()
                .left_join(Metadata)
                .left_join(MetadataGroup)
                .left_join(Person)
                .left_join(Exercise)
                .filter(collection_to_entity::Column::CollectionId.eq(collection.id))
                .apply_if(search.query, |query, v| {
                    query.filter(
                        Condition::any()
                            .add(get_ilike_query(
                                Expr::col((AliasedMetadata::Table, metadata::Column::Title)),
                                &v,
                            ))
                            .add(get_ilike_query(
                                Expr::col((
                                    AliasedMetadataGroup::Table,
                                    metadata_group::Column::Title,
                                )),
                                &v,
                            ))
                            .add(get_ilike_query(
                                Expr::col((AliasedPerson::Table, person::Column::Name)),
                                &v,
                            ))
                            .add(get_ilike_query(
                                Expr::col((AliasedExercise::Table, exercise::Column::Id)),
                                &v,
                            )),
                    )
                })
                .apply_if(filter.metadata_lot, |query, v| {
                    query.filter(
                        Condition::any()
                            .add(Expr::col((AliasedMetadata::Table, metadata::Column::Lot)).eq(v)),
                    )
                })
                .apply_if(filter.entity_type, |query, v| {
                    let f = match v {
                        EntityLot::Media => collection_to_entity::Column::MetadataId.is_not_null(),
                        EntityLot::MediaGroup => {
                            collection_to_entity::Column::MetadataGroupId.is_not_null()
                        }
                        EntityLot::Person => collection_to_entity::Column::PersonId.is_not_null(),
                        EntityLot::Exercise => {
                            collection_to_entity::Column::ExerciseId.is_not_null()
                        }
                        EntityLot::Collection => unreachable!(),
                    };
                    query.filter(f)
                })
                .order_by(
                    match sort.by {
                        CollectionContentsSortBy::LastUpdatedOn => {
                            Expr::col(collection_to_entity::Column::LastUpdatedOn)
                        }
                        CollectionContentsSortBy::Title => Expr::expr(Func::coalesce([
                            Expr::col((AliasedMetadata::Table, metadata::Column::Title)).into(),
                            Expr::col((AliasedMetadataGroup::Table, metadata_group::Column::Title))
                                .into(),
                            Expr::col((AliasedPerson::Table, person::Column::Name)).into(),
                            Expr::col((AliasedExercise::Table, exercise::Column::Id)).into(),
                        ])),
                        CollectionContentsSortBy::Date => Expr::expr(Func::coalesce([
                            Expr::col((AliasedMetadata::Table, metadata::Column::PublishDate))
                                .into(),
                            Expr::col((AliasedPerson::Table, person::Column::BirthDate)).into(),
                        ])),
                    },
                    sort.order.into(),
                )
                .paginate(&self.db, take);
            let mut items = vec![];
            let ItemsAndPagesNumber {
                number_of_items,
                number_of_pages,
            } = paginator.num_items_and_pages().await?;
            for cte in paginator.fetch_page(page - 1).await? {
                let item = if let Some(id) = cte.metadata_id {
                    let m = Metadata::find_by_id(id).one(&self.db).await?.unwrap();
                    MediaSearchItemWithLot {
                        details: MediaSearchItem {
                            identifier: m.id.to_string(),
                            title: m.title,
                            image: m.images.first_as_url(&self.file_storage_service).await,
                            publish_year: m.publish_year,
                        },
                        metadata_lot: Some(m.lot),
                        entity_lot: EntityLot::Media,
                    }
                } else if let Some(id) = cte.person_id {
                    let p = Person::find_by_id(id).one(&self.db).await?.unwrap();
                    MediaSearchItemWithLot {
                        details: MediaSearchItem {
                            identifier: p.id.to_string(),
                            title: p.name,
                            image: p.images.first_as_url(&self.file_storage_service).await,
                            publish_year: p.birth_date.map(|d| d.year()),
                        },
                        metadata_lot: None,
                        entity_lot: EntityLot::Person,
                    }
                } else if let Some(id) = cte.metadata_group_id {
                    let g = MetadataGroup::find_by_id(id).one(&self.db).await?.unwrap();
                    MediaSearchItemWithLot {
                        details: MediaSearchItem {
                            identifier: g.id.to_string(),
                            title: g.title,
                            image: Some(g.images)
                                .first_as_url(&self.file_storage_service)
                                .await,
                            publish_year: None,
                        },
                        metadata_lot: None,
                        entity_lot: EntityLot::MediaGroup,
                    }
                } else if let Some(id) = cte.exercise_id {
                    let e = Exercise::find_by_id(id).one(&self.db).await?.unwrap();
                    let image = if let Some(i) = e.attributes.internal_images.first().cloned() {
                        Some(get_stored_asset(i, &self.file_storage_service).await)
                    } else {
                        None
                    };
                    MediaSearchItemWithLot {
                        details: MediaSearchItem {
                            identifier: e.id.to_string(),
                            title: e.id,
                            image,
                            publish_year: None,
                        },
                        metadata_lot: None,
                        entity_lot: EntityLot::Exercise,
                    }
                } else {
                    unreachable!()
                };
                items.push(item);
            }
            SearchResults {
                details: SearchDetails {
                    total: number_of_items.try_into().unwrap(),
                    next_page: if page < number_of_pages {
                        Some((page + 1).try_into().unwrap())
                    } else {
                        None
                    },
                },
                items,
            }
        } else {
            SearchResults {
                details: SearchDetails::default(),
                items: vec![],
            }
        };
        let user = collection.find_related(User).one(&self.db).await?.unwrap();
        let reviews = self
            .item_reviews(
                collection.user_id,
                None,
                None,
                None,
                Some(input.collection_id),
            )
            .await?;
        Ok(CollectionContents {
            details: collection,
            reviews,
            results,
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
        let extra_information = if let (Some(season), Some(episode)) =
            (input.show_season_number, input.show_episode_number)
        {
            Some(SeenOrReviewOrCalendarEventExtraInformation::Show(
                SeenShowExtraInformation { season, episode },
            ))
        } else {
            input.podcast_episode_number.map(|episode| {
                SeenOrReviewOrCalendarEventExtraInformation::Podcast(SeenPodcastExtraInformation {
                    episode,
                })
            })
        };
        if input.rating.is_none() && input.text.is_none() {
            return Err(Error::new("At-least one of rating or review is required."));
        }
        let preferences = partial_user_by_id::<UserWithOnlyPreferences>(&self.db, user_id)
            .await?
            .preferences;
        let mut review_obj = review::ActiveModel {
            id: review_id,
            rating: ActiveValue::Set(input.rating.map(
                |r| match preferences.general.review_scale {
                    UserReviewScale::OutOfFive => r * dec!(20),
                    UserReviewScale::OutOfHundred => r,
                },
            )),
            text: ActiveValue::Set(input.text),
            user_id: ActiveValue::Set(user_id.to_owned()),
            metadata_id: ActiveValue::Set(input.metadata_id),
            metadata_group_id: ActiveValue::Set(input.metadata_group_id),
            person_id: ActiveValue::Set(input.person_id),
            collection_id: ActiveValue::Set(input.collection_id),
            extra_information: ActiveValue::Set(extra_information),
            comments: ActiveValue::Set(vec![]),
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
        if insert.visibility.unwrap() == Visibility::Public {
            let (obj_id, obj_title, entity_lot) = if let Some(mi) = insert.metadata_id.unwrap() {
                (
                    mi,
                    self.generic_metadata(mi).await?.model.title,
                    EntityLot::Media,
                )
            } else if let Some(mgi) = insert.metadata_group_id.unwrap() {
                (
                    mgi,
                    self.metadata_group_details(mgi).await?.details.title,
                    EntityLot::MediaGroup,
                )
            } else if let Some(pi) = insert.person_id.unwrap() {
                (
                    pi,
                    self.person_details(pi).await?.details.name,
                    EntityLot::Person,
                )
            } else if let Some(ci) = insert.collection_id.unwrap() {
                (
                    ci,
                    self.collection_contents(
                        Some(user_id),
                        CollectionContentsInput {
                            collection_id: ci,
                            filter: None,
                            search: None,
                            take: None,
                            sort: None,
                        },
                    )
                    .await?
                    .details
                    .name,
                    EntityLot::Collection,
                )
            } else {
                unreachable!()
            };
            let user = user_by_id(&self.db, insert.user_id.unwrap()).await?;
            self.perform_application_job
                .clone()
                .push(ApplicationJob::ReviewPosted(ReviewPostedEvent {
                    obj_id,
                    obj_title,
                    entity_lot,
                    username: user.name,
                    review_id: insert.id.clone().unwrap(),
                }))
                .await?;
        }
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
                    last_updated_on: ActiveValue::Set(Utc::now()),
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

    pub async fn add_entity_to_collection(
        &self,
        user_id: i32,
        input: ChangeCollectionToEntityInput,
    ) -> Result<bool> {
        add_entity_to_collection(&self.db, user_id, input).await
    }

    pub async fn remove_entity_from_collection(
        &self,
        user_id: i32,
        input: ChangeCollectionToEntityInput,
    ) -> Result<IdObject> {
        let collect = Collection::find()
            .filter(collection::Column::Name.eq(input.collection_name.to_owned()))
            .filter(collection::Column::UserId.eq(user_id.to_owned()))
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let target_column = match input.entity_lot {
            EntityLot::Media => collection_to_entity::Column::MetadataId,
            EntityLot::Person => collection_to_entity::Column::PersonId,
            EntityLot::MediaGroup => collection_to_entity::Column::MetadataGroupId,
            EntityLot::Exercise => collection_to_entity::Column::ExerciseId,
            EntityLot::Collection => unreachable!(),
        };
        CollectionToEntity::delete_many()
            .filter(collection_to_entity::Column::CollectionId.eq(collect.id))
            .filter(
                target_column.eq(match input.entity_id.clone().parse::<i32>() {
                    Ok(id) => Value::Int(Some(id)),
                    Err(_) => Value::String(Some(Box::new(input.entity_id.clone()))),
                }),
            )
            .exec(&self.db)
            .await?;
        Ok(IdObject { id: collect.id })
    }

    pub async fn delete_seen_item(&self, seen_id: i32, user_id: i32) -> Result<IdObject> {
        let seen_item = Seen::find_by_id(seen_id).one(&self.db).await.unwrap();
        if let Some(si) = seen_item {
            let (ssn, sen, pen) = match &si.extra_information {
                None => (None, None, None),
                Some(ei) => match ei {
                    SeenOrReviewOrCalendarEventExtraInformation::Show(s) => {
                        (Some(s.season), Some(s.episode), None)
                    }
                    SeenOrReviewOrCalendarEventExtraInformation::Podcast(p) => {
                        (None, None, Some(p.episode))
                    }
                    SeenOrReviewOrCalendarEventExtraInformation::Other(_) => (None, None, None),
                },
            };
            let cache = ProgressUpdateCache {
                user_id,
                metadata_id: si.metadata_id,
                show_season_number: ssn,
                show_episode_number: sen,
                podcast_episode_number: pen,
            };
            self.seen_progress_cache.remove(&cache).await;
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
                self.remove_entity_from_collection(
                    user_id,
                    ChangeCollectionToEntityInput {
                        collection_name: DefaultCollection::InProgress.to_string(),
                        entity_id: metadata_id.to_string(),
                        entity_lot: EntityLot::Media,
                    },
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
        Metadata::update_many()
            .filter(metadata::Column::Id.eq(metadata_id))
            .col_expr(metadata::Column::IsPartial, Expr::value(false))
            .exec(&self.db)
            .await?;
        let maybe_details = self
            .details_from_provider_for_existing_media(metadata_id)
            .await;
        let notifications = match maybe_details {
            Ok(details) => {
                self.update_media(
                    metadata_id,
                    details.title,
                    details.is_nsfw,
                    details.description,
                    details.provider_rating,
                    details.url_images,
                    details.s3_images,
                    details.videos,
                    Some(details.specifics),
                    details.creators,
                    details.people,
                    details.genres,
                    details.production_status,
                    details.original_language,
                    details.publish_year,
                    details.publish_date,
                    details.suggestions,
                    details.group_identifiers,
                )
                .await?
            }
            Err(e) => {
                tracing::error!("Error while updating metadata = {:?}: {:?}", metadata_id, e);
                vec![]
            }
        };
        tracing::trace!("Updated metadata for {:?}", metadata_id);
        Ok(notifications)
    }

    async fn user_details(&self, token: &str) -> Result<UserDetailsResult> {
        let found_token = user_id_from_token(token, &self.config.users.jwt_secret);
        if let Ok(user_id) = found_token {
            let user = user_by_id(&self.db, user_id).await?;
            Ok(UserDetailsResult::Ok(Box::new(user)))
        } else {
            Ok(UserDetailsResult::Error(UserDetailsError {
                error: UserDetailsErrorVariant::AuthTokenInvalid,
            }))
        }
    }

    async fn latest_user_summary(&self, user_id: i32) -> Result<UserSummary> {
        let ls = partial_user_by_id::<UserWithOnlySummary>(&self.db, user_id).await?;
        Ok(ls.summary.unwrap_or_default())
    }

    pub async fn calculate_user_summary(
        &self,
        user_id: i32,
        calculate_from_beginning: bool,
    ) -> Result<IdObject> {
        let (mut ls, start_from) = match calculate_from_beginning {
            true => (UserSummary::default(), None),
            false => {
                let here = self.latest_user_summary(user_id).await?;
                let time = here.calculated_on;
                (here, Some(time))
            }
        };

        let num_reviews = Review::find()
            .filter(review::Column::UserId.eq(user_id.to_owned()))
            .count(&self.db)
            .await?;

        let num_measurements = UserMeasurement::find()
            .filter(user_measurement::Column::UserId.eq(user_id.to_owned()))
            .count(&self.db)
            .await?;

        let num_workouts = Workout::find()
            .filter(workout::Column::UserId.eq(user_id.to_owned()))
            .count(&self.db)
            .await?;

        let num_media_interacted_with = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id.to_owned()))
            .filter(user_to_entity::Column::MetadataId.is_not_null())
            .count(&self.db)
            .await?;

        let num_exercises_interacted_with = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id.to_owned()))
            .filter(user_to_entity::Column::ExerciseId.is_not_null())
            .count(&self.db)
            .await?;

        let (total_workout_time, total_workout_weight) = Workout::find()
            .filter(workout::Column::UserId.eq(user_id.to_owned()))
            .select_only()
            .column_as(
                Expr::cust("coalesce(extract(epoch from sum(end_time - start_time)) / 60, 0)"),
                "minutes",
            )
            .column_as(
                Expr::cust("coalesce(sum((summary -> 'total' ->> 'weight')::numeric), 0)"),
                "weight",
            )
            .into_tuple::<(Decimal, Decimal)>()
            .one(&self.db)
            .await?
            .unwrap();

        ls.media.reviews_posted = num_reviews;
        ls.media.media_interacted_with = num_media_interacted_with;
        ls.fitness.measurements_recorded = num_measurements;
        ls.fitness.exercises_interacted_with = num_exercises_interacted_with;
        ls.fitness.workouts.recorded = num_workouts;
        ls.fitness.workouts.weight = total_workout_weight;
        ls.fitness.workouts.duration = total_workout_time.to_u64().unwrap();

        let mut seen_items = Seen::find()
            .filter(seen::Column::UserId.eq(user_id.to_owned()))
            .filter(seen::Column::UserId.eq(user_id.to_owned()))
            .filter(seen::Column::Progress.eq(100))
            .apply_if(start_from, |query, v| {
                query.filter(seen::Column::LastUpdatedOn.gt(v))
            })
            .find_also_related(Metadata)
            .stream(&self.db)
            .await?;

        while let Some((seen, metadata)) = seen_items.try_next().await.unwrap() {
            let meta = metadata.to_owned().unwrap();
            meta.find_related(MetadataToPerson)
                .all(&self.db)
                .await?
                .into_iter()
                .for_each(|c| {
                    ls.unique_items.creators.insert(c.person_id);
                });
            if let Some(specs) = meta.specifics {
                match specs {
                    MediaSpecifics::AudioBook(item) => {
                        ls.unique_items.audio_books.insert(meta.id);
                        if let Some(r) = item.runtime {
                            ls.media.audio_books.runtime += r;
                        }
                    }
                    MediaSpecifics::Anime(item) => {
                        ls.unique_items.anime.insert(meta.id);
                        if let Some(r) = item.episodes {
                            ls.media.anime.episodes += r;
                        }
                    }
                    MediaSpecifics::Manga(item) => {
                        ls.unique_items.manga.insert(meta.id);
                        if let Some(r) = item.chapters {
                            ls.media.manga.chapters += r;
                        }
                    }
                    MediaSpecifics::Book(item) => {
                        ls.unique_items.books.insert(meta.id);
                        if let Some(pg) = item.pages {
                            ls.media.books.pages += pg;
                        }
                    }

                    MediaSpecifics::Movie(item) => {
                        ls.unique_items.movies.insert(meta.id);
                        if let Some(r) = item.runtime {
                            ls.media.movies.runtime += r;
                        }
                    }
                    MediaSpecifics::Show(item) => {
                        ls.unique_items.shows.insert(seen.metadata_id);
                        match seen.extra_information.to_owned().unwrap() {
                            SeenOrReviewOrCalendarEventExtraInformation::Other(_) => {
                                unreachable!()
                            }
                            SeenOrReviewOrCalendarEventExtraInformation::Podcast(_) => {
                                unreachable!()
                            }
                            SeenOrReviewOrCalendarEventExtraInformation::Show(s) => {
                                if let Some((season, episode)) =
                                    item.get_episode(s.season, s.episode)
                                {
                                    if let Some(r) = episode.runtime {
                                        ls.media.shows.runtime += r;
                                    }
                                    ls.unique_items.show_episodes.insert((
                                        meta.id,
                                        season.season_number,
                                        episode.episode_number,
                                    ));
                                    ls.unique_items
                                        .show_seasons
                                        .insert((meta.id, season.season_number));
                                }
                            }
                        };
                    }
                    MediaSpecifics::Podcast(item) => {
                        ls.unique_items.podcasts.insert(seen.metadata_id);
                        match seen.extra_information.to_owned().unwrap() {
                            SeenOrReviewOrCalendarEventExtraInformation::Other(_) => {
                                unreachable!()
                            }
                            SeenOrReviewOrCalendarEventExtraInformation::Show(_) => {
                                unreachable!()
                            }
                            SeenOrReviewOrCalendarEventExtraInformation::Podcast(s) => {
                                if let Some(episode) = item.get_episode(s.episode) {
                                    if let Some(r) = episode.runtime {
                                        ls.media.podcasts.runtime += r;
                                    }
                                    ls.unique_items
                                        .podcast_episodes
                                        .insert((meta.id, s.episode));
                                }
                            }
                        }
                    }
                    MediaSpecifics::VideoGame(_item) => {
                        ls.unique_items.video_games.insert(seen.metadata_id);
                    }
                    MediaSpecifics::VisualNovel(item) => {
                        ls.unique_items.visual_novels.insert(seen.metadata_id);
                        if let Some(r) = item.length {
                            ls.media.visual_novels.runtime += r;
                        }
                    }
                    MediaSpecifics::Unknown => {}
                }
            }
        }

        ls.media.creators_interacted_with = ls.unique_items.creators.len();

        ls.media.podcasts.played_episodes = ls.unique_items.podcast_episodes.len();
        ls.media.podcasts.played = ls.unique_items.podcasts.len();

        ls.media.shows.watched_episodes = ls.unique_items.show_episodes.len();
        ls.media.shows.watched_seasons = ls.unique_items.show_seasons.len();
        ls.media.shows.watched = ls.unique_items.shows.len();

        ls.media.video_games.played = ls.unique_items.video_games.len();
        ls.media.audio_books.played = ls.unique_items.audio_books.len();
        ls.media.anime.watched = ls.unique_items.anime.len();
        ls.media.manga.read = ls.unique_items.manga.len();
        ls.media.books.read = ls.unique_items.books.len();
        ls.media.movies.watched = ls.unique_items.movies.len();
        ls.media.visual_novels.played = ls.unique_items.visual_novels.len();

        ls.calculated_on = Utc::now();

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
            sink_integrations: ActiveValue::Set(vec![]),
            notifications: ActiveValue::Set(vec![]),
            ..Default::default()
        };
        let user = user.insert(&self.db).await.unwrap();
        self.user_created_job(user.id).await?;
        self.calculate_user_summary(user.id, true).await?;
        Ok(RegisterResult::Ok(IdObject { id: user.id }))
    }

    async fn login_user(&self, username: &str, password: &str) -> Result<LoginResult> {
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
        let jwt_key = jwt::sign(
            user.id,
            &self.config.users.jwt_secret,
            self.config.users.token_valid_for_days,
        )?;
        Ok(LoginResult::Ok(LoginResponse {
            api_key: jwt_key,
            valid_for: self.config.users.token_valid_for_days,
        }))
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
            if self.config.users.allow_changing_credentials {
                user_obj.name = ActiveValue::Set(n);
            }
        }
        if let Some(e) = input.email {
            user_obj.email = ActiveValue::Set(Some(e));
        }
        if let Some(p) = input.password {
            if self.config.users.allow_changing_credentials {
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
            self.calculate_user_summary(user_id, false).await?;
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
            MetadataLot::VisualNovel => match input.visual_novel_specifics {
                None => return err(),
                Some(ref mut s) => MediaSpecifics::VisualNovel(s.clone()),
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
            .map(|i| MetadataImageForMediaDetails {
                image: i,
                lot: MetadataImageLot::Poster,
            })
            .collect();
        let videos = input
            .videos
            .unwrap_or_default()
            .into_iter()
            .map(|i| MetadataVideo {
                identifier: StoredUrl::S3(i),
                source: MetadataVideoSource::Custom,
            })
            .collect();
        let creators = input
            .creators
            .unwrap_or_default()
            .into_iter()
            .map(|c| MetadataFreeCreator {
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
            s3_images: images,
            url_images: vec![],
            videos,
            publish_year: input.publish_year,
            specifics,
            production_status: None,
            provider_rating: None,
            is_nsfw: input.is_nsfw,
            publish_date: None,
            suggestions: vec![],
            group_identifiers: vec![],
            people: vec![],
            original_language: None,
        };
        let media = self.commit_media_internal(details).await?;
        self.add_entity_to_collection(
            user_id,
            ChangeCollectionToEntityInput {
                collection_name: DefaultCollection::Custom.to_string(),
                entity_id: media.id.to_string(),
                entity_lot: EntityLot::Media,
            },
        )
        .await?;
        Ok(CreateCustomMediaResult::Ok(media))
    }

    fn get_sql_and_values(&self, stmt: SelectStatement) -> (String, Values) {
        match self.db.get_database_backend() {
            DatabaseBackend::Postgres => stmt.build(PostgresQueryBuilder {}),
            _ => unreachable!(),
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
        let user_model = user_by_id(&self.db, user_id).await?;
        let mut preferences = user_model.preferences.clone();
        match input.property.is_empty() {
            true => {
                preferences = UserPreferences::default();
            }
            false => {
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
                                        let value_vector =
                                            serde_json::from_str(&input.value).unwrap();
                                        preferences.fitness.measurements.custom = value_vector;
                                    }
                                    "inbuilt" => match right {
                                        "weight" => {
                                            preferences.fitness.measurements.inbuilt.weight =
                                                value_bool.unwrap();
                                        }
                                        "body_mass_index" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .body_mass_index = value_bool.unwrap();
                                        }
                                        "total_body_water" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .total_body_water = value_bool.unwrap();
                                        }
                                        "muscle" => {
                                            preferences.fitness.measurements.inbuilt.muscle =
                                                value_bool.unwrap();
                                        }
                                        "lean_body_mass" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .lean_body_mass = value_bool.unwrap();
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
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .waist_circumference = value_bool.unwrap();
                                        }
                                        "waist_to_height_ratio" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .waist_to_height_ratio = value_bool.unwrap();
                                        }
                                        "hip_circumference" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .hip_circumference = value_bool.unwrap();
                                        }
                                        "waist_to_hip_ratio" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .waist_to_hip_ratio = value_bool.unwrap();
                                        }
                                        "chest_circumference" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .chest_circumference = value_bool.unwrap();
                                        }
                                        "thigh_circumference" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .thigh_circumference = value_bool.unwrap();
                                        }
                                        "biceps_circumference" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .biceps_circumference = value_bool.unwrap();
                                        }
                                        "neck_circumference" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .neck_circumference = value_bool.unwrap();
                                        }
                                        "body_fat_caliper" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .body_fat_caliper = value_bool.unwrap();
                                        }
                                        "chest_skinfold" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .chest_skinfold = value_bool.unwrap();
                                        }
                                        "abdominal_skinfold" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .abdominal_skinfold = value_bool.unwrap();
                                        }
                                        "thigh_skinfold" => {
                                            preferences
                                                .fitness
                                                .measurements
                                                .inbuilt
                                                .thigh_skinfold = value_bool.unwrap();
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
                                                .total_daily_energy_expenditure =
                                                value_bool.unwrap();
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
                                    preferences.fitness.exercises.save_history =
                                        value_usize.unwrap()
                                }
                                "unit_system" => {
                                    preferences.fitness.exercises.unit_system =
                                        UserUnitSystem::from_str(&input.value).unwrap();
                                }
                                "default_timer" => {
                                    preferences.fitness.exercises.default_timer = value_usize.ok();
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
                                    preferences.features_enabled.fitness.enabled =
                                        value_bool.unwrap()
                                }
                                "measurements" => {
                                    preferences.features_enabled.fitness.measurements =
                                        value_bool.unwrap()
                                }
                                "workouts" => {
                                    preferences.features_enabled.fitness.workouts =
                                        value_bool.unwrap()
                                }
                                _ => return Err(err()),
                            },
                            "media" => {
                                match right {
                                    "enabled" => {
                                        preferences.features_enabled.media.enabled =
                                            value_bool.unwrap()
                                    }
                                    "audio_book" => {
                                        preferences.features_enabled.media.audio_book =
                                            value_bool.unwrap()
                                    }
                                    "book" => {
                                        preferences.features_enabled.media.book =
                                            value_bool.unwrap()
                                    }
                                    "movie" => {
                                        preferences.features_enabled.media.movie =
                                            value_bool.unwrap()
                                    }
                                    "podcast" => {
                                        preferences.features_enabled.media.podcast =
                                            value_bool.unwrap()
                                    }
                                    "show" => {
                                        preferences.features_enabled.media.show =
                                            value_bool.unwrap()
                                    }
                                    "video_game" => {
                                        preferences.features_enabled.media.video_game =
                                            value_bool.unwrap()
                                    }
                                    "visual_novel" => {
                                        preferences.features_enabled.media.visual_novel =
                                            value_bool.unwrap()
                                    }
                                    "manga" => {
                                        preferences.features_enabled.media.manga =
                                            value_bool.unwrap()
                                    }
                                    "anime" => {
                                        preferences.features_enabled.media.anime =
                                            value_bool.unwrap()
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
                        "episode_name_changed" => {
                            preferences.notifications.episode_name_changed = value_bool.unwrap()
                        }
                        "episode_images_changed" => {
                            preferences.notifications.episode_images_changed = value_bool.unwrap()
                        }
                        "status_changed" => {
                            preferences.notifications.status_changed = value_bool.unwrap()
                        }
                        "new_review_posted" => {
                            preferences.notifications.new_review_posted = value_bool.unwrap()
                        }
                        "release_date_changed" => {
                            preferences.notifications.release_date_changed = value_bool.unwrap()
                        }
                        "number_of_seasons_changed" => {
                            preferences.notifications.number_of_seasons_changed =
                                value_bool.unwrap()
                        }
                        "number_of_chapters_or_episodes_changed" => {
                            preferences
                                .notifications
                                .number_of_chapters_or_episodes_changed = value_bool.unwrap()
                        }
                        _ => return Err(err()),
                    },
                    "general" => match right {
                        "review_scale" => {
                            preferences.general.review_scale =
                                UserReviewScale::from_str(&input.value).unwrap();
                        }
                        "display_nsfw" => {
                            preferences.general.display_nsfw = value_bool.unwrap();
                        }
                        "disable_yank_integrations" => {
                            preferences.general.disable_yank_integrations = value_bool.unwrap();
                        }
                        "dashboard" => {
                            preferences.general.dashboard =
                                serde_json::from_str(&input.value).unwrap();
                        }
                        _ => return Err(err()),
                    },
                    _ => return Err(err()),
                };
            }
        };
        let mut user_model: user::ActiveModel = user_model.into();
        user_model.preferences = ActiveValue::Set(preferences);
        user_model.update(&self.db).await?;
        Ok(true)
    }

    async fn user_integrations(&self, user_id: i32) -> Result<Vec<GraphqlUserIntegration>> {
        let user =
            partial_user_by_id::<UserWithOnlyIntegrationsAndNotifications>(&self.db, user_id)
                .await?;
        let mut all_integrations = vec![];
        user.yank_integrations
            .unwrap_or_default()
            .into_iter()
            .for_each(|i| {
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
                    slug: None,
                })
            });
        user.sink_integrations.into_iter().for_each(|i| {
            let (description, slug) = match i.settings {
                UserSinkIntegrationSetting::Jellyfin { slug } => {
                    (format!("Jellyfin slug: {}", &slug), slug)
                }
                UserSinkIntegrationSetting::Plex { slug, user } => (
                    format!(
                        "Plex slug: {},  Plex user: {}",
                        &slug,
                        user.unwrap_or_else(|| "N/A".to_owned())
                    ),
                    slug,
                ),
                UserSinkIntegrationSetting::Kodi { slug } => {
                    (format!("Kodi slug: {}", &slug), slug)
                }
            };
            all_integrations.push(GraphqlUserIntegration {
                id: i.id,
                lot: UserIntegrationLot::Sink,
                description,
                timestamp: i.timestamp,
                slug: Some(slug),
            })
        });
        Ok(all_integrations)
    }

    async fn user_notification_platforms(
        &self,
        user_id: i32,
    ) -> Result<Vec<GraphqlUserNotificationPlatform>> {
        let user =
            partial_user_by_id::<UserWithOnlyIntegrationsAndNotifications>(&self.db, user_id)
                .await?;
        let mut all_notifications = vec![];
        user.notifications.into_iter().for_each(|n| {
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
        let user = user_by_id(&self.db, user_id).await?;
        let mut integrations = user.sink_integrations.clone();
        let new_integration_id = integrations.len() + 1;
        let new_integration = UserSinkIntegration {
            id: new_integration_id,
            timestamp: Utc::now(),
            settings: {
                let slug = get_id_hasher(&self.config.integration.hasher_salt)
                    .encode(&[user_id.try_into().unwrap()]);
                let slug = format!("{}--{}", slug, nanoid!(5));
                match input.lot {
                    UserSinkIntegrationSettingKind::Jellyfin => {
                        UserSinkIntegrationSetting::Jellyfin { slug }
                    }
                    UserSinkIntegrationSettingKind::Plex => UserSinkIntegrationSetting::Plex {
                        slug,
                        user: input.username,
                    },
                    UserSinkIntegrationSettingKind::Kodi => {
                        UserSinkIntegrationSetting::Kodi { slug }
                    }
                }
            },
        };
        integrations.insert(0, new_integration);
        let mut user: user::ActiveModel = user.into();
        user.sink_integrations = ActiveValue::Set(integrations);
        user.update(&self.db).await?;
        Ok(new_integration_id)
    }

    async fn create_user_yank_integration(
        &self,
        user_id: i32,
        input: CreateUserYankIntegrationInput,
    ) -> Result<usize> {
        let user = user_by_id(&self.db, user_id).await?;
        let mut integrations = user.yank_integrations.clone().unwrap_or_default();
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
        user.yank_integrations = ActiveValue::Set(Some(integrations));
        user.update(&self.db).await?;
        Ok(new_integration_id)
    }

    async fn delete_user_integration(
        &self,
        user_id: i32,
        integration_id: usize,
        integration_type: UserIntegrationLot,
    ) -> Result<bool> {
        let user = user_by_id(&self.db, user_id).await?;
        let mut user_db: user::ActiveModel = user.clone().into();
        match integration_type {
            UserIntegrationLot::Yank => {
                let remaining_integrations = user
                    .yank_integrations
                    .clone()
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|i| i.id != integration_id)
                    .collect_vec();
                let update_value = if remaining_integrations.is_empty() {
                    None
                } else {
                    Some(remaining_integrations)
                };
                user_db.yank_integrations = ActiveValue::Set(update_value);
            }
            UserIntegrationLot::Sink => {
                let integrations = user.sink_integrations.clone();
                let remaining_integrations = integrations
                    .into_iter()
                    .filter(|i| i.id != integration_id)
                    .collect_vec();
                let update_value = remaining_integrations;
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
        let user = user_by_id(&self.db, user_id).await?;
        let mut notifications = user.notifications.clone();
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
                    auth_header: input.auth_header,
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
        user.notifications = ActiveValue::Set(notifications);
        user.update(&self.db).await?;
        Ok(new_notification_id)
    }

    async fn delete_user_notification_platform(
        &self,
        user_id: i32,
        notification_id: usize,
    ) -> Result<bool> {
        let user = user_by_id(&self.db, user_id).await?;
        let mut user_db: user::ActiveModel = user.clone().into();
        let notifications = user.notifications.clone();
        let remaining_notifications = notifications
            .into_iter()
            .filter(|i| i.id != notification_id)
            .collect_vec();
        let update_value = remaining_notifications;
        user_db.notifications = ActiveValue::Set(update_value);
        user_db.update(&self.db).await?;
        Ok(true)
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
            MetadataLot::AudioBook => vec![MetadataSource::Audible],
            MetadataLot::Book => vec![MetadataSource::Openlibrary, MetadataSource::GoogleBooks],
            MetadataLot::Podcast => vec![MetadataSource::Itunes, MetadataSource::Listennotes],
            MetadataLot::VideoGame => vec![MetadataSource::Igdb],
            MetadataLot::Anime => vec![MetadataSource::Anilist, MetadataSource::Mal],
            MetadataLot::Manga => vec![
                MetadataSource::Anilist,
                MetadataSource::MangaUpdates,
                MetadataSource::Mal,
            ],
            MetadataLot::Movie | MetadataLot::Show => vec![MetadataSource::Tmdb],
            MetadataLot::VisualNovel => vec![MetadataSource::Vndb],
        }
    }

    fn providers_language_information(&self) -> Vec<ProviderLanguageInformation> {
        MetadataSource::iter()
            .map(|source| {
                let (supported, default) = match source {
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
                    MetadataSource::MangaUpdates => (
                        MangaUpdatesService::supported_languages(),
                        MangaUpdatesService::default_language(),
                    ),
                    MetadataSource::Anilist => (
                        AnilistService::supported_languages(),
                        AnilistService::default_language(),
                    ),
                    MetadataSource::Mal => (
                        MalService::supported_languages(),
                        MalService::default_language(),
                    ),
                    MetadataSource::Custom => (
                        CustomService::supported_languages(),
                        CustomService::default_language(),
                    ),
                    MetadataSource::Vndb => (
                        VndbService::supported_languages(),
                        VndbService::default_language(),
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
        let preferences = self.user_preferences(user_id).await?;
        if preferences.general.disable_yank_integrations {
            return Ok(0);
        }
        if let Some(integrations) =
            partial_user_by_id::<UserWithOnlyIntegrationsAndNotifications>(&self.db, user_id)
                .await?
                .yank_integrations
        {
            let mut progress_updates = vec![];
            for integration in integrations.iter() {
                let response = match &integration.settings {
                    UserYankIntegrationSetting::Audiobookshelf { base_url, token } => {
                        self.get_integration_service()
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

    async fn admin_account_guard(&self, user_id: i32) -> Result<()> {
        let main_user = user_by_id(&self.db, user_id).await?;
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
    ) -> Result<String> {
        let integration = match integration.as_str() {
            "jellyfin" => UserSinkIntegrationSettingKind::Jellyfin,
            "plex" => UserSinkIntegrationSettingKind::Plex,
            "kodi" => UserSinkIntegrationSettingKind::Kodi,
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
        let user =
            partial_user_by_id::<UserWithOnlyIntegrationsAndNotifications>(&self.db, user_id)
                .await?;
        let integration = user
            .sink_integrations
            .into_iter()
            .find(|i| match &i.settings {
                UserSinkIntegrationSetting::Jellyfin { slug } => {
                    slug == &user_hash_id && integration == UserSinkIntegrationSettingKind::Jellyfin
                }
                UserSinkIntegrationSetting::Plex { slug, .. } => {
                    slug == &user_hash_id && integration == UserSinkIntegrationSettingKind::Plex
                }
                UserSinkIntegrationSetting::Kodi { slug } => {
                    slug == &user_hash_id && integration == UserSinkIntegrationSettingKind::Kodi
                }
            })
            .ok_or_else(|| Error::new("Webhook URL does not match".to_owned()))?;
        let maybe_progress_update = match integration.settings {
            UserSinkIntegrationSetting::Jellyfin { .. } => {
                self.get_integration_service()
                    .jellyfin_progress(&payload)
                    .await
            }
            UserSinkIntegrationSetting::Plex { user, .. } => {
                self.get_integration_service()
                    .plex_progress(&payload, user, &self.db)
                    .await
            }
            UserSinkIntegrationSetting::Kodi { .. } => {
                self.get_integration_service().kodi_progress(&payload).await
            }
        };
        match maybe_progress_update {
            Ok(pu) => {
                self.integration_progress_update(pu, user_id).await?;
                Ok("Progress updated successfully".to_owned())
            }
            Err(e) => Err(Error::new(e.to_string())),
        }
    }

    async fn integration_progress_update(&self, pu: IntegrationMedia, user_id: i32) -> Result<()> {
        if pu.progress < self.config.integration.minimum_progress_limit {
            return Ok(());
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
        self.remove_entity_from_collection(
            seen.user_id,
            ChangeCollectionToEntityInput {
                collection_name: DefaultCollection::Watchlist.to_string(),
                entity_id: seen.metadata_id.to_string(),
                entity_lot: EntityLot::Media,
            },
        )
        .await
        .ok();
        match seen.state {
            SeenState::InProgress => {
                self.add_entity_to_collection(
                    seen.user_id,
                    ChangeCollectionToEntityInput {
                        collection_name: DefaultCollection::InProgress.to_string(),
                        entity_id: seen.metadata_id.to_string(),
                        entity_lot: EntityLot::Media,
                    },
                )
                .await
                .ok();
            }
            SeenState::Dropped | SeenState::OnAHold => {
                self.remove_entity_from_collection(
                    seen.user_id,
                    ChangeCollectionToEntityInput {
                        collection_name: DefaultCollection::InProgress.to_string(),
                        entity_id: seen.metadata_id.to_string(),
                        entity_lot: EntityLot::Media,
                    },
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
                    let all_episodes = match metadata.model.specifics.unwrap() {
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
                        self.remove_entity_from_collection(
                            seen.user_id,
                            ChangeCollectionToEntityInput {
                                collection_name: DefaultCollection::InProgress.to_string(),
                                entity_id: seen.metadata_id.to_string(),
                                entity_lot: EntityLot::Media,
                            },
                        )
                        .await
                        .ok();
                    } else {
                        self.add_entity_to_collection(
                            seen.user_id,
                            ChangeCollectionToEntityInput {
                                collection_name: DefaultCollection::InProgress.to_string(),
                                entity_id: seen.metadata_id.to_string(),
                                entity_lot: EntityLot::Media,
                            },
                        )
                        .await
                        .ok();
                        let is_monitored = self
                            .get_monitored_status(seen.user_id, seen.metadata_id)
                            .await?;
                        if !is_monitored {
                            self.toggle_media_monitor(seen.user_id, seen.metadata_id)
                                .await?;
                        }
                    }
                } else {
                    self.remove_entity_from_collection(
                        seen.user_id,
                        ChangeCollectionToEntityInput {
                            collection_name: DefaultCollection::InProgress.to_string(),
                            entity_id: seen.metadata_id.to_string(),
                            entity_lot: EntityLot::Media,
                        },
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
        let user =
            partial_user_by_id::<UserWithOnlyIntegrationsAndNotifications>(&self.db, user_id)
                .await?;
        let mut success = true;
        for notification in user.notifications {
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
        // DEV: This is very inefficient but since we are running this once a day, it does not matter
        for your_col in [DefaultCollection::Watchlist, DefaultCollection::InProgress] {
            let collections = Collection::find()
                .filter(collection::Column::Name.eq(your_col.to_string()))
                .all(&self.db)
                .await?;
            for col in collections {
                let related_meta = col.find_related(CollectionToEntity).all(&self.db).await?;
                for rel in related_meta {
                    if let Some(metadata) = rel.find_related(Metadata).one(&self.db).await? {
                        if metadata.id == metadata_id {
                            user_ids.push(col.user_id);
                        }
                    }
                }
            }
        }
        let monitored_media = UserToEntity::find()
            .filter(user_to_entity::Column::MetadataMonitored.eq(true))
            .filter(user_to_entity::Column::MetadataId.eq(metadata_id))
            .all(&self.db)
            .await?;
        for meta in monitored_media {
            if meta.metadata_id.unwrap() == metadata_id {
                user_ids.push(meta.user_id);
            }
        }
        Ok(user_ids)
    }

    pub async fn update_watchlist_media_and_send_notifications(&self) -> Result<()> {
        if !self.config.server.update_monitored_media {
            tracing::trace!("Monitored media updating has been disabled.");
            return Ok(());
        }
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
        if matches!(change, MediaStateChanged::EpisodeNameChanged)
            && preferences.notifications.episode_name_changed
        {
            self.send_notifications_to_user_platforms(user_id, notification)
                .await
                .ok();
        }
        if matches!(change, MediaStateChanged::ChaptersOrEpisodesChanged)
            && preferences
                .notifications
                .number_of_chapters_or_episodes_changed
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

    async fn toggle_media_monitor(&self, user_id: i32, metadata_id: i32) -> Result<bool> {
        let metadata = associate_user_with_metadata(&user_id, &metadata_id, &self.db).await?;
        let new_monitored_value = !metadata.metadata_monitored.unwrap_or_default();
        let mut metadata: user_to_entity::ActiveModel = metadata.into();
        metadata.metadata_monitored = ActiveValue::Set(Some(new_monitored_value));
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
            m.metadata_monitored.unwrap_or_default()
        } else {
            false
        })
    }

    pub async fn genres_list(&self, input: SearchInput) -> Result<SearchResults<GenreListItem>> {
        let page: u64 = input.page.unwrap_or(1).try_into().unwrap();
        let num_items = "num_items";
        let query = Genre::find()
            .column_as(
                Expr::expr(Func::count(Expr::col((
                    AliasedMetadataToGenre::Table,
                    metadata_to_genre::Column::MetadataId,
                )))),
                num_items,
            )
            .apply_if(input.query, |query, v| {
                query.filter(
                    Condition::all().add(get_ilike_query(Expr::col(genre::Column::Name), &v)),
                )
            })
            .join(JoinType::Join, genre::Relation::MetadataToGenre.def())
            // fuck it. we ball. (extremely unsafe, guaranteed to fail if names change)
            .group_by(Expr::cust("genre.id, genre.name"))
            .order_by(Expr::col(Alias::new(num_items)), Order::Desc);
        let paginator = query
            .clone()
            .into_model::<GenreListItem>()
            .paginate(&self.db, self.config.frontend.page_size.try_into().unwrap());
        let ItemsAndPagesNumber {
            number_of_items,
            number_of_pages,
        } = paginator.num_items_and_pages().await?;
        let mut items = vec![];
        for c in paginator.fetch_page(page - 1).await? {
            items.push(c);
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
            items,
        })
    }

    pub async fn metadata_groups_list(
        &self,
        input: SearchInput,
    ) -> Result<SearchResults<MetadataGroupListItem>> {
        let page: u64 = input.page.unwrap_or(1).try_into().unwrap();
        let query = MetadataGroup::find()
            .apply_if(input.query, |query, v| {
                query.filter(Condition::all().add(get_ilike_query(
                    Expr::col(metadata_group::Column::Title),
                    &v,
                )))
            })
            .order_by_asc(metadata_group::Column::Title);
        let paginator = query
            .clone()
            .into_model::<MetadataGroupListItem>()
            .paginate(&self.db, self.config.frontend.page_size.try_into().unwrap());
        let ItemsAndPagesNumber {
            number_of_items,
            number_of_pages,
        } = paginator.num_items_and_pages().await?;
        let mut items = vec![];
        for c in paginator.fetch_page(page - 1).await? {
            let mut c = c;
            let mut image = None;
            if let Some(i) = c.images.iter().find(|i| i.lot == MetadataImageLot::Poster) {
                image = Some(get_stored_asset(i.url.clone(), &self.file_storage_service).await);
            }
            c.image = image;
            items.push(c);
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
            items,
        })
    }

    async fn people_list(
        &self,
        input: PeopleListInput,
    ) -> Result<SearchResults<MediaCreatorSearchItem>> {
        #[derive(Debug, FromQueryResult)]
        struct PartialCreator {
            id: i32,
            name: String,
            images: Option<Vec<MetadataImage>>,
            media_count: i64,
        }
        let page: u64 = input.search.page.unwrap_or(1).try_into().unwrap();
        let alias = "media_count";
        let media_items_col = Expr::col(Alias::new(alias));
        let (order_by, sort_order) = match input.sort {
            None => (media_items_col, Order::Desc),
            Some(ord) => (
                match ord.by {
                    PersonSortBy::Name => Expr::col(person::Column::Name),
                    PersonSortBy::MediaItems => media_items_col,
                },
                ord.order.into(),
            ),
        };
        let query = Person::find()
            .apply_if(input.search.query, |query, v| {
                query.filter(
                    Condition::all().add(get_ilike_query(Expr::col(person::Column::Name), &v)),
                )
            })
            .column_as(
                Expr::expr(Func::count(Expr::col(
                    metadata_to_person::Column::MetadataId,
                ))),
                alias,
            )
            .join(JoinType::LeftJoin, person::Relation::MetadataToPerson.def())
            .group_by(person::Column::Id)
            .group_by(person::Column::Name)
            .order_by(order_by, sort_order);
        let creators_paginator = query
            .clone()
            .into_model::<PartialCreator>()
            .paginate(&self.db, self.config.frontend.page_size.try_into().unwrap());
        let ItemsAndPagesNumber {
            number_of_items,
            number_of_pages,
        } = creators_paginator.num_items_and_pages().await?;
        let mut creators = vec![];
        for cr in creators_paginator.fetch_page(page - 1).await? {
            let image = cr.images.first_as_url(&self.file_storage_service).await;
            creators.push(MediaCreatorSearchItem {
                id: cr.id,
                name: cr.name,
                image,
                media_count: cr.media_count,
            });
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

    async fn person_details(&self, person_id: i32) -> Result<CreatorDetails> {
        let mut details = Person::find_by_id(person_id).one(&self.db).await?.unwrap();
        details.display_images = details.images.as_urls(&self.file_storage_service).await;
        let associations = MetadataToPerson::find()
            .filter(metadata_to_person::Column::PersonId.eq(person_id))
            .find_also_related(Metadata)
            .order_by_asc(metadata_to_person::Column::Index)
            .all(&self.db)
            .await?;
        let mut contents: HashMap<_, Vec<_>> = HashMap::new();
        for (assoc, metadata) in associations {
            let m = metadata.unwrap();
            let image = m.images.first_as_url(&self.file_storage_service).await;
            let metadata = PartialMetadata {
                identifier: m.identifier,
                title: m.title,
                image,
                lot: m.lot,
                source: m.source,
                id: m.id,
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
            .sorted_by_key(|(role, _)| role.clone())
            .map(|(name, items)| CreatorDetailsGroupedByRole { name, items })
            .collect_vec();
        let slug = slug::slugify(&details.name);
        let identifier = &details.identifier;
        let source_url = match details.source {
            MetadataSource::Custom
            | MetadataSource::Anilist
            | MetadataSource::Listennotes
            | MetadataSource::Itunes
            | MetadataSource::MangaUpdates
            | MetadataSource::Mal
            | MetadataSource::Vndb
            | MetadataSource::GoogleBooks => None,
            MetadataSource::Audible => Some(format!(
                "https://www.audible.com/author/{slug}/{identifier}"
            )),
            MetadataSource::Openlibrary => Some(format!(
                "https://openlibrary.org/authors/{identifier}/{slug}"
            )),
            MetadataSource::Tmdb => Some(format!(
                "https://www.themoviedb.org/person/{identifier}-{slug}"
            )),
            MetadataSource::Igdb => Some(format!("https://www.igdb.com/company/{slug}")),
        };
        Ok(CreatorDetails {
            details,
            contents,
            source_url,
        })
    }

    async fn genre_details(&self, input: GenreDetailsInput) -> Result<GenreDetails> {
        let page = input.page.unwrap_or(1);
        let genre = Genre::find_by_id(input.genre_id)
            .one(&self.db)
            .await?
            .unwrap();
        let mut contents = vec![];
        let paginator = MetadataToGenre::find()
            .filter(metadata_to_genre::Column::GenreId.eq(input.genre_id))
            .paginate(&self.db, self.config.frontend.page_size as u64);
        let ItemsAndPagesNumber {
            number_of_items,
            number_of_pages,
        } = paginator.num_items_and_pages().await?;
        for association_items in paginator.fetch_page(page - 1).await? {
            let m = association_items
                .find_related(Metadata)
                .one(&self.db)
                .await?
                .unwrap();
            let image = m.images.first_as_url(&self.file_storage_service).await;
            let metadata = MediaSearchItemWithLot {
                details: MediaSearchItem {
                    image,
                    title: m.title,
                    publish_year: m.publish_year,
                    identifier: m.id.to_string(),
                },
                metadata_lot: Some(m.lot),
                entity_lot: EntityLot::Media,
            };
            contents.push(metadata);
        }
        Ok(GenreDetails {
            details: GenreListItem {
                id: genre.id,
                name: genre.name,
                num_items: Some(number_of_items.try_into().unwrap()),
            },
            contents: SearchResults {
                details: SearchDetails {
                    total: number_of_items.try_into().unwrap(),
                    next_page: if page < number_of_pages {
                        Some((page + 1).try_into().unwrap())
                    } else {
                        None
                    },
                },
                items: contents,
            },
        })
    }

    async fn metadata_group_details(&self, metadata_group_id: i32) -> Result<MetadataGroupDetails> {
        let mut group = MetadataGroup::find_by_id(metadata_group_id)
            .one(&self.db)
            .await?
            .unwrap();
        let mut images = vec![];
        for image in group.images.iter() {
            images.push(get_stored_asset(image.url.clone(), &self.file_storage_service).await);
        }
        group.display_images = images;
        let slug = slug::slugify(&group.title);
        let identifier = &group.identifier;

        let source_url = match group.source {
            MetadataSource::Custom
            | MetadataSource::Anilist
            | MetadataSource::Listennotes
            | MetadataSource::Itunes
            | MetadataSource::MangaUpdates
            | MetadataSource::Mal
            | MetadataSource::Openlibrary
            | MetadataSource::Vndb
            | MetadataSource::GoogleBooks => None,
            MetadataSource::Audible => Some(format!(
                "https://www.audible.com/series/{slug}/{identifier}"
            )),
            MetadataSource::Tmdb => Some(format!(
                "https://www.themoviedb.org/collections/{identifier}-{slug}"
            )),
            MetadataSource::Igdb => Some(format!("https://www.igdb.com/collection/{slug}")),
        };

        let associations = MetadataToMetadataGroup::find()
            .select_only()
            .column(metadata_to_metadata_group::Column::MetadataId)
            .filter(metadata_to_metadata_group::Column::MetadataGroupId.eq(group.id))
            .order_by_asc(metadata_to_metadata_group::Column::Part)
            .into_tuple::<i32>()
            .all(&self.db)
            .await?;
        let contents_temp = Metadata::find()
            .filter(metadata::Column::Id.is_in(associations))
            .left_join(MetadataToMetadataGroup)
            .order_by_asc(metadata_to_metadata_group::Column::Part)
            .all(&self.db)
            .await?;
        let mut contents = vec![];
        for m in contents_temp {
            let image = m.images.first_as_url(&self.file_storage_service).await;
            let metadata = PartialMetadata {
                identifier: m.identifier,
                title: m.title,
                image,
                lot: m.lot,
                source: m.source,
                id: m.id,
            };
            contents.push(metadata);
        }
        Ok(MetadataGroupDetails {
            details: group,
            source_url,
            contents,
        })
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
        if utm.metadata_reminder.is_some() {
            self.delete_media_reminder(user_id, input.metadata_id)
                .await?;
        }
        let mut utm: user_to_entity::ActiveModel = utm.into();
        utm.metadata_reminder = ActiveValue::Set(Some(UserMediaReminder {
            remind_on: input.remind_on,
            message: input.message,
        }));
        utm.update(&self.db).await?;
        Ok(true)
    }

    async fn delete_media_reminder(&self, user_id: i32, metadata_id: i32) -> Result<bool> {
        let utm = associate_user_with_metadata(&user_id, &metadata_id, &self.db).await?;
        let mut utm: user_to_entity::ActiveModel = utm.into();
        utm.metadata_reminder = ActiveValue::Set(None);
        utm.update(&self.db).await?;
        Ok(true)
    }

    async fn toggle_media_ownership(
        &self,
        user_id: i32,
        metadata_id: i32,
        owned_on: Option<NaiveDate>,
    ) -> Result<bool> {
        let utm = associate_user_with_metadata(&user_id, &metadata_id, &self.db).await?;
        let has_ownership = utm.metadata_ownership.is_some();
        let mut utm: user_to_entity::ActiveModel = utm.into();
        if has_ownership {
            utm.metadata_ownership = ActiveValue::Set(None);
        } else {
            utm.metadata_ownership = ActiveValue::Set(Some(UserMediaOwnership {
                marked_on: Utc::now(),
                owned_on,
            }));
        }
        utm.update(&self.db).await?;
        Ok(true)
    }

    pub async fn send_pending_media_reminders(&self) -> Result<()> {
        for utm in UserToEntity::find()
            .filter(user_to_entity::Column::MetadataReminder.is_not_null())
            .all(&self.db)
            .await?
        {
            if let Some(reminder) = utm.metadata_reminder {
                if get_current_date(self.timezone.as_ref()) == reminder.remind_on {
                    self.send_notifications_to_user_platforms(utm.user_id, &reminder.message)
                        .await?;
                    self.delete_media_reminder(utm.user_id, utm.metadata_id.unwrap())
                        .await?;
                }
            }
        }
        Ok(())
    }

    pub async fn export_media(&self, user_id: i32, writer: &mut BufWriter<File>) -> Result<bool> {
        let related_metadata = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .all(&self.db)
            .await
            .unwrap();
        let distinct_meta_ids = related_metadata
            .into_iter()
            .map(|m| m.metadata_id)
            .collect_vec();
        let all_meta = Metadata::find()
            .filter(metadata::Column::Id.is_in(distinct_meta_ids))
            .order_by(metadata::Column::Id, Order::Asc)
            .all(&self.db)
            .await?;
        for (m_idx, m) in all_meta.iter().enumerate() {
            if m_idx != 0 && m_idx != all_meta.len() {
                writer.write_all(b",").unwrap();
            }
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
                    ImportOrExportMediaItemSeen {
                        progress: Some(s.progress),
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
            for review in db_reviews {
                let review_item = get_review_export_item(
                    self.review_by_id(review.id, user_id, false).await.unwrap(),
                );
                reviews.push(review_item);
            }
            let collections =
                entity_in_collections(&self.db, user_id, m.id.to_string(), EntityLot::Media)
                    .await?
                    .into_iter()
                    .map(|c| c.name)
                    .collect();
            let exp = ImportOrExportMediaItem {
                source_id: m.id.to_string(),
                lot: m.lot,
                source: m.source,
                identifier: m.identifier.clone(),
                internal_identifier: None,
                seen_history,
                reviews,
                collections,
            };
            let to_write = serde_json::to_string(&exp).unwrap();
            writer.write_all(to_write.as_bytes()).unwrap();
        }
        Ok(true)
    }

    pub async fn export_people(&self, user_id: i32, writer: &mut BufWriter<File>) -> Result<bool> {
        let mut resp: Vec<ImportOrExportPersonItem> = vec![];
        let all_reviews = Review::find()
            .filter(review::Column::PersonId.is_not_null())
            .filter(review::Column::UserId.eq(user_id))
            .find_also_related(Person)
            .all(&self.db)
            .await?;
        for (review, creator) in all_reviews {
            let creator = creator.unwrap();
            let review_item =
                get_review_export_item(self.review_by_id(review.id, user_id, false).await.unwrap());
            if let Some(entry) = resp.iter_mut().find(|c| c.name == creator.name) {
                entry.reviews.push(review_item);
            } else {
                let collections = entity_in_collections(
                    &self.db,
                    user_id,
                    creator.id.to_string(),
                    EntityLot::Person,
                )
                .await?
                .into_iter()
                .map(|c| c.name)
                .collect();
                resp.push(ImportOrExportPersonItem {
                    name: creator.name,
                    reviews: vec![review_item],
                    collections,
                });
            }
        }
        let mut to_write = serde_json::to_string(&resp).unwrap();
        // remove the outer array
        to_write.remove(0);
        to_write.pop();
        writer.write_all(to_write.as_bytes()).unwrap();
        Ok(true)
    }

    async fn generate_auth_token(&self, user_id: i32) -> Result<String> {
        let auth_token = jwt::sign(
            user_id,
            &self.config.users.jwt_secret,
            self.config.users.token_valid_for_days,
        )?;
        Ok(auth_token)
    }

    async fn create_review_comment(
        &self,
        user_id: i32,
        input: CreateReviewCommentInput,
    ) -> Result<bool> {
        let review = Review::find_by_id(input.review_id)
            .one(&self.db)
            .await?
            .unwrap();
        let mut comments = review.comments.clone();
        if input.should_delete.unwrap_or_default() {
            let position = comments
                .iter()
                .position(|r| &r.id == input.comment_id.as_ref().unwrap())
                .unwrap();
            comments.remove(position);
        } else if input.increment_likes.unwrap_or_default() {
            let comment = comments
                .iter_mut()
                .find(|r| &r.id == input.comment_id.as_ref().unwrap())
                .unwrap();
            comment.liked_by.insert(user_id);
        } else if input.decrement_likes.unwrap_or_default() {
            let comment = comments
                .iter_mut()
                .find(|r| &r.id == input.comment_id.as_ref().unwrap())
                .unwrap();
            comment.liked_by.remove(&user_id);
        } else {
            let user = user_by_id(&self.db, user_id).await?;
            comments.push(ImportOrExportItemReviewComment {
                id: nanoid!(20),
                text: input.text.unwrap(),
                user: ReviewCommentUser {
                    id: user_id,
                    name: user.name,
                },
                liked_by: HashSet::new(),
                created_on: Utc::now(),
            });
        }
        let mut review: review::ActiveModel = review.into();
        review.comments = ActiveValue::Set(comments);
        review.update(&self.db).await?;
        Ok(true)
    }

    #[instrument(skip(self))]
    pub async fn recalculate_calendar_events(&self) -> Result<()> {
        let mut calendar_stream = CalendarEvent::find()
            .order_by_asc(calendar_event::Column::Id)
            .stream(&self.db)
            .await?;
        while let Some(cal_event) = calendar_stream.try_next().await? {
            let meta = cal_event
                .find_related(Metadata)
                .one(&self.db)
                .await?
                .unwrap();
            let mut need_to_delete = false;
            match cal_event.metadata_extra_information {
                SeenOrReviewOrCalendarEventExtraInformation::Other(_) => {
                    if cal_event.date != meta.publish_date.unwrap() {
                        need_to_delete = true;
                    }
                }
                SeenOrReviewOrCalendarEventExtraInformation::Show(show) => {
                    if let MediaSpecifics::Show(show_info) = meta.specifics.unwrap() {
                        if let Some((_, ep)) = show_info.get_episode(show.season, show.episode) {
                            if ep.publish_date.unwrap() != cal_event.date {
                                need_to_delete = true;
                            }
                        }
                    }
                }
                SeenOrReviewOrCalendarEventExtraInformation::Podcast(podcast) => {
                    if let MediaSpecifics::Podcast(podcast_info) = meta.specifics.unwrap() {
                        if let Some(ep) = podcast_info.get_episode(podcast.episode) {
                            if ep.publish_date != cal_event.date {
                                need_to_delete = true;
                            }
                        }
                    }
                }
            }

            if need_to_delete {
                tracing::trace!(
                    "Need to delete calendar event id = {:#?} since it is invalid",
                    cal_event.id
                );
                CalendarEvent::delete_by_id(cal_event.id)
                    .exec(&self.db)
                    .await?;
            }
        }
        tracing::debug!("Finished deleting invalid calendar events");

        let mut metadata_stream = Metadata::find()
            .filter(metadata::Column::LastProcessedOnForCalendar.is_null())
            .filter(metadata::Column::PublishDate.is_not_null())
            .filter(metadata::Column::Specifics.is_not_null())
            .order_by_desc(metadata::Column::LastUpdatedOn)
            .stream(&self.db)
            .await?;
        let mut calendar_events_inserts = vec![];
        let mut metadata_updates = vec![];
        while let Some(meta) = metadata_stream.try_next().await? {
            match &meta.specifics.unwrap() {
                MediaSpecifics::Podcast(ps) => {
                    for episode in ps.episodes.iter() {
                        let event = calendar_event::ActiveModel {
                            metadata_id: ActiveValue::Set(Some(meta.id)),
                            date: ActiveValue::Set(episode.publish_date),
                            metadata_extra_information: ActiveValue::Set(
                                SeenOrReviewOrCalendarEventExtraInformation::Podcast(
                                    SeenPodcastExtraInformation {
                                        episode: episode.number,
                                    },
                                ),
                            ),
                            ..Default::default()
                        };
                        calendar_events_inserts.push(event);
                    }
                }
                MediaSpecifics::Show(ss) => {
                    for season in ss.seasons.iter() {
                        for episode in season.episodes.iter() {
                            if let Some(date) = episode.publish_date {
                                let event = calendar_event::ActiveModel {
                                    metadata_id: ActiveValue::Set(Some(meta.id)),
                                    date: ActiveValue::Set(date),
                                    metadata_extra_information: ActiveValue::Set(
                                        SeenOrReviewOrCalendarEventExtraInformation::Show(
                                            SeenShowExtraInformation {
                                                season: season.season_number,
                                                episode: episode.episode_number,
                                            },
                                        ),
                                    ),
                                    ..Default::default()
                                };
                                calendar_events_inserts.push(event);
                            }
                        }
                    }
                }
                _ => {
                    let event = calendar_event::ActiveModel {
                        metadata_id: ActiveValue::Set(Some(meta.id)),
                        date: ActiveValue::Set(meta.publish_date.unwrap()),
                        metadata_extra_information: ActiveValue::Set(
                            SeenOrReviewOrCalendarEventExtraInformation::Other(()),
                        ),
                        ..Default::default()
                    };
                    calendar_events_inserts.push(event);
                }
            };
            metadata_updates.push(meta.id);
        }
        if !calendar_events_inserts.is_empty() {
            tracing::debug!(
                "Inserting {} calendar events",
                calendar_events_inserts.len()
            );
            for cal_insert in calendar_events_inserts {
                cal_insert.insert(&self.db).await.ok();
            }
        }
        if !metadata_updates.is_empty() {
            for updates in metadata_updates.chunks(800) {
                Metadata::update_many()
                    .set(metadata::ActiveModel {
                        last_processed_on_for_calendar: ActiveValue::Set(Some(Utc::now())),
                        ..Default::default()
                    })
                    .filter(metadata::Column::Id.is_in(updates.to_owned()))
                    .exec(&self.db)
                    .await
                    .ok();
            }
        }
        tracing::debug!("Finished updating calendar events");
        Ok(())
    }

    pub async fn associate_person_with_metadata(
        &self,
        metadata_id: i32,
        person: PartialMetadataPerson,
        index: usize,
    ) -> Result<()> {
        let mut related_media = vec![];
        let role = person.role.clone();
        let db_person = if let Some(db_person) = Person::find()
            .filter(person::Column::Identifier.eq(&person.identifier))
            .filter(person::Column::Source.eq(person.source))
            .one(&self.db)
            .await
            .unwrap()
        {
            let now = Utc::now();
            if now - db_person.last_updated_on
                > ChronoDuration::days(self.config.server.person_outdated_threshold)
            {
                let new_rel = self.update_person(&person, &db_person, now).await?;
                related_media.extend(new_rel);
            }
            db_person
        } else {
            let provider = self.get_non_media_provider(person.source).await?;
            let provider_person = provider.person_details(&person).await?;
            let images = provider_person.images.map(|images| {
                images
                    .into_iter()
                    .map(|i| MetadataImage {
                        url: StoredUrl::Url(i),
                        lot: MetadataImageLot::Poster,
                    })
                    .collect()
            });
            let person = person::ActiveModel {
                identifier: ActiveValue::Set(provider_person.identifier),
                source: ActiveValue::Set(provider_person.source),
                name: ActiveValue::Set(provider_person.name),
                description: ActiveValue::Set(provider_person.description),
                gender: ActiveValue::Set(provider_person.gender),
                birth_date: ActiveValue::Set(provider_person.birth_date),
                death_date: ActiveValue::Set(provider_person.death_date),
                place: ActiveValue::Set(provider_person.place),
                website: ActiveValue::Set(provider_person.website),
                images: ActiveValue::Set(images),
                ..Default::default()
            };
            related_media.extend(provider_person.related);
            person.insert(&self.db).await?
        };
        let intermediate = metadata_to_person::ActiveModel {
            metadata_id: ActiveValue::Set(metadata_id),
            person_id: ActiveValue::Set(db_person.id),
            role: ActiveValue::Set(role),
            index: ActiveValue::Set(Some(index.try_into().unwrap())),
            character: ActiveValue::Set(person.character),
        };
        intermediate.insert(&self.db).await.ok();
        for (role, media) in related_media {
            let pm = self.create_partial_metadata(media).await?;
            let intermediate = metadata_to_person::ActiveModel {
                person_id: ActiveValue::Set(db_person.id),
                metadata_id: ActiveValue::Set(pm.id),
                role: ActiveValue::Set(role),
                ..Default::default()
            };
            intermediate.insert(&self.db).await.ok();
        }
        Ok(())
    }

    async fn update_person(
        &self,
        person: &PartialMetadataPerson,
        db_person: &person::Model,
        time: chrono::DateTime<Utc>,
    ) -> Result<Vec<(String, PartialMetadataWithoutId)>> {
        let provider = self.get_non_media_provider(person.source).await?;
        let provider_person = provider.person_details(person).await?;
        let images = provider_person.images.map(|images| {
            images
                .into_iter()
                .map(|i| MetadataImage {
                    url: StoredUrl::Url(i),
                    lot: MetadataImageLot::Poster,
                })
                .collect()
        });
        let mut to_update_person: person::ActiveModel = db_person.clone().into();
        to_update_person.last_updated_on = ActiveValue::Set(time);
        to_update_person.description = ActiveValue::Set(provider_person.description);
        to_update_person.gender = ActiveValue::Set(provider_person.gender);
        to_update_person.birth_date = ActiveValue::Set(provider_person.birth_date);
        to_update_person.death_date = ActiveValue::Set(provider_person.death_date);
        to_update_person.place = ActiveValue::Set(provider_person.place);
        to_update_person.website = ActiveValue::Set(provider_person.website);
        to_update_person.images = ActiveValue::Set(images);
        to_update_person.update(&self.db).await.ok();
        Ok(provider_person.related)
    }

    pub async fn handle_review_posted_event(&self, event: ReviewPostedEvent) -> Result<()> {
        let users = User::find()
            .filter(Expr::cust(
                "(preferences -> 'notifications' -> 'new_review_posted') = 'true'::jsonb",
            ))
            .all(&self.db)
            .await?;
        for user in users {
            let url = self.get_frontend_url(event.obj_id, event.entity_lot);
            self.send_notifications_to_user_platforms(
                user.id,
                &format!(
                    "New review posted for {} ({}, {}) by {}.",
                    event.obj_title, event.entity_lot, url, event.username
                ),
            )
            .await?;
        }
        Ok(())
    }

    fn get_frontend_url(&self, id: i32, entity_lot: EntityLot) -> String {
        let url = match entity_lot {
            EntityLot::Media => format!("media/item/{}", id),
            EntityLot::Person => format!("media/people/{}", id),
            EntityLot::MediaGroup => format!("media/groups/{}", id),
            EntityLot::Exercise => format!("fitness/exercises/{}", id),
            EntityLot::Collection => format!("collections/{}", id),
        };
        format!("{}/{}", self.config.frontend.url, url)
    }
}

fn modify_seen_elements(all_seen: &mut [seen::Model]) {
    all_seen.iter_mut().for_each(|s| {
        if let Some(i) = s.extra_information.as_ref() {
            match i {
                SeenOrReviewOrCalendarEventExtraInformation::Other(_) => {}
                SeenOrReviewOrCalendarEventExtraInformation::Show(sea) => {
                    s.show_information = Some(sea.clone());
                }
                SeenOrReviewOrCalendarEventExtraInformation::Podcast(sea) => {
                    s.podcast_information = Some(sea.clone());
                }
            };
        }
    });
}

fn get_review_export_item(rev: ReviewItem) -> ImportOrExportItemRating {
    ImportOrExportItemRating {
        review: Some(ImportOrExportItemReview {
            visibility: Some(rev.visibility),
            date: Some(rev.posted_on),
            spoiler: Some(rev.spoiler),
            text: rev.text,
        }),
        rating: rev.rating,
        show_season_number: rev.show_season,
        show_episode_number: rev.show_episode,
        podcast_episode_number: rev.podcast_episode,
        comments: match rev.comments.is_empty() {
            true => None,
            false => Some(rev.comments),
        },
    }
}
