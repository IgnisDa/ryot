use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use dependent_models::{MetadataSearchSourceSpecifics, SearchResults};
use media_models::{MetadataDetails, MetadataSearchItem};
use supporting_service::SupportingService;
use traits::MediaProvider;

use crate::base::TvdbService;

pub struct TvdbShowService {
    pub base: TvdbService,
}

impl TvdbShowService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        Ok(Self {
            base: TvdbService::new(ss).await?,
        })
    }
}

#[async_trait]
impl MediaProvider for TvdbShowService {
    async fn metadata_search(
        &self,
        _page: i32,
        _query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        todo!("Implement TVDB show search")
    }

    async fn metadata_details(&self, _identifier: &str) -> Result<MetadataDetails> {
        todo!("Implement TVDB show details")
    }
}
