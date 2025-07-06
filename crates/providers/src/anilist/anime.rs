use anyhow::Result;
use async_trait::async_trait;
use common_models::SearchDetails;
use common_utils::PAGE_SIZE;
use dependent_models::SearchResults;
use media_models::MetadataDetails;
use media_models::MetadataSearchItem;
use traits::MediaProvider;

use crate::anilist::base::AnilistService;
use crate::anilist::models::{media_details, media_search_query, search};

#[derive(Debug, Clone)]
pub struct AnilistAnimeService {
    base: AnilistService,
}

impl AnilistAnimeService {
    pub async fn new(config: &config::AnilistConfig) -> Self {
        Self {
            base: AnilistService::new(config).await,
        }
    }
}

#[async_trait]
impl MediaProvider for AnilistAnimeService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let details =
            media_details(&self.base.client, identifier, &self.base.preferred_language).await?;
        Ok(details)
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let (items, total, next_page) = search(
            &self.base.client,
            media_search_query::MediaType::ANIME,
            query,
            page,
            PAGE_SIZE,
            display_nsfw,
            &self.base.preferred_language,
        )
        .await?;
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items,
        })
    }
}
