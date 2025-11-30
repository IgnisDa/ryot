use std::collections::HashSet;

use async_graphql::{InputObject, SimpleObject};
use boilermates::boilermates;
use chrono::NaiveDate;
use common_models::{EntityAssets, PersonSourceSpecifics};
use enum_models::{EntityLot, MediaLot, MediaSource};
use rust_decimal::Decimal;
use sea_orm::{FromJsonQueryResult, FromQueryResult};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

use crate::{
    AnimeSpecifics, AudioBookSpecifics, BookSpecifics, MangaSpecifics, MovieSpecifics,
    MusicSpecifics, PodcastSpecifics, ShowSpecifics, VideoGameSpecifics, VisualNovelSpecifics,
};

#[derive(
    Debug, InputObject, Hash, PartialEq, Eq, Default, SimpleObject, Serialize, Deserialize, Clone,
)]
#[graphql(input_name = "EntityWithLotInput")]
pub struct EntityWithLot {
    pub entity_id: String,
    pub entity_lot: EntityLot,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone, FromQueryResult)]
pub struct GenreListItem {
    pub id: String,
    pub name: String,
    pub num_items: Option<i64>,
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
    SimpleObject,
    FromJsonQueryResult,
)]
pub struct MetadataFreeCreator {
    pub name: String,
    pub role: String,
}

#[boilermates("PartialMetadataWithoutId")]
#[boilermates(attr_for(
    "PartialMetadataWithoutId",
    "#[derive(Clone, Default, Eq, PartialEq, Debug, Serialize, Deserialize, Hash)]"
))]
#[derive(Clone, Eq, Default, PartialEq, Debug, Serialize, Deserialize, Hash)]
pub struct PartialMetadata {
    #[boilermates(not_in("PartialMetadataWithoutId"))]
    pub id: String,
    pub lot: MediaLot,
    pub title: String,
    pub identifier: String,
    pub source: MediaSource,
    pub image: Option<String>,
    pub publish_year: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct MetadataDetails {
    pub title: String,
    pub genres: Vec<String>,
    pub assets: EntityAssets,
    pub is_nsfw: Option<bool>,
    pub publish_year: Option<i32>,
    pub source_url: Option<String>,
    pub description: Option<String>,
    pub publish_date: Option<NaiveDate>,
    pub provider_rating: Option<Decimal>,
    pub original_language: Option<String>,
    pub production_status: Option<String>,
    pub creators: Vec<MetadataFreeCreator>,
    pub people: Vec<PartialMetadataPerson>,
    pub watch_providers: Vec<WatchProvider>,
    pub groups: Vec<CommitMetadataGroupInput>,
    pub show_specifics: Option<ShowSpecifics>,
    pub book_specifics: Option<BookSpecifics>,
    pub movie_specifics: Option<MovieSpecifics>,
    pub anime_specifics: Option<AnimeSpecifics>,
    pub manga_specifics: Option<MangaSpecifics>,
    pub music_specifics: Option<MusicSpecifics>,
    pub suggestions: Vec<PartialMetadataWithoutId>,
    pub podcast_specifics: Option<PodcastSpecifics>,
    pub audio_book_specifics: Option<AudioBookSpecifics>,
    pub video_game_specifics: Option<VideoGameSpecifics>,
    pub visual_novel_specifics: Option<VisualNovelSpecifics>,
    pub external_identifiers: Option<MetadataExternalIdentifiers>,
}

#[derive(Debug, Default, InputObject)]
pub struct CommitPersonInput {
    pub name: String,
    pub identifier: String,
    pub source: MediaSource,
    pub image: Option<String>,
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
    Eq,
    Hash,
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
#[graphql(input_name = "UniqueMediaIdentifierInput")]
pub struct UniqueMediaIdentifier {
    pub lot: MediaLot,
    pub identifier: String,
    pub source: MediaSource,
}

#[skip_serializing_none]
#[derive(
    Eq, Hash, Clone, Debug, Default, PartialEq, Serialize, Deserialize, FromJsonQueryResult,
)]
pub struct CommitMetadataGroupInput {
    pub name: String,
    pub parts: Option<usize>,
    pub image: Option<String>,
    pub unique: UniqueMediaIdentifier,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct CreateCustomMetadataGroupInput {
    pub title: String,
    pub lot: MediaLot,
    pub assets: EntityAssets,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct CreateCustomPersonInput {
    pub name: String,
    pub assets: EntityAssets,
    pub place: Option<String>,
    pub gender: Option<String>,
    pub website: Option<String>,
    pub description: Option<String>,
    pub birth_date: Option<NaiveDate>,
    pub death_date: Option<NaiveDate>,
    pub alternate_names: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct UpdateCustomMetadataGroupInput {
    pub existing_metadata_group_id: String,
    pub update: CreateCustomMetadataGroupInput,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct UpdateCustomPersonInput {
    pub existing_person_id: String,
    pub update: CreateCustomPersonInput,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct CreateCustomMetadataInput {
    pub lot: MediaLot,
    pub title: String,
    pub assets: EntityAssets,
    pub is_nsfw: Option<bool>,
    pub publish_year: Option<i32>,
    pub description: Option<String>,
    pub genres: Option<Vec<String>>,
    pub group_ids: Option<Vec<String>>,
    pub publish_date: Option<NaiveDate>,
    pub creator_ids: Option<Vec<String>>,
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
pub struct MetadataLookupInput {
    pub title: String,
    pub runtime: Option<Decimal>,
    pub document_title: Option<String>,
}

#[skip_serializing_none]
#[derive(Debug, PartialEq, Eq, Default, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MetadataCreator {
    pub is_free: bool,
    pub id_or_name: String,
    pub character: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MetadataCreatorsGroupedByRole {
    pub name: String,
    pub items: Vec<MetadataCreator>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct GraphqlMetadataGroup {
    pub part: i32,
    pub id: String,
}

#[skip_serializing_none]
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct GraphqlMetadataDetails {
    pub id: String,
    pub title: String,
    pub lot: MediaLot,
    pub identifier: String,
    pub source: MediaSource,
    pub assets: EntityAssets,
    pub is_nsfw: Option<bool>,
    pub is_partial: Option<bool>,
    pub suggestions: Vec<String>,
    pub publish_year: Option<i32>,
    pub source_url: Option<String>,
    pub genres: Vec<GenreListItem>,
    pub description: Option<String>,
    pub publish_date: Option<NaiveDate>,
    pub provider_rating: Option<Decimal>,
    pub groups: Vec<GraphqlMetadataGroup>,
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
    pub creators: Vec<MetadataCreatorsGroupedByRole>,
    pub audio_book_specifics: Option<AudioBookSpecifics>,
    pub video_game_specifics: Option<VideoGameSpecifics>,
    pub visual_novel_specifics: Option<VisualNovelSpecifics>,
    pub external_identifiers: Option<MetadataExternalIdentifiers>,
}
