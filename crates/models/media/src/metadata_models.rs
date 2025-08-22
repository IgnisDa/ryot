use async_graphql::{InputObject, SimpleObject};
use boilermates::boilermates;
use chrono::NaiveDate;
use common_models::{EntityAssets, PersonSourceSpecifics};
use enum_models::{EntityLot, MediaLot, MediaSource};
use rust_decimal::Decimal;
use sea_orm::{FromJsonQueryResult, FromQueryResult};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use std::collections::HashSet;

use crate::{
    AnimeSpecifics, AudioBookSpecifics, BookSpecifics, MangaSpecifics, MovieSpecifics,
    MusicSpecifics, PodcastSpecifics, ShowSpecifics, VideoGameSpecifics, VisualNovelSpecifics,
};

#[derive(Debug, PartialEq, Eq, Default, SimpleObject, Serialize, Deserialize, Clone)]
pub struct EntityWithLot {
    pub entity_id: String,
    pub entity_lot: EntityLot,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, FromQueryResult)]
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
    pub lot: MediaLot,
    pub title: String,
    pub identifier: String,
    pub genres: Vec<String>,
    pub source: MediaSource,
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
pub struct CreateCustomMetadataInput {
    pub title: String,
    pub lot: MediaLot,
    pub assets: EntityAssets,
    pub is_nsfw: Option<bool>,
    pub publish_year: Option<i32>,
    pub description: Option<String>,
    pub genres: Option<Vec<String>>,
    pub creators: Option<Vec<String>>,
    pub publish_date: Option<NaiveDate>,
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

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct GraphqlMetadataGroup {
    pub id: String,
    pub name: String,
    pub part: i32,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
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
