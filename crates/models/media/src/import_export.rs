use std::collections::HashSet;

use async_graphql::{InputObject, SimpleObject};
use rust_decimal::Decimal;
use schematic::Schematic;
use sea_orm::{FromJsonQueryResult, prelude::DateTimeUtc};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

use common_models::{IdAndNamedObject, PersonSourceSpecifics};
use enum_models::{ImportSource, MediaLot, MediaSource, Visibility};

/// A specific instance when an entity was seen.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Default, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportMetadataItemSeen {
    /// The progress of media done. If none, it is considered as done.
    pub progress: Option<Decimal>,
    /// The timestamp when finished watching.
    pub ended_on: Option<DateTimeUtc>,
    /// The timestamp when started watching.
    pub started_on: Option<DateTimeUtc>,
    /// If for a show, the season which was seen.
    pub show_season_number: Option<i32>,
    /// If for a manga, the volume which was seen.
    pub manga_volume_number: Option<i32>,
    /// If for a show, the episode which was seen.
    pub show_episode_number: Option<i32>,
    /// If for an anime, the episode which was seen.
    pub anime_episode_number: Option<i32>,
    /// The provider this item was watched on.
    pub provider_watched_on: Option<String>,
    /// If for a podcast, the episode which was seen.
    pub podcast_episode_number: Option<i32>,
    /// If for a manga, the chapter which was seen.
    pub manga_chapter_number: Option<Decimal>,
}

/// Review data associated to a rating.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Default, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportItemReview {
    /// Actual text for the review.
    pub text: Option<String>,
    /// Whether to mark the review as a spoiler. Defaults to false.
    pub spoiler: Option<bool>,
    /// The date the review was posted.
    pub date: Option<DateTimeUtc>,
    /// The visibility set by the user.
    pub visibility: Option<Visibility>,
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
    pub created_on: DateTimeUtc,
    /// The user ids of all those who liked it.
    pub liked_by: HashSet<String>,
}

/// A rating given to an entity.
#[skip_serializing_none]
#[derive(Debug, Serialize, Deserialize, Clone, Default, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct ImportOrExportItemRating {
    /// The score of the review.
    pub rating: Option<Decimal>,
    /// If for a show, the season for which this review was for.
    pub show_season_number: Option<i32>,
    /// If for a show, the episode for which this review was for.
    pub show_episode_number: Option<i32>,
    /// If for an anime, the episode for which this review was for.
    pub anime_episode_number: Option<i32>,
    /// If for a podcast, the episode for which this review was for.
    pub podcast_episode_number: Option<i32>,
    /// If for a manga, the chapter for which this review was for.
    pub manga_chapter_number: Option<Decimal>,
    /// Data about the review.
    pub review: Option<ImportOrExportItemReview>,
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
pub struct DeployJellyfinImportInput {
    pub api_url: String,
    pub username: String,
    pub password: Option<String>,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployImportJobInput {
    pub source: ImportSource,
    pub mal: Option<DeployMalImportInput>,
    pub igdb: Option<DeployIgdbImportInput>,
    pub trakt: Option<DeployTraktImportInput>,
    pub movary: Option<DeployMovaryImportInput>,
    pub generic_json: Option<DeployJsonImportInput>,
    pub jellyfin: Option<DeployJellyfinImportInput>,
    pub strong_app: Option<DeployStrongAppImportInput>,
    pub url_and_key: Option<DeployUrlAndKeyImportInput>,
    pub generic_csv: Option<DeployGenericCsvImportInput>,
}
