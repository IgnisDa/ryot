use std::{collections::HashSet, fmt, sync::Arc};

use async_graphql::{Enum, InputObject, SimpleObject, Union};
use boilermates::boilermates;
use chrono::{DateTime, NaiveDate};
use common_models::{CollectionExtraInformation, IdAndNamedObject, StoredUrl, StringIdObject};
use enums::{EntityLot, MediaLot, MediaSource, SeenState, Visibility};
use file_storage_service::FileStorageService;
use rust_decimal::Decimal;
use schematic::Schematic;
use sea_orm::{prelude::DateTimeUtc, EnumIter, FromJsonQueryResult, FromQueryResult};
use serde::{de, Deserialize, Serialize};
use serde_with::skip_serializing_none;

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
    #[graphql(skip_input)]
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
    pub airing_at: DateTimeUtc,
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
    pub chapters: Option<i32>,
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
pub struct PostReviewInput {
    pub rating: Option<Decimal>,
    pub text: Option<String>,
    pub visibility: Option<Visibility>,
    pub is_spoiler: Option<bool>,
    pub metadata_id: Option<String>,
    pub person_id: Option<String>,
    pub metadata_group_id: Option<String>,
    pub collection_id: Option<String>,
    pub date: Option<DateTimeUtc>,
    /// ID of the review if this is an update to an existing review
    pub review_id: Option<String>,
    pub show_season_number: Option<i32>,
    pub show_episode_number: Option<i32>,
    pub podcast_episode_number: Option<i32>,
    pub anime_episode_number: Option<i32>,
    pub manga_chapter_number: Option<i32>,
    pub manga_volume_number: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct ProgressUpdateInput {
    pub metadata_id: String,
    pub progress: Option<Decimal>,
    pub date: Option<NaiveDate>,
    pub show_season_number: Option<i32>,
    pub show_episode_number: Option<i32>,
    pub podcast_episode_number: Option<i32>,
    pub anime_episode_number: Option<i32>,
    pub manga_chapter_number: Option<i32>,
    pub manga_volume_number: Option<i32>,
    pub change_state: Option<SeenState>,
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
    pub manga_chapter_number: Option<i32>,
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
    pub manga_chapter_number: Option<i32>,
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
    pub chapter: Option<i32>,
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
    #[graphql(skip_input)]
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

#[derive(Debug, SimpleObject)]
pub struct ReviewItem {
    pub id: String,
    pub posted_on: DateTimeUtc,
    pub rating: Option<Decimal>,
    pub text_original: Option<String>,
    pub text_rendered: Option<String>,
    pub visibility: Visibility,
    pub is_spoiler: bool,
    pub posted_by: IdAndNamedObject,
    pub show_extra_information: Option<SeenShowExtraInformation>,
    pub podcast_extra_information: Option<SeenPodcastExtraInformation>,
    pub anime_extra_information: Option<SeenAnimeExtraInformation>,
    pub manga_extra_information: Option<SeenMangaExtraInformation>,
    pub comments: Vec<ImportOrExportItemReviewComment>,
}
