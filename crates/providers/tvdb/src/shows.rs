use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use common_models::SearchDetails;
use dependent_models::{MetadataSearchSourceSpecifics, SearchResults};
use itertools::Itertools;
use media_models::{MetadataDetails, MetadataSearchItem};
use supporting_service::SupportingService;
use traits::MediaProvider;

use crate::{
    base::TvdbService,
    models::{TvdbSearchResponse, URL},
};

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
        page: i32,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let limit = 20;
        let offset = (page - 1) * limit;

        let rsp = self
            .base
            .client
            .get(format!("{URL}/search"))
            .query(&[
                ("query", query),
                ("type", "series"),
                ("limit", &limit.to_string()),
                ("offset", &offset.to_string()),
            ])
            .send()
            .await?;
        let search: TvdbSearchResponse = rsp.json().await?;

        let resp = search
            .data
            .into_iter()
            .map(|d| MetadataSearchItem {
                identifier: d.tvdb_id,
                image: d.poster.or(d.image_url),
                title: d.title.or(d.name).unwrap_or_default(),
                ..Default::default()
            })
            .collect_vec();

        let next_page = search
            .links
            .as_ref()
            .and_then(|l| l.next.as_ref())
            .is_some()
            .then(|| page + 1);
        let total_items = search.links.and_then(|l| l.total_items).unwrap_or(0);

        Ok(SearchResults {
            items: resp,
            details: SearchDetails {
                next_page,
                total_items,
            },
        })
    }

    async fn metadata_details(&self, _identifier: &str) -> Result<MetadataDetails> {
        todo!("Implement TVDB show details")
    }
}
