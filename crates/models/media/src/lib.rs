use std::collections::HashSet;

use async_graphql::{Enum, InputObject, InputType, OneofObject, SimpleObject, Union};
use boilermates::boilermates;
use chrono::{NaiveDate, NaiveDateTime};
use common_models::{
    ApplicationDateRange, CollectionExtraInformation, IdAndNamedObject, PersonSourceSpecifics,
    SearchInput, StoredUrl, StringIdObject,
};
use common_utils::deserialize_date;
use enum_models::{
    EntityLot, ImportSource, IntegrationProvider, MediaLot, MediaSource, NotificationPlatformLot,
    SeenState, Visibility,
};
use rust_decimal::Decimal;
use schematic::Schematic;
use sea_orm::{prelude::DateTimeUtc, EnumIter, FromJsonQueryResult, FromQueryResult};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

#[derive(Debug, Default, SimpleObject, Serialize, Deserialize, Clone)]
pub struct EntityWithLot {
    pub entity_id: String,
    pub entity_lot: EntityLot,
}

#[derive(Debug, InputObject, Default, Clone, Serialize)]
pub struct CreateOrUpdateCollectionInput {
    pub name: String,
    pub description: Option<String>,
    pub update_id: Option<String>,
    pub collaborators: Option<Vec<String>>,
    pub information_template: Option<Vec<CollectionExtraInformation>>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, FromQueryResult)]
pub struct GenreListItem {
    pub id: String,
    pub name: String,
    pub num_items: Option<i64>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    PartialEq,
    Serialize,
    InputObject,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "AudioBookSpecificsInput")]
pub struct AudioBookSpecifics {
    pub runtime: Option<i32>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "BookSpecificsInput")]
pub struct BookSpecifics {
    pub pages: Option<i32>,
    pub is_compilation: Option<bool>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "MovieSpecificsInput")]
pub struct MovieSpecifics {
    pub runtime: Option<i32>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "PodcastSpecificsInput")]
pub struct PodcastSpecifics {
    pub episodes: Vec<PodcastEpisode>,
    pub total_episodes: usize,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "PodcastEpisodeInput")]
#[serde(default)]
pub struct PodcastEpisode {
    pub number: i32,
    pub id: String,
    #[serde(alias = "audio_length_sec")]
    pub runtime: Option<i32>,
    #[serde(alias = "description")]
    pub overview: Option<String>,
    pub title: String,
    #[serde(alias = "pub_date_ms", deserialize_with = "deserialize_date")]
    pub publish_date: NaiveDate,
    pub thumbnail: Option<String>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "ShowSpecificsInput")]
pub struct ShowSpecifics {
    pub seasons: Vec<ShowSeason>,
    pub runtime: Option<i32>,
    pub total_seasons: Option<usize>,
    pub total_episodes: Option<usize>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Hash,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "ShowSeasonSpecificsInput")]
pub struct ShowSeason {
    pub id: i32,
    pub season_number: i32,
    pub name: String,
    pub publish_date: Option<NaiveDate>,
    pub episodes: Vec<ShowEpisode>,
    pub overview: Option<String>,
    pub poster_images: Vec<String>,
    pub backdrop_images: Vec<String>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Hash,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "ShowEpisodeSpecificsInput")]
pub struct ShowEpisode {
    pub id: i32,
    pub episode_number: i32,
    pub publish_date: Option<NaiveDate>,
    pub name: String,
    pub overview: Option<String>,
    pub poster_images: Vec<String>,
    pub runtime: Option<i32>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "VideoGameSpecificsInput")]
pub struct VideoGameSpecifics {
    pub platforms: Vec<String>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "VisualNovelSpecificsInput")]
pub struct VisualNovelSpecifics {
    pub length: Option<i32>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "AnimeAiringScheduleSpecificsInput")]
pub struct AnimeAiringScheduleSpecifics {
    pub episode: i32,
    pub airing_at: NaiveDateTime,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "AnimeSpecificsInput")]
pub struct AnimeSpecifics {
    pub episodes: Option<i32>,
    pub airing_schedule: Option<Vec<AnimeAiringScheduleSpecifics>>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    Serialize,
    PartialEq,
    InputObject,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "MusicSpecificsInput")]
pub struct MusicSpecifics {
    pub duration: Option<i32>,
    pub view_count: Option<i32>,
    pub by_various_artists: Option<bool>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "MangaSpecificsInput")]
pub struct MangaSpecifics {
    pub chapters: Option<Decimal>,
    pub volumes: Option<i32>,
    pub url: Option<String>,
}

#[derive(PartialEq, Default, Eq, Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MetadataSearchItem {
    pub title: String,
    pub identifier: String,
    pub image: Option<String>,
    pub publish_year: Option<i32>,
}

#[derive(PartialEq, Default, Eq, Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct PeopleSearchItem {
    pub name: String,
    pub identifier: String,
    pub image: Option<String>,
    pub birth_year: Option<i32>,
}

#[derive(Debug, InputObject, Default)]
pub struct CreateOrUpdateReviewInput {
    pub rating: Option<Decimal>,
    pub text: Option<String>,
    pub visibility: Option<Visibility>,
    pub is_spoiler: Option<bool>,
    pub entity_id: String,
    pub entity_lot: EntityLot,
    pub date: Option<DateTimeUtc>,
    /// ID of the review if this is an update to an existing review
    pub review_id: Option<String>,
    pub show_season_number: Option<i32>,
    pub show_episode_number: Option<i32>,
    pub podcast_episode_number: Option<i32>,
    pub anime_episode_number: Option<i32>,
    pub manga_chapter_number: Option<Decimal>,
    pub manga_volume_number: Option<i32>,
}

#[derive(Debug, Default, Serialize, Deserialize, InputObject, Clone)]
pub struct ProgressUpdateInput {
    pub metadata_id: String,
    pub date: Option<NaiveDate>,
    pub progress: Option<Decimal>,
    #[graphql(skip_input)]
    pub start_date: Option<NaiveDate>,
    pub change_state: Option<SeenState>,
    pub show_season_number: Option<i32>,
    pub show_episode_number: Option<i32>,
    pub manga_volume_number: Option<i32>,
    pub anime_episode_number: Option<i32>,
    pub podcast_episode_number: Option<i32>,
    pub provider_watched_on: Option<String>,
    pub manga_chapter_number: Option<Decimal>,
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
pub enum ProgressUpdateErrorVariant {
    AlreadySeen,
    NoSeenInProgress,
    UpdateWithoutProgressUpdate,
}

#[derive(Debug, SimpleObject)]
pub struct ProgressUpdateError {
    pub error: ProgressUpdateErrorVariant,
}

#[derive(Union)]
pub enum ProgressUpdateResultUnion {
    Ok(StringIdObject),
    Error(ProgressUpdateError),
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, Eq, PartialEq, SimpleObject, Hash)]
pub struct PartialMetadataPerson {
    pub name: String,
    pub role: String,
    pub identifier: String,
    pub source: MediaSource,
    pub character: Option<String>,
    #[graphql(skip)]
    pub source_specifics: Option<PersonSourceSpecifics>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, SimpleObject, Hash)]
pub struct MetadataImageForMediaDetails {
    pub image: String,
}

#[derive(
    Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, SimpleObject, Default,
)]
pub struct WatchProvider {
    pub name: String,
    pub image: Option<String>,
    pub languages: HashSet<String>,
}

#[derive(
    Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, SimpleObject, Default,
)]
pub struct MetadataExternalIdentifiers {
    pub tvdb_id: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct MetadataDetails {
    pub lot: MediaLot,
    pub title: String,
    pub identifier: String,
    pub genres: Vec<String>,
    pub source: MediaSource,
    pub is_nsfw: Option<bool>,
    pub publish_year: Option<i32>,
    pub videos: Vec<MetadataVideo>,
    pub source_url: Option<String>,
    pub description: Option<String>,
    pub groups: Vec<CommitMediaInput>,
    pub publish_date: Option<NaiveDate>,
    pub provider_rating: Option<Decimal>,
    pub original_language: Option<String>,
    pub production_status: Option<String>,
    pub creators: Vec<MetadataFreeCreator>,
    pub people: Vec<PartialMetadataPerson>,
    pub watch_providers: Vec<WatchProvider>,
    pub show_specifics: Option<ShowSpecifics>,
    pub book_specifics: Option<BookSpecifics>,
    pub movie_specifics: Option<MovieSpecifics>,
    pub anime_specifics: Option<AnimeSpecifics>,
    pub manga_specifics: Option<MangaSpecifics>,
    pub music_specifics: Option<MusicSpecifics>,
    pub suggestions: Vec<PartialMetadataWithoutId>,
    pub podcast_specifics: Option<PodcastSpecifics>,
    pub s3_images: Vec<MetadataImageForMediaDetails>,
    pub url_images: Vec<MetadataImageForMediaDetails>,
    pub audio_book_specifics: Option<AudioBookSpecifics>,
    pub video_game_specifics: Option<VideoGameSpecifics>,
    pub visual_novel_specifics: Option<VisualNovelSpecifics>,
    pub external_identifiers: Option<MetadataExternalIdentifiers>,
}

/// A specific instance when an entity was seen.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Default, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportMetadataItemSeen {
    /// The progress of media done. If none, it is considered as done.
    pub progress: Option<Decimal>,
    /// The timestamp when started watching.
    pub started_on: Option<NaiveDate>,
    /// The timestamp when finished watching.
    pub ended_on: Option<NaiveDate>,
    /// If for a show, the season which was seen.
    pub show_season_number: Option<i32>,
    /// If for a show, the episode which was seen.
    pub show_episode_number: Option<i32>,
    /// If for a podcast, the episode which was seen.
    pub podcast_episode_number: Option<i32>,
    /// If for an anime, the episode which was seen.
    pub anime_episode_number: Option<i32>,
    /// If for a manga, the chapter which was seen.
    pub manga_chapter_number: Option<Decimal>,
    /// If for a manga, the volume which was seen.
    pub manga_volume_number: Option<i32>,
    /// The provider this item was watched on.
    pub provider_watched_on: Option<String>,
}

/// Review data associated to a rating.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Default, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportItemReview {
    /// The visibility set by the user.
    pub visibility: Option<Visibility>,
    /// The date the review was posted.
    pub date: Option<DateTimeUtc>,
    /// Whether to mark the review as a spoiler. Defaults to false.
    pub spoiler: Option<bool>,
    /// Actual text for the review.
    pub text: Option<String>,
}

/// A rating given to an entity.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Default, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportItemRating {
    /// Data about the review.
    pub review: Option<ImportOrExportItemReview>,
    /// The score of the review.
    pub rating: Option<Decimal>,
    /// If for a show, the season for which this review was for.
    pub show_season_number: Option<i32>,
    /// If for a show, the episode for which this review was for.
    pub show_episode_number: Option<i32>,
    /// If for a podcast, the episode for which this review was for.
    pub podcast_episode_number: Option<i32>,
    /// If for an anime, the episode for which this review was for.
    pub anime_episode_number: Option<i32>,
    /// If for a manga, the chapter for which this review was for.
    pub manga_chapter_number: Option<Decimal>,
    /// The comments attached to this review.
    pub comments: Option<Vec<ImportOrExportItemReviewComment>>,
}

/// Details about a specific media item that needs to be imported or exported.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Schematic, Default)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportMetadataItem {
    /// The type of media.
    pub lot: MediaLot,
    /// An string to help identify it in the original source.
    pub source_id: String,
    /// The provider identifier. For eg: TMDB-ID, Openlibrary ID and so on.
    pub identifier: String,
    /// The source of media.
    pub source: MediaSource,
    /// The collections this entity was added to.
    pub collections: Vec<String>,
    /// The review history for the user.
    pub reviews: Vec<ImportOrExportItemRating>,
    /// The seen history for the user.
    pub seen_history: Vec<ImportOrExportMetadataItemSeen>,
}

/// Details about a specific media group item that needs to be imported or exported.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Schematic, Default)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportMetadataGroupItem {
    /// Name of the group.
    pub title: String,
    /// The type of media.
    pub lot: MediaLot,
    /// The provider identifier. For eg: TMDB-ID, Openlibrary ID and so on.
    pub identifier: String,
    /// The source of media.
    pub source: MediaSource,
    /// The collections this entity was added to.
    pub collections: Vec<String>,
    /// The review history for the user.
    pub reviews: Vec<ImportOrExportItemRating>,
}

/// Details about a specific creator item that needs to be exported.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Schematic, Default)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportPersonItem {
    /// The name of the creator.
    pub name: String,
    /// The provider identifier.
    pub identifier: String,
    /// The source of data.
    pub source: MediaSource,
    /// The collections this entity was added to.
    pub collections: Vec<String>,
    /// The review history for the user.
    pub reviews: Vec<ImportOrExportItemRating>,
    /// The source specific data.
    pub source_specifics: Option<PersonSourceSpecifics>,
}

/// Details about a specific exercise item that needs to be exported.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportExerciseItem {
    /// The unique identifier of the exercise.
    pub id: String,
    /// The name of the exercise.
    pub name: String,
    /// The collections this entity was added to.
    pub collections: Vec<String>,
    /// The review history for the user.
    pub reviews: Vec<ImportOrExportItemRating>,
}

#[derive(
    Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default, Hash,
)]
pub struct MetadataImage {
    pub url: StoredUrl,
}

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    EnumIter,
    FromJsonQueryResult,
    Deserialize,
    Serialize,
    Hash,
    Default,
    Enum,
)]
pub enum MetadataVideoSource {
    #[default]
    Youtube,
    Dailymotion,
    Custom,
}

#[derive(
    Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default, Hash,
)]
pub struct MetadataVideo {
    pub identifier: StoredUrl,
    pub source: MetadataVideoSource,
}

/// Comments left in replies to posted reviews.
#[skip_serializing_none]
#[derive(
    Clone,
    Debug,
    PartialEq,
    FromJsonQueryResult,
    Eq,
    Serialize,
    Deserialize,
    Default,
    SimpleObject,
    Schematic,
)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportItemReviewComment {
    pub id: String,
    pub text: String,
    pub user: IdAndNamedObject,
    /// The user ids of all those who liked it.
    pub liked_by: HashSet<String>,
    pub created_on: DateTimeUtc,
}

#[derive(
    Eq,
    Hash,
    Clone,
    Debug,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
pub struct MetadataFreeCreator {
    pub name: String,
    pub role: String,
    pub image: Option<String>,
}

#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
)]
pub struct SeenShowExtraInformation {
    pub season: i32,
    pub episode: i32,
}

#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
)]
pub struct SeenPodcastExtraInformation {
    pub episode: i32,
}

#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
)]
pub struct SeenShowExtraOptionalInformation {
    pub season: Option<i32>,
    pub episode: Option<i32>,
}

#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
)]
pub struct SeenPodcastExtraOptionalInformation {
    pub episode: Option<i32>,
}

#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
)]
pub struct SeenAnimeExtraInformation {
    pub episode: Option<i32>,
}

#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject, FromJsonQueryResult,
)]
pub struct SeenMangaExtraInformation {
    pub chapter: Option<Decimal>,
    pub volume: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReviewPostedEvent {
    pub obj_id: String,
    pub obj_title: String,
    pub username: String,
    pub review_id: String,
    pub entity_lot: EntityLot,
}

#[boilermates("PartialMetadataWithoutId")]
#[boilermates(attr_for(
    "PartialMetadataWithoutId",
    "#[derive(Clone, Default, Eq, PartialEq, Debug, Serialize, Deserialize, Hash)]"
))]
#[derive(Clone, Eq, PartialEq, Debug, Serialize, Deserialize, Hash)]
pub struct PartialMetadata {
    #[boilermates(not_in("PartialMetadataWithoutId"))]
    pub id: String,
    pub lot: MediaLot,
    pub title: String,
    pub identifier: String,
    pub source: MediaSource,
    pub image: Option<String>,
    pub is_recommendation: Option<bool>,
}

#[derive(Clone, Eq, PartialEq, Debug, Serialize, Deserialize, SimpleObject, FromQueryResult)]
pub struct MetadataPartialDetails {
    pub id: String,
    pub title: String,
    pub lot: MediaLot,
    #[sea_orm(ignore)]
    pub image: Option<String>,
    #[graphql(skip)]
    pub images: Option<Vec<MetadataImage>>,
    pub publish_year: Option<i32>,
}

#[derive(Debug, InputObject)]
pub struct CommitPersonInput {
    pub name: String,
    pub identifier: String,
    pub source: MediaSource,
    pub source_specifics: Option<PersonSourceSpecifics>,
}

#[derive(PartialEq, Default, Eq, Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MetadataGroupSearchItem {
    pub name: String,
    pub identifier: String,
    pub parts: Option<usize>,
    pub image: Option<String>,
}

#[skip_serializing_none]
#[derive(
    Debug,
    Serialize,
    Deserialize,
    Clone,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Default,
    InputObject,
    Hash,
)]
pub struct UniqueMediaIdentifier {
    pub lot: MediaLot,
    pub identifier: String,
    pub source: MediaSource,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Hash,
    Clone,
    Debug,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    FromJsonQueryResult,
)]
pub struct CommitMediaInput {
    pub name: String,
    pub unique: UniqueMediaIdentifier,
}

#[derive(
    Debug, Serialize, Deserialize, Clone, FromJsonQueryResult, Eq, PartialEq, Default, Hash,
)]
pub struct MediaAssociatedPersonStateChanges {
    pub role: String,
    pub media: UniqueMediaIdentifier,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromJsonQueryResult, Eq, PartialEq, Default)]
pub struct PersonStateChanges {
    pub metadata_associated: HashSet<MediaAssociatedPersonStateChanges>,
    pub metadata_groups_associated: HashSet<MediaAssociatedPersonStateChanges>,
}

#[skip_serializing_none]
#[derive(
    Debug,
    Serialize,
    Deserialize,
    InputObject,
    Clone,
    SimpleObject,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Hash,
    Default,
    Schematic,
)]
#[graphql(input_name = "IntegrationSourceSpecificsInput")]
#[serde(rename_all = "snake_case")]
pub struct IntegrationProviderSpecifics {
    pub plex_yank_base_url: Option<String>,
    pub plex_yank_token: Option<String>,

    pub plex_sink_username: Option<String>,

    pub audiobookshelf_base_url: Option<String>,
    pub audiobookshelf_token: Option<String>,

    pub komga_base_url: Option<String>,
    pub komga_username: Option<String>,
    pub komga_password: Option<String>,
    pub komga_provider: Option<MediaSource>,

    pub radarr_base_url: Option<String>,
    pub radarr_api_key: Option<String>,
    pub radarr_profile_id: Option<i32>,
    pub radarr_root_folder_path: Option<String>,
    pub radarr_sync_collection_ids: Option<Vec<String>>,

    pub sonarr_base_url: Option<String>,
    pub sonarr_api_key: Option<String>,
    pub sonarr_profile_id: Option<i32>,
    pub sonarr_root_folder_path: Option<String>,
    pub sonarr_sync_collection_ids: Option<Vec<String>>,

    pub jellyfin_push_base_url: Option<String>,
    pub jellyfin_push_username: Option<String>,
    pub jellyfin_push_password: Option<String>,

    pub youtube_music_auth_cookie: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, SimpleObject)]
pub struct ReviewItem {
    pub id: String,
    pub is_spoiler: bool,
    pub posted_on: DateTimeUtc,
    pub visibility: Visibility,
    pub rating: Option<Decimal>,
    pub posted_by: IdAndNamedObject,
    pub text_original: Option<String>,
    pub text_rendered: Option<String>,
    pub seen_items_associated_with: Vec<String>,
    pub comments: Vec<ImportOrExportItemReviewComment>,
    pub anime_extra_information: Option<SeenAnimeExtraInformation>,
    pub manga_extra_information: Option<SeenMangaExtraInformation>,
    pub show_extra_information: Option<SeenShowExtraOptionalInformation>,
    pub podcast_extra_information: Option<SeenPodcastExtraOptionalInformation>,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployGenericCsvImportInput {
    // The file path of the uploaded CSV export file.
    pub csv_path: String,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployTraktImportInput {
    // The public username in Trakt.
    pub username: String,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployMovaryImportInput {
    // The file path of the uploaded CSV history file.
    pub history: String,
    // The file path of the uploaded CSV ratings file.
    pub ratings: String,
    // The file path of the uploaded CSV watchlist file.
    pub watchlist: String,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployMalImportInput {
    /// The anime export file path (uploaded via temporary upload).
    pub anime_path: Option<String>,
    /// The manga export file path (uploaded via temporary upload).
    pub manga_path: Option<String>,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployStrongAppImportInput {
    pub data_export_path: Option<String>,
    pub measurements_zip_path: Option<String>,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployIgdbImportInput {
    // The path to the CSV file in the local file system.
    pub csv_path: String,
    pub collection: String,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployJsonImportInput {
    // The file path of the uploaded JSON export.
    pub export: String,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployUrlAndKeyImportInput {
    pub api_url: String,
    pub api_key: String,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployUrlAndKeyAndUsernameImportInput {
    pub api_url: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployImportJobInput {
    pub source: ImportSource,
    pub mal: Option<DeployMalImportInput>,
    pub igdb: Option<DeployIgdbImportInput>,
    pub trakt: Option<DeployTraktImportInput>,
    pub movary: Option<DeployMovaryImportInput>,
    pub generic_json: Option<DeployJsonImportInput>,
    pub strong_app: Option<DeployStrongAppImportInput>,
    pub url_and_key: Option<DeployUrlAndKeyImportInput>,
    pub generic_csv: Option<DeployGenericCsvImportInput>,
    pub jellyfin: Option<DeployUrlAndKeyAndUsernameImportInput>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct CreateCustomMetadataInput {
    pub title: String,
    pub lot: MediaLot,
    pub is_nsfw: Option<bool>,
    pub publish_year: Option<i32>,
    pub description: Option<String>,
    pub genres: Option<Vec<String>>,
    pub images: Option<Vec<String>>,
    pub videos: Option<Vec<String>>,
    pub creators: Option<Vec<String>>,
    pub show_specifics: Option<ShowSpecifics>,
    pub book_specifics: Option<BookSpecifics>,
    pub music_specifics: Option<MusicSpecifics>,
    pub movie_specifics: Option<MovieSpecifics>,
    pub manga_specifics: Option<MangaSpecifics>,
    pub anime_specifics: Option<AnimeSpecifics>,
    pub podcast_specifics: Option<PodcastSpecifics>,
    pub audio_book_specifics: Option<AudioBookSpecifics>,
    pub video_game_specifics: Option<VideoGameSpecifics>,
    pub visual_novel_specifics: Option<VisualNovelSpecifics>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct UpdateCustomMetadataInput {
    pub existing_metadata_id: String,
    pub update: CreateCustomMetadataInput,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct CreateUserIntegrationInput {
    pub provider: IntegrationProvider,
    pub provider_specifics: Option<IntegrationProviderSpecifics>,
    pub minimum_progress: Option<Decimal>,
    pub maximum_progress: Option<Decimal>,
    pub sync_to_owned_collection: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct UpdateUserIntegrationInput {
    pub integration_id: String,
    pub is_disabled: Option<bool>,
    pub minimum_progress: Option<Decimal>,
    pub maximum_progress: Option<Decimal>,
    pub sync_to_owned_collection: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct CreateUserNotificationPlatformInput {
    pub lot: NotificationPlatformLot,
    pub base_url: Option<String>,
    #[graphql(secret)]
    pub api_token: Option<String>,
    #[graphql(secret)]
    pub auth_header: Option<String>,
    pub priority: Option<i32>,
    pub chat_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct UpdateUserNotificationPlatformInput {
    pub notification_id: String,
    pub is_disabled: Option<bool>,
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
pub enum CreateCustomMediaErrorVariant {
    LotDoesNotMatchSpecifics,
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
pub enum UserDetailsErrorVariant {
    AuthTokenInvalid,
}

#[derive(Debug, SimpleObject)]
pub struct UserDetailsError {
    pub error: UserDetailsErrorVariant,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct PasswordUserInput {
    pub username: String,
    #[graphql(secret)]
    pub password: String,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct OidcUserInput {
    pub email: String,
    #[graphql(secret)]
    pub issuer_id: String,
}

#[derive(Debug, Serialize, Deserialize, OneofObject, Clone)]
pub enum AuthUserInput {
    Password(PasswordUserInput),
    Oidc(OidcUserInput),
}

#[derive(Debug, InputObject)]
pub struct RegisterUserInput {
    pub data: AuthUserInput,
    /// If registration is disabled, this can be used to override it.
    pub admin_access_token: Option<String>,
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
pub enum RegisterErrorVariant {
    IdentifierAlreadyExists,
    Disabled,
}

#[derive(Debug, SimpleObject)]
pub struct RegisterError {
    pub error: RegisterErrorVariant,
}

#[derive(Union)]
pub enum RegisterResult {
    Ok(StringIdObject),
    Error(RegisterError),
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
pub enum LoginErrorVariant {
    AccountDisabled,
    UsernameDoesNotExist,
    CredentialsMismatch,
    IncorrectProviderChosen,
}

#[derive(Debug, SimpleObject)]
pub struct LoginError {
    pub error: LoginErrorVariant,
}

#[derive(Debug, SimpleObject)]
pub struct LoginResponse {
    pub api_key: String,
}

#[derive(Union)]
pub enum LoginResult {
    Ok(LoginResponse),
    Error(LoginError),
}

#[derive(Debug, InputObject)]
pub struct GenreDetailsInput {
    pub genre_id: String,
    pub page: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum CollectionContentsSortBy {
    Title,
    #[default]
    LastUpdatedOn,
    Date,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct CollectionContentsFilter {
    pub entity_lot: Option<EntityLot>,
    pub metadata_lot: Option<MediaLot>,
}

#[derive(Debug, InputObject)]
pub struct CollectionContentsInput {
    pub collection_id: String,
    pub search: Option<SearchInput>,
    pub filter: Option<CollectionContentsFilter>,
    pub sort: Option<SortInput<CollectionContentsSortBy>>,
}

#[derive(Debug, Clone, SimpleObject, FromQueryResult, PartialEq, Eq, Serialize, Deserialize)]
pub struct CollectionItem {
    pub id: String,
    pub count: i64,
    pub name: String,
    pub is_default: bool,
    pub creator: IdAndNamedObject,
    pub description: Option<String>,
    pub collaborators: Vec<IdAndNamedObject>,
    pub information_template: Option<Vec<CollectionExtraInformation>>,
}

#[derive(Debug, Default, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MetadataCreator {
    pub name: String,
    pub id: Option<String>,
    pub image: Option<String>,
    pub character: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MetadataCreatorGroupedByRole {
    pub name: String,
    pub items: Vec<MetadataCreator>,
}

#[derive(Debug, Serialize, Default, Deserialize, SimpleObject, Clone)]
pub struct PersonDetailsItemWithCharacter {
    pub entity_id: String,
    pub character: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct PersonDetailsGroupedByRole {
    /// The number of items in this role.
    pub count: usize,
    /// The name of the role performed.
    pub name: String,
    /// The media items in which this role was performed.
    pub items: Vec<PersonDetailsItemWithCharacter>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct GraphqlMetadataGroup {
    pub id: String,
    pub name: String,
    pub part: i32,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct GraphqlVideoAsset {
    pub video_id: String,
    pub source: MetadataVideoSource,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct GraphqlMediaAssets {
    pub images: Vec<String>,
    pub videos: Vec<GraphqlVideoAsset>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct GraphqlMetadataDetails {
    pub id: String,
    pub title: String,
    pub lot: MediaLot,
    pub identifier: String,
    pub source: MediaSource,
    pub is_nsfw: Option<bool>,
    pub is_partial: Option<bool>,
    pub suggestions: Vec<String>,
    pub publish_year: Option<i32>,
    pub source_url: Option<String>,
    pub genres: Vec<GenreListItem>,
    pub assets: GraphqlMediaAssets,
    pub description: Option<String>,
    pub publish_date: Option<NaiveDate>,
    pub group: Vec<GraphqlMetadataGroup>,
    pub provider_rating: Option<Decimal>,
    pub original_language: Option<String>,
    pub production_status: Option<String>,
    pub created_by_user_id: Option<String>,
    pub watch_providers: Vec<WatchProvider>,
    pub show_specifics: Option<ShowSpecifics>,
    pub book_specifics: Option<BookSpecifics>,
    pub movie_specifics: Option<MovieSpecifics>,
    pub music_specifics: Option<MusicSpecifics>,
    pub manga_specifics: Option<MangaSpecifics>,
    pub anime_specifics: Option<AnimeSpecifics>,
    pub podcast_specifics: Option<PodcastSpecifics>,
    pub creators: Vec<MetadataCreatorGroupedByRole>,
    pub audio_book_specifics: Option<AudioBookSpecifics>,
    pub video_game_specifics: Option<VideoGameSpecifics>,
    #[graphql(skip)]
    pub external_identifiers: Option<MetadataExternalIdentifiers>,
    pub visual_novel_specifics: Option<VisualNovelSpecifics>,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum GraphqlSortOrder {
    Desc,
    #[default]
    Asc,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum MediaSortBy {
    LastUpdated,
    Title,
    #[default]
    ReleaseDate,
    LastSeen,
    UserRating,
    ProviderRating,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum PersonAndMetadataGroupsSortBy {
    #[default]
    Name,
    MediaItems,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone, Default)]
#[graphql(concrete(name = "MediaSortInput", params(MediaSortBy)))]
#[graphql(concrete(name = "PersonSortInput", params(PersonAndMetadataGroupsSortBy)))]
#[graphql(concrete(name = "CollectionContentsSortInput", params(CollectionContentsSortBy)))]
pub struct SortInput<T: InputType + Default> {
    #[graphql(default)]
    pub order: GraphqlSortOrder,
    #[graphql(default)]
    pub by: T,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, Copy, Eq, PartialEq, Default)]
pub enum MediaGeneralFilter {
    #[default]
    All,
    Rated,
    Unrated,
    Dropped,
    OnAHold,
    Unfinished,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct MediaFilter {
    pub collections: Option<Vec<String>>,
    pub general: Option<MediaGeneralFilter>,
    pub date_range: Option<ApplicationDateRange>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct MetadataListInput {
    pub lot: Option<MediaLot>,
    pub filter: Option<MediaFilter>,
    pub search: Option<SearchInput>,
    pub invert_collection: Option<bool>,
    pub sort: Option<SortInput<MediaSortBy>>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct PeopleListInput {
    pub search: Option<SearchInput>,
    pub filter: Option<MediaFilter>,
    pub invert_collection: Option<bool>,
    pub sort: Option<SortInput<PersonAndMetadataGroupsSortBy>>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct MetadataGroupsListInput {
    pub search: Option<SearchInput>,
    pub filter: Option<MediaFilter>,
    pub invert_collection: Option<bool>,
    pub sort: Option<SortInput<PersonAndMetadataGroupsSortBy>>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MediaConsumedInput {
    pub identifier: String,
    pub lot: MediaLot,
}

#[derive(SimpleObject, Debug)]
pub struct UserMetadataDetailsEpisodeProgress {
    pub times_seen: usize,
    pub episode_number: i32,
}

#[derive(SimpleObject, Debug)]
pub struct UserMetadataDetailsShowSeasonProgress {
    pub times_seen: usize,
    pub season_number: i32,
    pub episodes: Vec<UserMetadataDetailsEpisodeProgress>,
}

#[derive(SimpleObject, Debug, Clone, Default)]
pub struct UserMediaNextEntry {
    pub season: Option<i32>,
    pub volume: Option<i32>,
    pub chapter: Option<Decimal>,
    pub episode: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct UpdateSeenItemInput {
    pub seen_id: String,
    pub review_id: Option<String>,
    pub started_on: Option<NaiveDate>,
    pub finished_on: Option<NaiveDate>,
    pub manual_time_spent: Option<Decimal>,
    pub provider_watched_on: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MarkEntityAsPartialInput {
    pub entity_id: String,
    pub entity_lot: EntityLot,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct PresignedPutUrlResponse {
    pub upload_url: String,
    pub key: String,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct CreateReviewCommentInput {
    /// The review this comment belongs to.
    pub review_id: String,
    pub comment_id: Option<String>,
    pub text: Option<String>,
    pub increment_likes: Option<bool>,
    pub decrement_likes: Option<bool>,
    pub should_delete: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, Default)]
pub struct GraphqlCalendarEvent {
    pub date: NaiveDate,
    pub metadata_id: String,
    pub metadata_title: String,
    pub metadata_lot: MediaLot,
    pub calendar_event_id: String,
    pub episode_name: Option<String>,
    pub metadata_image: Option<String>,
    pub show_extra_information: Option<SeenShowExtraInformation>,
    pub podcast_extra_information: Option<SeenPodcastExtraInformation>,
    pub anime_extra_information: Option<SeenAnimeExtraInformation>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, Default)]
pub struct OidcTokenOutput {
    pub subject: String,
    pub email: String,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct UserCalendarEventInput {
    pub year: i32,
    pub month: u32,
}

#[derive(Debug, Serialize, Deserialize, OneofObject, Clone)]
pub enum UserUpcomingCalendarEventInput {
    /// The number of media to select
    NextMedia(u64),
    /// The number of days to select
    NextDays(u64),
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct PresignedPutUrlInput {
    pub file_name: String,
    pub prefix: String,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, Default)]
pub struct GroupedCalendarEvent {
    pub events: Vec<GraphqlCalendarEvent>,
    pub date: NaiveDate,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct CreateAccessLinkInput {
    pub name: String,
    pub maximum_uses: Option<i32>,
    pub expires_on: Option<DateTimeUtc>,
    pub redirect_to: Option<String>,
    pub is_mutation_allowed: Option<bool>,
    pub is_account_default: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, OneofObject, Clone)]
pub enum ProcessAccessLinkInput {
    Id(String),
    Username(String),
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
pub enum ProcessAccessLinkErrorVariant {
    Expired,
    Revoked,
    NotFound,
    MaximumUsesReached,
}

#[derive(Debug, SimpleObject)]
pub struct ProcessAccessLinkError {
    pub error: ProcessAccessLinkErrorVariant,
}

#[derive(Debug, SimpleObject)]
pub struct ProcessAccessLinkResponse {
    pub api_key: String,
    pub token_valid_for_days: i32,
    pub redirect_to: Option<String>,
}

#[derive(Union)]
pub enum ProcessAccessLinkResult {
    Ok(ProcessAccessLinkResponse),
    Error(ProcessAccessLinkError),
}
