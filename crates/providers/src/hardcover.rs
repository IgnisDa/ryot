use anyhow::Result;
use application_utils::get_base_http_client;
use async_trait::async_trait;
use common_models::PersonSourceSpecifics;
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{
    MetadataGroupSearchResponse, PeopleSearchResponse, PersonDetails, SearchResults,
};
use media_models::{MetadataDetails, MetadataSearchItem, PartialMetadataWithoutId};
use reqwest::{
    header::{HeaderValue, AUTHORIZATION},
    Client,
};
use traits::MediaProvider;

pub struct HardcoverService {
    client: Client,
}

impl HardcoverService {
    pub async fn new(config: &config::HardcoverConfig) -> Self {
        let client = get_base_http_client(Some(vec![(
            AUTHORIZATION,
            HeaderValue::from_str(&config.api_key).unwrap(),
        )]));
        Self { client }
    }
}

#[async_trait]
impl MediaProvider for HardcoverService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        todo!()
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        todo!()
    }

    async fn metadata_group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        todo!()
    }

    async fn metadata_group_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<MetadataGroupSearchResponse> {
        todo!()
    }

    async fn person_details(
        &self,
        identifier: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        todo!()
    }

    async fn people_search(
        &self,
        query: &str,
        page: Option<i32>,
        _source_specifics: &Option<PersonSourceSpecifics>,
        _display_nsfw: bool,
    ) -> Result<PeopleSearchResponse> {
        todo!()
    }
}
