use anyhow::Result;
use async_trait::async_trait;
use common_models::{MetadataSearchSourceSpecifics, PersonSourceSpecifics};
use config::SpotifyConfig;
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{PersonDetails, SearchResults};
use media_models::{
    MetadataDetails, MetadataGroupSearchItem, MetadataSearchItem, PartialMetadataWithoutId,
    PeopleSearchItem,
};
use traits::MediaProvider;

pub struct SpotifyService {
    config: SpotifyConfig,
}

impl SpotifyService {
    pub async fn new(config: &SpotifyConfig) -> Self {
        Self {
            config: config.clone(),
        }
    }
}

#[async_trait]
impl MediaProvider for SpotifyService {
    async fn metadata_details(&self, _identifier: &str) -> Result<MetadataDetails> {
        todo!("Implement Spotify metadata_details")
    }

    async fn metadata_search(
        &self,
        _query: &str,
        _page: Option<i32>,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        todo!("Implement Spotify metadata_search")
    }

    async fn metadata_group_details(
        &self,
        _identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        todo!("Implement Spotify metadata_group_details")
    }

    async fn metadata_group_search(
        &self,
        _query: &str,
        _page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataGroupSearchItem>> {
        todo!("Implement Spotify metadata_group_search")
    }

    async fn person_details(
        &self,
        _identifier: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        todo!("Implement Spotify person_details")
    }

    async fn people_search(
        &self,
        _query: &str,
        _page: Option<i32>,
        _display_nsfw: bool,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        todo!("Implement Spotify people_search")
    }
}
