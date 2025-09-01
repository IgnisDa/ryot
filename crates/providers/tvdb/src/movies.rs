use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{MetadataSearchSourceSpecifics, SearchResults};
use media_models::{
    MetadataDetails, MetadataGroupSearchItem, MetadataSearchItem, PartialMetadataWithoutId,
};
use supporting_service::SupportingService;
use traits::MediaProvider;

use crate::base::TvdbService;

pub struct TvdbMovieService {
    pub base: TvdbService,
}

impl TvdbMovieService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        Ok(Self {
            base: TvdbService::new(ss).await?,
        })
    }
}

#[async_trait]
impl MediaProvider for TvdbMovieService {
    async fn metadata_search(
        &self,
        _query: &str,
        _page: Option<i32>,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        todo!("Implement TVDB movie search")
    }

    async fn metadata_details(&self, _identifier: &str) -> Result<MetadataDetails> {
        todo!("Implement TVDB movie details")
    }

    async fn metadata_group_search(
        &self,
        _query: &str,
        _page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataGroupSearchItem>> {
        todo!("Implement TVDB movie group search")
    }

    async fn metadata_group_details(
        &self,
        _identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        todo!("Implement TVDB movie group details")
    }

    async fn get_trending_media(&self) -> Result<Vec<PartialMetadataWithoutId>> {
        todo!("Implement TVDB movie trending")
    }
}
