use async_graphql::{SimpleObject, Union};
use chrono::NaiveDate;
use common_models::{EntityAssets, PersonSourceSpecifics};
use database_models::{
    exercise, metadata_group::MetadataGroupWithoutId, person, seen, user_to_entity, workout,
    workout_template,
};
use enum_models::{UserLot, UserToMediaReason};
use fitness_models::UserToExerciseHistoryExtraInformation;
use media_models::{
    PartialMetadataWithoutId, PersonDetailsGroupedByRole, ReviewItem, UserDetailsError,
    UserMediaNextEntry, UserMetadataDetailsEpisodeProgress, UserMetadataDetailsShowSeasonProgress,
};
use rust_decimal::Decimal;
use schematic::Schematic;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use user_models::{UserExtraInformation, UserPreferences};
use uuid::Uuid;

#[skip_serializing_none]
#[derive(Debug, PartialEq, Eq, Default, Serialize, Deserialize, SimpleObject, Clone, Schematic)]
#[serde(rename_all = "snake_case")]
pub struct CollectionToEntityDetails {
    /// The rank of this entity in the collection. This is ignored during importing.
    #[serde(default)]
    pub rank: Decimal,
    pub collection_id: String,
    pub collection_name: String,
    pub created_on: DateTimeUtc,
    pub creator_user_id: String,
    pub last_updated_on: DateTimeUtc,
    pub information: Option<serde_json::Value>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct GraphqlCollectionToEntityDetails {
    pub id: Uuid,
    pub details: CollectionToEntityDetails,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, Hash)]
pub struct MetadataPersonRelated {
    pub role: String,
    pub character: Option<String>,
    pub metadata: PartialMetadataWithoutId,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, Hash)]
pub struct MetadataGroupPersonRelated {
    pub role: String,
    pub metadata_group: MetadataGroupWithoutId,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, Hash)]
pub struct PersonDetails {
    pub name: String,
    pub assets: EntityAssets,
    pub place: Option<String>,
    pub gender: Option<String>,
    pub website: Option<String>,
    pub source_url: Option<String>,
    pub description: Option<String>,
    pub death_date: Option<NaiveDate>,
    pub birth_date: Option<NaiveDate>,
    pub alternate_names: Option<Vec<String>>,
    pub related_metadata: Vec<MetadataPersonRelated>,
    pub source_specifics: Option<PersonSourceSpecifics>,
    pub related_metadata_groups: Vec<MetadataGroupPersonRelated>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct BasicUserDetails {
    pub id: String,
    pub name: String,
    pub lot: UserLot,
    pub is_disabled: Option<bool>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct UserDetails {
    pub id: String,
    pub name: String,
    pub lot: UserLot,
    pub is_disabled: Option<bool>,
    pub preferences: UserPreferences,
    pub oidc_issuer_id: Option<String>,
    pub access_link_id: Option<String>,
    pub extra_information: Option<UserExtraInformation>,
    pub times_two_factor_backup_codes_used: Option<usize>,
}

#[derive(Union)]
pub enum UserDetailsResult {
    Ok(Box<UserDetails>),
    Error(UserDetailsError),
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct GraphqlPersonDetails {
    pub details: person::Model,
    pub associated_metadata: Vec<PersonDetailsGroupedByRole>,
    pub associated_metadata_groups: Vec<PersonDetailsGroupedByRole>,
}

#[skip_serializing_none]
#[derive(Clone, SimpleObject, Debug, PartialEq, Serialize, Deserialize, Eq)]
pub struct UserPersonDetails {
    pub has_interacted: bool,
    pub reviews: Vec<ReviewItem>,
    pub average_rating: Option<Decimal>,
    pub collections: Vec<GraphqlCollectionToEntityDetails>,
}

#[skip_serializing_none]
#[derive(Clone, SimpleObject, Debug, PartialEq, Serialize, Deserialize, Eq)]
pub struct UserMetadataGroupDetails {
    pub has_interacted: bool,
    pub reviews: Vec<ReviewItem>,
    pub average_rating: Option<Decimal>,
    pub collections: Vec<GraphqlCollectionToEntityDetails>,
}

#[skip_serializing_none]
#[derive(Clone, SimpleObject, Debug, PartialEq, Serialize, Deserialize, Eq)]
pub struct UserMetadataDetails {
    /// Whether this media has been interacted with
    pub has_interacted: bool,
    /// The number of users who have seen this media.
    pub seen_by_all_count: i64,
    /// The public reviews of this media.
    pub reviews: Vec<ReviewItem>,
    /// The seen history of this media.
    pub history: Vec<seen::Model>,
    /// The number of times this user has seen this media.
    pub seen_by_user_count: usize,
    /// The average rating of this media in this service.
    pub average_rating: Option<Decimal>,
    /// The seen item if it is in progress.
    pub in_progress: Option<seen::Model>,
    /// The next episode/chapter of this media.
    pub next_entry: Option<UserMediaNextEntry>,
    /// The reasons why this metadata is related to this user
    pub media_reason: Option<Vec<UserToMediaReason>>,
    /// The collections in which this media is present.
    pub collections: Vec<GraphqlCollectionToEntityDetails>,
    /// The seen progress of this media if it is a show.
    pub show_progress: Option<Vec<UserMetadataDetailsShowSeasonProgress>>,
    /// The seen progress of this media if it is a podcast.
    pub podcast_progress: Option<Vec<UserMetadataDetailsEpisodeProgress>>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct UserWorkoutDetails {
    pub details: workout::Model,
    pub metadata_consumed: Vec<String>,
    pub collections: Vec<GraphqlCollectionToEntityDetails>,
}

#[derive(Debug, Default, Serialize, Deserialize, SimpleObject, Clone)]
pub struct UserExerciseDetails {
    pub reviews: Vec<ReviewItem>,
    pub details: Option<user_to_entity::Model>,
    pub collections: Vec<GraphqlCollectionToEntityDetails>,
    pub history: Option<Vec<UserToExerciseHistoryExtraInformation>>,
}

#[derive(Debug, PartialEq, Eq, SimpleObject, Clone, Serialize, Deserialize)]
pub struct UserWorkoutTemplateDetails {
    pub details: workout_template::Model,
    pub collections: Vec<GraphqlCollectionToEntityDetails>,
}

#[derive(async_graphql::InputObject, Clone, Debug, Deserialize, Serialize)]
pub struct UpdateCustomExerciseInput {
    #[graphql(flatten)]
    pub update: exercise::Model,
    pub should_delete: Option<bool>,
}
