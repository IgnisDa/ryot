use std::{
    collections::{HashMap, HashSet},
    fmt,
    sync::Arc,
};

use async_graphql::{Enum, InputObject, OutputType, SimpleObject, Union};
use async_trait::async_trait;
use chrono::{NaiveDate, NaiveDateTime};
use derive_more::{Add, AddAssign, Sum};
use rust_decimal::prelude::FromPrimitive;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::{
    prelude::DateTimeUtc, DeriveActiveEnum, EnumIter, FromJsonQueryResult, FromQueryResult,
};
use serde::{de, Deserialize, Serialize};
use serde_with::skip_serializing_none;

use crate::{
    entities::{
        exercise::ExerciseListItem, partial_metadata::PartialMetadataWithoutId, user_measurement,
    },
    file_storage::FileStorageService,
    migrator::{
        ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseMechanic, ExerciseMuscle,
        MetadataLot, MetadataSource, SeenState,
    },
    traits::{DatabaseAssestsAsSingleUrl, DatabaseAssetsAsUrls},
    utils::get_stored_asset,
};

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, Hash)]
pub enum StoredUrl {
    S3(String),
    Url(String),
}

impl Default for StoredUrl {
    fn default() -> Self {
        Self::Url("".to_owned())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, SimpleObject, InputObject)]
#[graphql(input_name = "NamedObjectInput")]
pub struct NamedObject {
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, InputObject, Clone)]
pub struct SearchInput {
    pub query: Option<String>,
    pub page: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone)]
pub struct SearchDetails {
    pub total: i32,
    pub next_page: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone)]
#[graphql(concrete(
    name = "MediaCollectionContentsResults",
    params(media::MediaSearchItemWithLot)
))]
#[graphql(concrete(name = "MediaSearchResults", params(media::MediaSearchItemResponse)))]
#[graphql(concrete(
    name = "MediaCreatorSearchResults",
    params(media::MediaCreatorSearchItem)
))]
#[graphql(concrete(name = "MediaListResults", params(media::MediaListItem)))]
#[graphql(concrete(
    name = "MetadataGroupListResults",
    params(media::MetadataGroupListItem)
))]
#[graphql(concrete(name = "ExerciseListResults", params(ExerciseListItem)))]
pub struct SearchResults<T: OutputType> {
    pub details: SearchDetails,
    pub items: Vec<T>,
}

#[derive(Debug, SimpleObject, Serialize, Deserialize, Clone)]
pub struct IdObject {
    pub id: i32,
}

pub mod media {
    use super::*;

    #[derive(Debug, SimpleObject, Serialize, Deserialize, Clone)]
    pub struct MediaSearchItemWithLot {
        pub details: MediaSearchItem,
        pub lot: MetadataLot,
    }

    #[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
    pub struct MediaSearchItemResponse {
        pub item: MediaSearchItem,
        pub database_id: Option<i32>,
    }

    #[derive(
        Clone,
        FromJsonQueryResult,
        Debug,
        Serialize,
        Deserialize,
        SimpleObject,
        PartialOrd,
        Ord,
        Eq,
        PartialEq,
        InputObject,
    )]
    #[graphql(input_name = "UserMediaReminderInput")]
    pub struct UserMediaReminder {
        pub remind_on: NaiveDate,
        pub message: String,
    }

    #[derive(Clone, Debug, Serialize, Deserialize, SimpleObject, FromQueryResult)]
    pub struct MediaCreatorSearchItem {
        pub id: i32,
        pub name: String,
        pub image: Option<String>,
        pub media_count: i64,
    }

    #[derive(Debug, InputObject, Default)]
    pub struct CreateOrUpdateCollectionInput {
        pub name: String,
        pub description: Option<String>,
        pub visibility: Option<Visibility>,
        pub update_id: Option<i32>,
    }

    #[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
    pub struct MediaListItem {
        pub data: MediaSearchItem,
        pub average_rating: Option<Decimal>,
    }

    #[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, FromQueryResult)]
    pub struct MetadataGroupListItem {
        pub id: i32,
        pub title: String,
        pub description: Option<String>,
        pub lot: MetadataLot,
        pub image: Option<String>,
        #[graphql(skip)]
        pub images: MetadataImages,
        pub parts: i32,
    }

    #[derive(
        Debug, Serialize, Deserialize, SimpleObject, Clone, InputObject, PartialEq, Eq, Default,
    )]
    #[graphql(input_name = "AudioBookSpecificsInput")]
    pub struct AudioBookSpecifics {
        pub runtime: Option<i32>,
    }

    #[derive(
        Debug, Serialize, Deserialize, SimpleObject, Clone, InputObject, PartialEq, Eq, Default,
    )]
    #[graphql(input_name = "BookSpecificsInput")]
    pub struct BookSpecifics {
        pub pages: Option<i32>,
    }

    #[derive(
        Debug, Serialize, Deserialize, SimpleObject, Clone, InputObject, Eq, PartialEq, Default,
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
        pub total_episodes: i32,
    }

    impl PodcastSpecifics {
        pub fn get_episode(&self, episode_number: i32) -> Option<&PodcastEpisode> {
            self.episodes.iter().find(|e| e.number == episode_number)
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
                NaiveDateTime::from_timestamp_millis(v.try_into().unwrap())
                    .ok_or_else(|| E::custom("Could not convert timestamp"))
                    .map(|d| d.date())
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
    #[graphql(input_name = "AnimeSpecificsInput")]
    pub struct AnimeSpecifics {
        pub episodes: Option<i32>,
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
    pub struct MediaSearchItem {
        pub identifier: String,
        pub title: String,
        pub image: Option<String>,
        pub publish_year: Option<i32>,
    }

    #[derive(
        Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize, Enum,
    )]
    #[sea_orm(rs_type = "String", db_type = "String(None)")]
    pub enum Visibility {
        #[sea_orm(string_value = "PU")]
        Public,
        #[sea_orm(string_value = "PR")]
        Private,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct AudioBooksSummary {
        pub runtime: i32,
        pub played: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct VideoGamesSummary {
        pub played: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct VisualNovelsSummary {
        pub played: usize,
        pub runtime: i32,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct BooksSummary {
        pub pages: i32,
        pub read: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct MoviesSummary {
        pub runtime: i32,
        pub watched: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct PodcastsSummary {
        pub runtime: i32,
        pub played: usize,
        pub played_episodes: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct ShowsSummary {
        pub runtime: i32,
        pub watched: usize,
        pub watched_episodes: usize,
        pub watched_seasons: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct MangaSummary {
        pub chapters: i32,
        pub read: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    pub struct AnimeSummary {
        pub episodes: i32,
        pub watched: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    #[serde(default)]
    pub struct UserMediaSummary {
        pub books: BooksSummary,
        pub movies: MoviesSummary,
        pub podcasts: PodcastsSummary,
        pub shows: ShowsSummary,
        pub video_games: VideoGamesSummary,
        pub visual_novels: VisualNovelsSummary,
        pub audio_books: AudioBooksSummary,
        pub anime: AnimeSummary,
        pub manga: MangaSummary,
        pub reviews_posted: u64,
        pub creators_interacted_with: usize,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    #[serde(default)]
    pub struct UserFitnessSummary {
        pub measurements_recorded: u64,
        pub workouts_recorded: u64,
    }

    #[derive(Debug, PartialEq, Eq, Clone, Default, Serialize, Deserialize, FromJsonQueryResult)]
    // FIXME: Remove this serde attribute
    #[serde(default)]
    pub struct UserSummaryUniqueItems {
        pub audio_books: HashSet<i32>,
        pub anime: HashSet<i32>,
        pub manga: HashSet<i32>,
        pub books: HashSet<i32>,
        pub movies: HashSet<i32>,
        pub visual_novels: HashSet<i32>,
        pub video_games: HashSet<i32>,
        pub show_episodes: HashSet<(i32, i32, i32)>,
        pub show_seasons: HashSet<(i32, i32)>,
        pub shows: HashSet<i32>,
        pub podcast_episodes: HashSet<(i32, i32)>,
        pub podcasts: HashSet<i32>,
        pub creators: HashSet<i32>,
    }

    #[derive(
        SimpleObject,
        Debug,
        PartialEq,
        Eq,
        Clone,
        Default,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
    )]
    // FIXME: Remove this serde attribute
    #[serde(default)]
    pub struct UserSummary {
        pub fitness: UserFitnessSummary,
        pub media: UserMediaSummary,
        pub calculated_on: DateTimeUtc,
        #[graphql(skip)]
        pub unique_items: UserSummaryUniqueItems,
    }

    #[derive(Debug, InputObject)]
    pub struct AddMediaToCollection {
        pub collection_name: String,
        pub media_id: i32,
    }

    #[derive(Debug, InputObject)]
    pub struct PostReviewInput {
        pub rating: Option<Decimal>,
        pub text: Option<String>,
        pub visibility: Option<Visibility>,
        pub spoiler: Option<bool>,
        pub metadata_id: Option<i32>,
        pub creator_id: Option<i32>,
        pub date: Option<DateTimeUtc>,
        /// ID of the review if this is an update to an existing review
        pub review_id: Option<i32>,
        pub show_season_number: Option<i32>,
        pub show_episode_number: Option<i32>,
        pub podcast_episode_number: Option<i32>,
    }

    #[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
    pub struct ProgressUpdateInput {
        pub metadata_id: i32,
        pub progress: Option<i32>,
        pub date: Option<NaiveDate>,
        pub show_season_number: Option<i32>,
        pub show_episode_number: Option<i32>,
        pub podcast_episode_number: Option<i32>,
        pub change_state: Option<SeenState>,
    }

    #[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
    pub enum ProgressUpdateErrorVariant {
        AlreadySeen,
        NoSeenInProgress,
        InvalidUpdate,
    }

    #[derive(Debug, SimpleObject)]
    pub struct ProgressUpdateError {
        pub error: ProgressUpdateErrorVariant,
    }

    #[derive(Union)]
    pub enum ProgressUpdateResultUnion {
        Ok(IdObject),
        Error(ProgressUpdateError),
    }

    #[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, SimpleObject, Hash)]
    pub struct PartialMetadataPerson {
        pub identifier: String,
        pub source: MetadataSource,
        pub role: String,
    }

    #[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, Hash)]
    pub struct MetadataPerson {
        pub identifier: String,
        pub source: MetadataSource,
        pub name: String,
        pub description: Option<String>,
        pub images: Option<Vec<String>>,
        pub gender: Option<String>,
        pub death_date: Option<NaiveDate>,
        pub birth_date: Option<NaiveDate>,
        pub place: Option<String>,
        pub website: Option<String>,
        pub related: Vec<(String, PartialMetadataWithoutId)>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, SimpleObject, Hash)]
    pub struct MetadataImageForMediaDetails {
        pub image: String,
        pub lot: MetadataImageLot,
    }

    #[derive(Debug, Serialize, Deserialize, Clone)]
    pub struct MediaDetails {
        pub identifier: String,
        pub is_nsfw: Option<bool>,
        pub title: String,
        pub source: MetadataSource,
        pub description: Option<String>,
        pub lot: MetadataLot,
        pub production_status: String,
        pub creators: Vec<FreeMetadataCreator>,
        pub people: Vec<PartialMetadataPerson>,
        pub genres: Vec<String>,
        pub url_images: Vec<MetadataImageForMediaDetails>,
        pub s3_images: Vec<MetadataImageForMediaDetails>,
        pub videos: Vec<MetadataVideo>,
        pub publish_year: Option<i32>,
        pub publish_date: Option<NaiveDate>,
        pub specifics: MediaSpecifics,
        pub suggestions: Vec<PartialMetadataWithoutId>,
        pub group_identifiers: Vec<String>,
        pub provider_rating: Option<Decimal>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone)]
    #[serde(untagged)]
    pub enum ImportOrExportItemIdentifier {
        // the identifier in case we need to fetch details
        NeedsDetails(String),
        // details are already filled and just need to be comitted to database
        AlreadyFilled(Box<MediaDetails>),
    }

    /// A specific instance when an entity was seen.
    #[skip_serializing_none]
    #[derive(Debug, Serialize, Deserialize, Clone, Default)]
    pub struct ImportOrExportMediaItemSeen {
        /// The progress of media done. If none, it is considered as done.
        pub progress: Option<i32>,
        /// The timestamp when started watching.
        pub started_on: Option<DateTimeUtc>,
        /// The timestamp when finished watching.
        pub ended_on: Option<DateTimeUtc>,
        /// If for a show, the season which was seen.
        pub show_season_number: Option<i32>,
        /// If for a show, the episode which was seen.
        pub show_episode_number: Option<i32>,
        /// If for a podcast, the episode which was seen.
        pub podcast_episode_number: Option<i32>,
    }

    /// Review data associated to a rating.
    #[skip_serializing_none]
    #[derive(Debug, Serialize, Deserialize, Clone, Default)]
    pub struct ImportOrExportItemReview {
        /// The date the review was posted.
        pub date: Option<DateTimeUtc>,
        /// Whether to mark the review as a spoiler. Defaults to false.
        pub spoiler: Option<bool>,
        /// Actual text for the review.
        pub text: Option<String>,
    }

    /// A rating given to an entity.
    #[skip_serializing_none]
    #[derive(Debug, Serialize, Deserialize, Clone, Default)]
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
        /// The comments attached to this review.
        pub comments: Option<Vec<ImportOrExportItemReviewComment>>,
    }

    /// Details about a specific media item that needs to be imported or exported.
    #[skip_serializing_none]
    #[derive(Debug, Serialize, Deserialize, Clone)]
    pub struct ImportOrExportMediaItem {
        /// An string to help identify it in the original source.
        pub source_id: String,
        /// The type of media.
        pub lot: MetadataLot,
        /// The source of media.
        pub source: MetadataSource,
        /// The provider identifier. For eg: TMDB-ID, Openlibrary ID and so on.
        pub identifier: String,
        // DEV: Only to be used internally.
        #[serde(skip)]
        pub internal_identifier: Option<ImportOrExportItemIdentifier>,
        /// The seen history for the user.
        pub seen_history: Vec<ImportOrExportMediaItemSeen>,
        /// The review history for the user.
        pub reviews: Vec<ImportOrExportItemRating>,
        /// The collections to add this media to.
        pub collections: Vec<String>,
    }

    /// Complete export of the user.
    #[skip_serializing_none]
    #[derive(Debug, Serialize, Deserialize, Clone)]
    pub struct ExportAllResponse {
        /// Data about user's media.
        pub media: Vec<ImportOrExportMediaItem>,
        /// Data about user's people.
        pub people: Vec<ImportOrExportPersonItem>,
        /// Data about user's measurements.
        pub measurements: Vec<user_measurement::Model>,
    }

    /// Details about a specific creator item that needs to be exported.
    #[skip_serializing_none]
    #[derive(Debug, Serialize, Deserialize, Clone)]
    pub struct ImportOrExportPersonItem {
        /// The name of the creator.
        pub name: String,
        /// The review history for the user.
        pub reviews: Vec<ImportOrExportItemRating>,
    }

    #[derive(Debug, Serialize, Deserialize, Clone, FromJsonQueryResult, Eq, PartialEq, Default)]
    #[serde(tag = "t", content = "d")]
    pub enum MediaSpecifics {
        AudioBook(AudioBookSpecifics),
        Book(BookSpecifics),
        Movie(MovieSpecifics),
        Podcast(PodcastSpecifics),
        Show(ShowSpecifics),
        VideoGame(VideoGameSpecifics),
        VisualNovel(VisualNovelSpecifics),
        Anime(AnimeSpecifics),
        Manga(MangaSpecifics),
        #[default]
        Unknown,
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
        Default,
        Hash,
        Enum,
    )]
    pub enum MetadataImageLot {
        Backdrop,
        #[default]
        Poster,
    }

    #[derive(
        Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default, Hash,
    )]
    pub struct MetadataImage {
        pub url: StoredUrl,
        pub lot: MetadataImageLot,
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

    // FIXME: Remove this
    #[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default)]
    pub struct MetadataImages(pub Vec<MetadataImage>);

    #[async_trait]
    impl DatabaseAssestsAsSingleUrl for Option<MetadataImages> {
        async fn first_as_url(
            &self,
            file_storage_service: &Arc<FileStorageService>,
        ) -> Option<String> {
            if let Some(images) = self {
                if let Some(i) = images.0.first().cloned() {
                    Some(get_stored_asset(i.url, file_storage_service).await)
                } else {
                    None
                }
            } else {
                None
            }
        }
    }

    #[async_trait]
    impl DatabaseAssetsAsUrls for Option<MetadataImages> {
        async fn as_urls(&self, file_storage_service: &Arc<FileStorageService>) -> Vec<String> {
            let mut images = vec![];
            if let Some(imgs) = self {
                for i in imgs.0.clone() {
                    images.push(get_stored_asset(i.url, file_storage_service).await);
                }
            }
            images
        }
    }

    // FIXME: Remove this
    #[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default)]
    pub struct MetadataVideos(pub Vec<MetadataVideo>);

    /// A user that has commented on a review.
    #[derive(
        Clone,
        Debug,
        PartialEq,
        FromJsonQueryResult,
        Eq,
        Serialize,
        Deserialize,
        Default,
        Hash,
        SimpleObject,
    )]
    pub struct ReviewCommentUser {
        pub id: i32,
        pub name: String,
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
    )]
    pub struct ImportOrExportItemReviewComment {
        pub id: String,
        pub text: String,
        pub user: ReviewCommentUser,
        /// The user ids of all those who liked it.
        pub liked_by: HashSet<i32>,
        pub created_on: DateTimeUtc,
    }

    // FIXME: Remove this
    #[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default)]
    pub struct ReviewComments(pub Vec<ImportOrExportItemReviewComment>);

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
    pub struct FreeMetadataCreator {
        pub name: String,
        pub role: String,
        pub image: Option<String>,
    }

    // FIXME: Remove this
    #[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default)]
    pub struct MetadataFreeCreators(pub Vec<FreeMetadataCreator>);

    #[derive(Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject)]
    pub struct SeenShowExtraInformation {
        pub season: i32,
        pub episode: i32,
    }

    #[derive(Debug, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject)]
    pub struct SeenPodcastExtraInformation {
        pub episode: i32,
    }

    #[derive(Debug, PartialEq, Eq, Serialize, Deserialize, Clone, FromJsonQueryResult)]
    pub enum SeenOrReviewOrCalendarEventExtraInformation {
        Show(SeenShowExtraInformation),
        Podcast(SeenPodcastExtraInformation),
    }
}

pub mod fitness {
    use super::*;

    #[derive(
        Debug, Clone, Serialize, Enum, Copy, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseCategory {
        Powerlifting,
        Strength,
        Stretching,
        Cardio,
        #[serde(alias = "olympic weightlifting")]
        OlympicWeightlifting,
        Strongman,
        Plyometrics,
    }

    // FIXME: Remove this
    #[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default)]
    pub struct ExerciseMuscles(pub Vec<ExerciseMuscle>);

    #[derive(
        Debug, Clone, Serialize, SimpleObject, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "camelCase")]
    pub struct ExerciseAttributes {
        pub instructions: Vec<String>,
        #[graphql(skip)]
        #[serde(default)]
        pub internal_images: Vec<StoredUrl>,
        #[serde(default)]
        pub images: Vec<String>,
        #[serde(default)]
        pub muscles: Vec<ExerciseMuscle>,
    }

    #[derive(
        Debug, Clone, Serialize, SimpleObject, Deserialize, FromJsonQueryResult, Eq, PartialEq,
    )]
    #[serde(rename_all = "camelCase")]
    pub struct GithubExerciseAttributes {
        pub level: ExerciseLevel,
        pub category: ExerciseCategory,
        pub force: Option<ExerciseForce>,
        pub mechanic: Option<ExerciseMechanic>,
        pub equipment: Option<ExerciseEquipment>,
        pub primary_muscles: Vec<ExerciseMuscle>,
        pub secondary_muscles: Vec<ExerciseMuscle>,
        pub instructions: Vec<String>,
        #[serde(default)]
        pub images: Vec<String>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct Exercise {
        #[serde(alias = "id")]
        pub identifier: String,
        #[serde(flatten)]
        pub attributes: GithubExerciseAttributes,
        pub name: String,
    }

    /// The actual statistics that were logged in a user measurement.
    #[skip_serializing_none]
    #[derive(
        Debug,
        Clone,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        InputObject,
    )]
    #[graphql(input_name = "UserMeasurementDataInput")]
    pub struct UserMeasurementStats {
        pub weight: Option<Decimal>,
        pub body_mass_index: Option<Decimal>,
        pub total_body_water: Option<Decimal>,
        pub muscle: Option<Decimal>,
        pub lean_body_mass: Option<Decimal>,
        pub body_fat: Option<Decimal>,
        pub bone_mass: Option<Decimal>,
        pub visceral_fat: Option<Decimal>,
        pub waist_circumference: Option<Decimal>,
        pub waist_to_height_ratio: Option<Decimal>,
        pub hip_circumference: Option<Decimal>,
        pub waist_to_hip_ratio: Option<Decimal>,
        pub chest_circumference: Option<Decimal>,
        pub thigh_circumference: Option<Decimal>,
        pub biceps_circumference: Option<Decimal>,
        pub neck_circumference: Option<Decimal>,
        pub body_fat_caliper: Option<Decimal>,
        pub chest_skinfold: Option<Decimal>,
        pub abdominal_skinfold: Option<Decimal>,
        pub thigh_skinfold: Option<Decimal>,
        pub basal_metabolic_rate: Option<Decimal>,
        pub total_daily_energy_expenditure: Option<Decimal>,
        pub calories: Option<Decimal>,
        // DEV: The only custom data type we allow is decimal.
        pub custom: Option<HashMap<String, Decimal>>,
    }

    #[derive(
        Debug,
        FromJsonQueryResult,
        Clone,
        Serialize,
        Deserialize,
        Eq,
        PartialEq,
        SimpleObject,
        Default,
        Sum,
        Add,
        AddAssign,
    )]
    pub struct WorkoutTotalMeasurement {
        /// The number of personal bests achieved.
        pub personal_bests_achieved: usize,
        pub weight: Decimal,
        pub reps: usize,
        pub distance: Decimal,
        pub duration: Decimal,
    }

    #[derive(
        Debug,
        Clone,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        Default,
    )]
    pub struct UserToExerciseHistoryExtraInformation {
        pub workout_id: String,
        pub idx: usize,
    }

    #[skip_serializing_none]
    #[derive(
        Clone,
        Debug,
        Deserialize,
        Serialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        InputObject,
    )]
    #[graphql(input_name = "SetStatisticInput")]
    pub struct WorkoutSetStatistic {
        pub duration: Option<Decimal>,
        pub distance: Option<Decimal>,
        pub reps: Option<usize>,
        pub weight: Option<Decimal>,
    }

    #[derive(
        Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, Enum, Copy,
    )]
    pub enum SetLot {
        Normal,
        WarmUp,
        Drop,
        Failure,
    }

    #[derive(
        Clone,
        Debug,
        Deserialize,
        Serialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        Enum,
        Copy,
        Default,
    )]
    pub enum WorkoutSetPersonalBest {
        #[default]
        Weight,
        OneRm,
        Volume,
        Time,
        Pace,
    }

    #[derive(
        Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
    )]
    pub struct WorkoutSetRecord {
        pub statistic: WorkoutSetStatistic,
        pub lot: SetLot,
        pub personal_bests: Vec<WorkoutSetPersonalBest>,
    }

    impl WorkoutSetRecord {
        // DEV: Formula from https://en.wikipedia.org/wiki/One-repetition_maximum#cite_note-7
        pub fn calculate_one_rm(&self) -> Option<Decimal> {
            let weight = self.statistic.weight?;
            let reps = self.statistic.reps?;
            Some(weight * dec!(36.0) / (dec!(37.0) - Decimal::from_usize(reps).unwrap()))
        }

        pub fn calculate_volume(&self) -> Option<Decimal> {
            let weight = self.statistic.weight?;
            let reps = self.statistic.reps?;
            Some(weight * Decimal::from_usize(reps).unwrap())
        }

        pub fn calculate_pace(&self) -> Option<Decimal> {
            let distance = self.statistic.distance?;
            let duration = self.statistic.duration?;
            Some(distance / duration)
        }

        pub fn get_personal_best(&self, pb_type: &WorkoutSetPersonalBest) -> Option<Decimal> {
            match pb_type {
                WorkoutSetPersonalBest::Weight => self.statistic.weight,
                WorkoutSetPersonalBest::Time => self.statistic.duration,
                WorkoutSetPersonalBest::OneRm => self.calculate_one_rm(),
                WorkoutSetPersonalBest::Volume => self.calculate_volume(),
                WorkoutSetPersonalBest::Pace => self.calculate_pace(),
            }
        }
    }

    #[derive(
        Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
    )]
    pub struct ExerciseBestSetRecord {
        pub workout_id: String,
        pub set_idx: usize,
        pub data: WorkoutSetRecord,
    }

    #[derive(
        Debug,
        Clone,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        Default,
    )]
    pub struct UserToExerciseBestSetExtraInformation {
        pub lot: WorkoutSetPersonalBest,
        pub sets: Vec<ExerciseBestSetRecord>,
    }

    #[derive(
        Debug,
        Clone,
        Serialize,
        Deserialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        Default,
    )]
    pub struct UserToExerciseExtraInformation {
        pub history: Vec<UserToExerciseHistoryExtraInformation>,
        pub lifetime_stats: WorkoutTotalMeasurement,
        pub personal_bests: Vec<UserToExerciseBestSetExtraInformation>,
    }

    /// The assets that were uploaded for an entity.
    #[derive(
        Clone,
        Debug,
        Deserialize,
        Serialize,
        FromJsonQueryResult,
        Eq,
        PartialEq,
        SimpleObject,
        InputObject,
        Default,
    )]
    #[graphql(input_name = "EntityAssetsInput")]
    pub struct EntityAssets {
        /// The keys of the S3 images.
        pub images: Vec<String>,
        /// The keys of the S3 videos.
        pub videos: Vec<String>,
    }

    #[derive(
        Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
    )]
    pub struct ProcessedExercise {
        pub exercise_name: String,
        pub exercise_id: i32,
        pub sets: Vec<WorkoutSetRecord>,
        pub notes: Vec<String>,
        pub rest_time: Option<u16>,
        pub total: WorkoutTotalMeasurement,
        #[serde(default)]
        pub assets: EntityAssets,
    }

    #[derive(
        Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
    )]
    pub struct WorkoutInformation {
        /// Each grouped superset of exercises will be in a vector. They will contain
        /// the `exercise.idx`.
        pub supersets: Vec<Vec<u16>>,
        pub exercises: Vec<ProcessedExercise>,
        #[serde(default)]
        pub assets: EntityAssets,
    }

    #[derive(
        Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
    )]
    pub struct WorkoutSummaryExercise {
        pub num_sets: usize,
        pub name: String,
        pub best_set: WorkoutSetRecord,
    }

    #[derive(
        Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
    )]
    pub struct WorkoutSummary {
        pub total: WorkoutTotalMeasurement,
        pub exercises: Vec<WorkoutSummaryExercise>,
    }
}
