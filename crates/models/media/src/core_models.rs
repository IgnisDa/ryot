use async_graphql::SimpleObject;
use common_models::StringIdAndNamedObject;
use enum_models::Visibility;
use rust_decimal::Decimal;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};

use crate::{
    ImportOrExportItemReviewComment, SeenAnimeExtraInformation, SeenMangaExtraInformation,
    SeenPodcastExtraOptionalInformation, SeenShowExtraOptionalInformation,
};

#[derive(Debug, PartialEq, Eq, Clone, Serialize, Deserialize, SimpleObject)]
pub struct ReviewItem {
    pub id: String,
    pub is_spoiler: bool,
    pub posted_on: DateTimeUtc,
    pub visibility: Visibility,
    pub rating: Option<Decimal>,
    pub posted_by: StringIdAndNamedObject,
    pub text_original: Option<String>,
    pub text_rendered: Option<String>,
    pub seen_items_associated_with: Vec<String>,
    pub comments: Vec<ImportOrExportItemReviewComment>,
    pub anime_extra_information: Option<SeenAnimeExtraInformation>,
    pub manga_extra_information: Option<SeenMangaExtraInformation>,
    pub show_extra_information: Option<SeenShowExtraOptionalInformation>,
    pub podcast_extra_information: Option<SeenPodcastExtraOptionalInformation>,
}

#[derive(Debug, Serialize, Default, Deserialize, SimpleObject, Clone)]
pub struct PersonDetailsItemWithCharacter {
    pub entity_id: String,
    pub character: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct PersonDetailsGroupedByRole {
    /// The name of the role performed.
    pub name: String,
    /// The media items in which this role was performed.
    pub items: Vec<PersonDetailsItemWithCharacter>,
}
