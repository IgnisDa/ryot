use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use common_models::SearchDetails;
use common_utils::convert_date_to_year;
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{MetadataSearchSourceSpecifics, SearchResults};
use itertools::Itertools;
use media_models::{
    MetadataDetails, MetadataGroupSearchItem, MetadataSearchItem, PartialMetadataWithoutId,
};
use supporting_service::SupportingService;
use traits::MediaProvider;

use crate::{
    base::TvdbService,
    models::{TvdbSearchResponse, URL},
};

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
                ("type", "movie"),
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
                identifier: d.id,
                image: d.poster.or(d.image_url),
                title: d.title.or(d.name).unwrap_or_default(),
                publish_year: d.year.and_then(|y| convert_date_to_year(&y)),
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
        todo!("Implement TVDB movie details")
    }

    async fn metadata_group_search(
        &self,
        _page: i32,
        _query: &str,
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
