use std::{collections::HashSet, fmt, sync::Arc};

use async_graphql::{Enum, InputObject, InputType, OneofObject, SimpleObject, Union};
use boilermates::boilermates;
use chrono::{DateTime, NaiveDate, NaiveDateTime};
use common_models::{
    CollectionExtraInformation, IdAndNamedObject, SearchInput, StoredUrl, StringIdObject,
};
use enums::{
    EntityLot, ImportSource, IntegrationProvider, MediaLot, MediaSource, NotificationPlatformLot,
    SeenState, UserLot, Visibility,
};
use file_storage_service::FileStorageService;
use rust_decimal::Decimal;
use schematic::Schematic;
use sea_orm::{
    prelude::{Date, DateTimeUtc},
    EnumIter, FromJsonQueryResult, FromQueryResult, Order,
};
use serde::{de, Deserialize, Serialize};
use serde_with::skip_serializing_none;
use strum::Display;

#[derive(Debug, SimpleObject, Serialize, Deserialize, Clone)]
pub struct EntityWithLot {
    pub entity_id: String,
    pub entity_lot: EntityLot,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MetadataSearchItemResponse {
    pub item: MetadataSearchItem,
    /// Whether the user has interacted with this media item.
    pub has_interacted: bool,
    pub database_id: Option<String>,
}

#[derive(Debug, InputObject, Default, Clone)]
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

#[derive(
    Debug,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    InputObject,
    PartialEq,
    Eq,
    Default,
    FromJsonQueryResult,
)]
#[graphql(input_name = "AudioBookSpecificsInput")]
pub struct AudioBookSpecifics {
    pub runtime: Option<i32>,
}

#[derive(
    Debug,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    InputObject,
    PartialEq,
    Eq,
    Default,
    FromJsonQueryResult,
)]
#[graphql(input_name = "BookSpecificsInput")]
pub struct BookSpecifics {
    pub pages: Option<i32>,
}

#[derive(
    Debug,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    InputObject,
    Eq,
    PartialEq,
    Default,
    FromJsonQueryResult,
)]
#[graphql(input_name = "MovieSpecificsInput")]
pub struct MovieSpecifics {
    pub runtime: Option<i32>,
}

#[derive(
    Debug,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    InputObject,
)]
#[graphql(input_name = "PodcastSpecificsInput")]
pub struct PodcastSpecifics {
    pub episodes: Vec<PodcastEpisode>,
    pub total_episodes: usize,
}

impl PodcastSpecifics {
    pub fn episode_by_number(&self, episode_number: i32) -> Option<&PodcastEpisode> {
        self.episodes.iter().find(|e| e.number == episode_number)
    }

    pub fn episode_by_name(&self, name: &str) -> Option<i32> {
        self.episodes
            .iter()
            .find(|e| e.title == name)
            .map(|e| e.number)
    }
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    InputObject,
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

fn deserialize_date<'de, D>(deserializer: D) -> Result<NaiveDate, D::Error>
where
    D: de::Deserializer<'de>,
{
    struct JsonStringVisitor;

    impl<'de> de::Visitor<'de> for JsonStringVisitor {
        type Value = NaiveDate;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a number")
        }

        fn visit_u64<E>(self, v: u64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            DateTime::from_timestamp_millis(v.try_into().unwrap())
                .ok_or_else(|| E::custom("Could not convert timestamp"))
                .map(|d| d.date_naive())
        }

        fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            NaiveDate::parse_from_str(v, "%Y-%m-%d")
                .map_err(|_| E::custom("Could not convert timestamp"))
        }
    }

    deserializer.deserialize_any(JsonStringVisitor)
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    InputObject,
)]
#[graphql(input_name = "ShowSpecificsInput")]
pub struct ShowSpecifics {
    pub seasons: Vec<ShowSeason>,
    pub runtime: Option<i32>,
    pub total_seasons: Option<usize>,
    pub total_episodes: Option<usize>,
}

impl ShowSpecifics {
    pub fn get_episode(
        &self,
        season_number: i32,
        episode_number: i32,
    ) -> Option<(&ShowSeason, &ShowEpisode)> {
        self.seasons
            .iter()
            .find(|s| s.season_number == season_number)
            .and_then(|s| {
                s.episodes
                    .iter()
                    .find(|e| e.episode_number == episode_number)
                    .map(|e| (s, e))
            })
    }
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    Hash,
    InputObject,
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

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    Hash,
    InputObject,
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

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    InputObject,
)]
#[graphql(input_name = "VideoGameSpecificsInput")]
pub struct VideoGameSpecifics {
    pub platforms: Vec<String>,
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    InputObject,
)]
#[graphql(input_name = "VisualNovelSpecificsInput")]
pub struct VisualNovelSpecifics {
    pub length: Option<i32>,
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    InputObject,
)]
#[graphql(input_name = "AnimeAiringScheduleSpecificsInput")]
pub struct AnimeAiringScheduleSpecifics {
    pub episode: i32,
    pub airing_at: NaiveDateTime,
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    InputObject,
)]
#[graphql(input_name = "AnimeSpecificsInput")]
pub struct AnimeSpecifics {
    pub episodes: Option<i32>,
    pub airing_schedule: Option<Vec<AnimeAiringScheduleSpecifics>>,
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    InputObject,
)]
#[graphql(input_name = "MangaSpecificsInput")]
pub struct MangaSpecifics {
    pub chapters: Option<Decimal>,
    pub volumes: Option<i32>,
    pub url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MetadataSearchItem {
    pub identifier: String,
    pub title: String,
    pub image: Option<String>,
    pub publish_year: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct PeopleSearchItem {
    pub identifier: String,
    pub name: String,
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

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct ProgressUpdateInput {
    pub metadata_id: String,
    pub date: Option<NaiveDate>,
    pub progress: Option<Decimal>,
    pub change_state: Option<SeenState>,
    pub show_season_number: Option<i32>,
    pub show_episode_number: Option<i32>,
    pub manga_volume_number: Option<i32>,
    pub anime_episode_number: Option<i32>,
    pub podcast_episode_number: Option<i32>,
    pub manga_chapter_number: Option<Decimal>,
    pub provider_watched_on: Option<String>,
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
#[graphql(input_name = "PersonSourceSpecificsInput")]
#[serde(rename_all = "snake_case")]
pub struct PersonSourceSpecifics {
    pub is_tmdb_company: Option<bool>,
    pub is_anilist_studio: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, SimpleObject, Hash)]
pub struct PartialMetadataPerson {
    pub name: String,
    pub identifier: String,
    pub source: MediaSource,
    pub role: String,
    pub character: Option<String>,
    #[graphql(skip)]
    pub source_specifics: Option<PersonSourceSpecifics>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Hash)]
pub struct MetadataPerson {
    pub identifier: String,
    pub source: MediaSource,
    pub name: String,
    pub description: Option<String>,
    pub images: Option<Vec<String>>,
    pub gender: Option<String>,
    pub death_date: Option<NaiveDate>,
    pub birth_date: Option<NaiveDate>,
    pub place: Option<String>,
    pub website: Option<String>,
    pub related: Vec<(String, PartialMetadataWithoutId)>,
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
pub struct ExternalIdentifiers {
    pub tvdb_id: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct MediaDetails {
    pub identifier: String,
    pub is_nsfw: Option<bool>,
    pub title: String,
    pub source: MediaSource,
    pub description: Option<String>,
    pub original_language: Option<String>,
    pub lot: MediaLot,
    pub production_status: Option<String>,
    pub creators: Vec<MetadataFreeCreator>,
    pub people: Vec<PartialMetadataPerson>,
    pub genres: Vec<String>,
    pub url_images: Vec<MetadataImageForMediaDetails>,
    pub s3_images: Vec<MetadataImageForMediaDetails>,
    pub videos: Vec<MetadataVideo>,
    pub publish_year: Option<i32>,
    pub publish_date: Option<NaiveDate>,
    pub suggestions: Vec<PartialMetadataWithoutId>,
    pub group_identifiers: Vec<String>,
    pub provider_rating: Option<Decimal>,
    pub watch_providers: Vec<WatchProvider>,
    pub audio_book_specifics: Option<AudioBookSpecifics>,
    pub book_specifics: Option<BookSpecifics>,
    pub external_identifiers: Option<ExternalIdentifiers>,
    pub movie_specifics: Option<MovieSpecifics>,
    pub podcast_specifics: Option<PodcastSpecifics>,
    pub show_specifics: Option<ShowSpecifics>,
    pub video_game_specifics: Option<VideoGameSpecifics>,
    pub visual_novel_specifics: Option<VisualNovelSpecifics>,
    pub anime_specifics: Option<AnimeSpecifics>,
    pub manga_specifics: Option<MangaSpecifics>,
}

/// A specific instance when an entity was seen.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Default, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportMediaItemSeen {
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
#[derive(Debug, Serialize, Deserialize, Clone, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportMediaItem {
    /// An string to help identify it in the original source.
    pub source_id: String,
    /// The type of media.
    pub lot: MediaLot,
    /// The source of media.
    pub source: MediaSource,
    /// The provider identifier. For eg: TMDB-ID, Openlibrary ID and so on.
    pub identifier: String,
    /// The seen history for the user.
    pub seen_history: Vec<ImportOrExportMediaItemSeen>,
    /// The review history for the user.
    pub reviews: Vec<ImportOrExportItemRating>,
    /// The collections this entity was added to.
    pub collections: Vec<String>,
}

/// Details about a specific media group item that needs to be imported or exported.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportMediaGroupItem {
    /// Name of the group.
    pub title: String,
    /// The type of media.
    pub lot: MediaLot,
    /// The source of media.
    pub source: MediaSource,
    /// The provider identifier. For eg: TMDB-ID, Openlibrary ID and so on.
    pub identifier: String,
    /// The review history for the user.
    pub reviews: Vec<ImportOrExportItemRating>,
    /// The collections this entity was added to.
    pub collections: Vec<String>,
}

/// Details about a specific creator item that needs to be exported.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportPersonItem {
    /// The provider identifier.
    pub identifier: String,
    /// The source of data.
    pub source: MediaSource,
    /// The source specific data.
    pub source_specifics: Option<PersonSourceSpecifics>,
    /// The name of the creator.
    pub name: String,
    /// The review history for the user.
    pub reviews: Vec<ImportOrExportItemRating>,
    /// The collections this entity was added to.
    pub collections: Vec<String>,
}

/// Details about a specific exercise item that needs to be exported.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportExerciseItem {
    /// The name of the exercise.
    pub name: String,
    /// The review history for the user.
    pub reviews: Vec<ImportOrExportItemRating>,
    /// The collections this entity was added to.
    pub collections: Vec<String>,
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

pub async fn first_metadata_image_as_url(
    value: &Option<Vec<MetadataImage>>,
    file_storage_service: &Arc<FileStorageService>,
) -> Option<String> {
    if let Some(images) = value {
        if let Some(i) = images.first().cloned() {
            Some(file_storage_service.get_stored_asset(i.url).await)
        } else {
            None
        }
    } else {
        None
    }
}

pub async fn metadata_images_as_urls(
    value: &Option<Vec<MetadataImage>>,
    file_storage_service: &Arc<FileStorageService>,
) -> Vec<String> {
    let mut images = vec![];
    if let Some(imgs) = value {
        for i in imgs.clone() {
            images.push(file_storage_service.get_stored_asset(i.url).await);
        }
    }
    images
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
    Clone,
    Debug,
    PartialEq,
    FromJsonQueryResult,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Default,
    Hash,
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
    "#[derive(Clone, Eq, PartialEq, Debug, Serialize, Deserialize, Hash)]"
))]
#[derive(Clone, Eq, PartialEq, Debug, Serialize, Deserialize, Hash)]
pub struct PartialMetadata {
    #[boilermates(not_in("PartialMetadataWithoutId"))]
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub image: Option<String>,
    pub lot: MediaLot,
    pub source: MediaSource,
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
    pub source: MediaSource,
    pub identifier: String,
    pub source_specifics: Option<PersonSourceSpecifics>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MetadataGroupSearchItem {
    pub name: String,
    pub identifier: String,
    pub image: Option<String>,
    pub parts: Option<usize>,
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
pub struct CommitMediaInput {
    pub lot: MediaLot,
    pub source: MediaSource,
    pub identifier: String,
    pub force_update: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromJsonQueryResult, Eq, PartialEq, Default)]
pub struct MetadataStateChanges {}

#[derive(
    Debug, Serialize, Deserialize, Clone, FromJsonQueryResult, Eq, PartialEq, Default, Hash,
)]
pub struct MediaAssociatedPersonStateChanges {
    pub media: CommitMediaInput,
    pub role: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromJsonQueryResult, Eq, PartialEq, Default)]
pub struct PersonStateChanges {
    pub media_associated: HashSet<MediaAssociatedPersonStateChanges>,
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
    pub plex_username: Option<String>,
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
    pub show_extra_information: Option<SeenShowExtraInformation>,
    pub podcast_extra_information: Option<SeenPodcastExtraInformation>,
    pub anime_extra_information: Option<SeenAnimeExtraInformation>,
    pub manga_extra_information: Option<SeenMangaExtraInformation>,
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
pub struct StrongAppImportMapping {
    pub source_name: String,
    pub target_name: String,
    pub multiplier: Option<Decimal>,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployStrongAppImportInput {
    // The path to the CSV file in the local file system.
    pub export_path: String,
    pub mapping: Vec<StrongAppImportMapping>,
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IntegrationMediaSeen {
    pub identifier: String,
    pub lot: MediaLot,
    #[serde(default)]
    pub source: MediaSource,
    pub progress: Decimal,
    pub show_season_number: Option<i32>,
    pub show_episode_number: Option<i32>,
    pub podcast_episode_number: Option<i32>,
    pub anime_episode_number: Option<i32>,
    pub manga_chapter_number: Option<Decimal>,
    pub manga_volume_number: Option<i32>,
    pub provider_watched_on: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IntegrationMediaCollection {
    pub identifier: String,
    pub lot: MediaLot,
    pub source: MediaSource,
    pub collection: String,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct CreateCustomMetadataInput {
    pub title: String,
    pub lot: MediaLot,
    pub description: Option<String>,
    pub creators: Option<Vec<String>>,
    pub genres: Option<Vec<String>>,
    pub images: Option<Vec<String>>,
    pub videos: Option<Vec<String>>,
    pub is_nsfw: Option<bool>,
    pub publish_year: Option<i32>,
    pub audio_book_specifics: Option<AudioBookSpecifics>,
    pub book_specifics: Option<BookSpecifics>,
    pub movie_specifics: Option<MovieSpecifics>,
    pub podcast_specifics: Option<PodcastSpecifics>,
    pub show_specifics: Option<ShowSpecifics>,
    pub video_game_specifics: Option<VideoGameSpecifics>,
    pub manga_specifics: Option<MangaSpecifics>,
    pub anime_specifics: Option<AnimeSpecifics>,
    pub visual_novel_specifics: Option<VisualNovelSpecifics>,
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

#[derive(Debug, SimpleObject)]
pub struct ProviderLanguageInformation {
    pub source: MediaSource,
    pub supported: Vec<String>,
    pub default: String,
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
pub struct UpdateUserInput {
    pub user_id: String,
    pub is_disabled: Option<bool>,
    pub lot: Option<UserLot>,
    #[graphql(secret)]
    pub password: Option<String>,
    pub username: Option<String>,
    pub extra_information: Option<serde_json::Value>,
    pub admin_access_token: Option<String>,
}

#[derive(Debug, InputObject)]
pub struct UpdateUserPreferenceInput {
    /// Dot delimited path to the property that needs to be changed. Setting it\
    /// to empty resets the preferences to default.
    pub property: String,
    pub value: String,
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
    pub take: Option<u64>,
    pub sort: Option<SortInput<CollectionContentsSortBy>>,
}

#[derive(Debug, SimpleObject, FromQueryResult)]
pub struct CollectionItem {
    pub id: String,
    pub name: String,
    pub count: i64,
    pub is_default: bool,
    pub description: Option<String>,
    pub information_template: Option<Vec<CollectionExtraInformation>>,
    pub creator: IdAndNamedObject,
    pub collaborators: Vec<IdAndNamedObject>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MetadataCreator {
    pub id: Option<String>,
    pub name: String,
    pub image: Option<String>,
    pub character: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MetadataCreatorGroupedByRole {
    pub name: String,
    pub items: Vec<MetadataCreator>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct PersonDetailsItemWithCharacter {
    pub media_id: String,
    pub character: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct PersonDetailsGroupedByRole {
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
    pub identifier: String,
    pub is_nsfw: Option<bool>,
    pub is_partial: Option<bool>,
    pub description: Option<String>,
    pub original_language: Option<String>,
    pub provider_rating: Option<Decimal>,
    pub production_status: Option<String>,
    pub lot: MediaLot,
    pub source: MediaSource,
    pub creators: Vec<MetadataCreatorGroupedByRole>,
    pub watch_providers: Vec<WatchProvider>,
    pub genres: Vec<GenreListItem>,
    pub assets: GraphqlMediaAssets,
    pub publish_year: Option<i32>,
    pub publish_date: Option<NaiveDate>,
    pub book_specifics: Option<BookSpecifics>,
    pub movie_specifics: Option<MovieSpecifics>,
    pub show_specifics: Option<ShowSpecifics>,
    pub video_game_specifics: Option<VideoGameSpecifics>,
    pub visual_novel_specifics: Option<VisualNovelSpecifics>,
    pub audio_book_specifics: Option<AudioBookSpecifics>,
    pub podcast_specifics: Option<PodcastSpecifics>,
    pub manga_specifics: Option<MangaSpecifics>,
    pub anime_specifics: Option<AnimeSpecifics>,
    pub source_url: Option<String>,
    pub suggestions: Vec<String>,
    pub group: Option<GraphqlMetadataGroup>,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum GraphqlSortOrder {
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

#[derive(Debug, Serialize, Deserialize, Enum, Clone, Copy, Eq, PartialEq)]
pub enum MediaGeneralFilter {
    All,
    Rated,
    Unrated,
    Dropped,
    OnAHold,
    Unfinished,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MediaFilter {
    pub general: Option<MediaGeneralFilter>,
    pub collections: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MetadataListInput {
    pub take: Option<u64>,
    pub lot: Option<MediaLot>,
    pub filter: Option<MediaFilter>,
    pub search: Option<SearchInput>,
    pub sort: Option<SortInput<MediaSortBy>>,
    pub invert_collection: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct PeopleListInput {
    pub take: Option<u64>,
    pub search: Option<SearchInput>,
    pub filter: Option<MediaFilter>,
    pub invert_collection: Option<bool>,
    pub sort: Option<SortInput<PersonAndMetadataGroupsSortBy>>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
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

#[derive(SimpleObject)]
pub struct UserMetadataDetailsEpisodeProgress {
    pub episode_number: i32,
    pub times_seen: usize,
}

#[derive(SimpleObject)]
pub struct UserMetadataDetailsShowSeasonProgress {
    pub season_number: i32,
    pub times_seen: usize,
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

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct PeopleSearchInput {
    pub search: SearchInput,
    pub source: MediaSource,
    pub source_specifics: Option<PersonSourceSpecifics>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MetadataGroupSearchInput {
    pub search: SearchInput,
    pub lot: MediaLot,
    pub source: MediaSource,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MetadataSearchInput {
    pub search: SearchInput,
    pub lot: MediaLot,
    pub source: MediaSource,
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

#[derive(Debug, Serialize, Deserialize, Enum, Clone, Copy, Eq, PartialEq, Display)]
#[strum(serialize_all = "snake_case")]
pub enum DailyUserActivitiesResponseGroupedBy {
    Day,
    Month,
    Year,
    Millennium,
}

#[derive(Debug, Default, Serialize, Deserialize, InputObject, Clone)]
pub struct DailyUserActivitiesInput {
    pub end_date: Option<NaiveDate>,
    pub start_date: Option<NaiveDate>,
    pub group_by: Option<DailyUserActivitiesResponseGroupedBy>,
}

#[derive(Debug, Default, SimpleObject, Serialize, Deserialize, Clone, FromQueryResult)]
pub struct DailyUserActivityItem {
    pub day: Date,
    pub total_metadata_review_count: i64,
    pub total_collection_review_count: i64,
    pub total_metadata_group_review_count: i64,
    pub total_person_review_count: i64,
    pub measurement_count: i64,
    pub workout_count: i64,
    pub total_workout_duration: i64,
    pub audio_book_count: i64,
    pub total_audio_book_duration: i64,
    pub anime_count: i64,
    pub book_count: i64,
    pub total_book_pages: i64,
    pub podcast_count: i64,
    pub total_podcast_duration: i64,
    pub manga_count: i64,
    pub movie_count: i64,
    pub total_movie_duration: i64,
    pub show_count: i64,
    pub total_show_duration: i64,
    pub video_game_count: i64,
    pub visual_novel_count: i64,
    pub total_visual_novel_duration: i64,
    pub total_workout_personal_bests: i64,
    pub total_workout_weight: i64,
    pub total_workout_reps: i64,
    pub total_workout_distance: i64,
    pub total_workout_rest_time: i64,
    pub total_metadata_count: i64,
    pub total_review_count: i64,
    pub total_count: i64,
    pub total_duration: i64,
}
