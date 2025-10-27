use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use common_models::{
    EntityAssets, EntityRemoteVideo, EntityRemoteVideoSource, PersonSourceSpecifics, SearchDetails,
};
use common_utils::{convert_date_to_year, convert_string_to_date};
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{MetadataSearchSourceSpecifics, SearchResults};
use enum_models::{MediaLot, MediaSource};
use futures::try_join;
use itertools::Itertools;
use media_models::{
    CommitMetadataGroupInput, MetadataDetails, MetadataGroupSearchItem, MetadataSearchItem,
    MovieSpecifics, PartialMetadataPerson, PartialMetadataWithoutId, UniqueMediaIdentifier,
};
use rust_decimal::dec;
use supporting_service::SupportingService;
use traits::MediaProvider;

use crate::{base::TmdbService, models::*};

pub struct TmdbMovieService(TmdbService);

impl TmdbMovieService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        Ok(Self(TmdbService::new(ss).await?))
    }
}

#[async_trait]
impl MediaProvider for TmdbMovieService {
    async fn metadata_search(
        &self,
        page: u64,
        query: &str,
        display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let rsp = self
            .0
            .client
            .get(format!("{URL}/search/movie"))
            .query(&[
                ("query", query),
                ("page", &page.to_string()),
                ("language", self.0.language.as_str()),
                ("include_adult", &display_nsfw.to_string()),
            ])
            .send()
            .await?;
        let search: TmdbListResponse = rsp.json().await?;

        let resp = search
            .results
            .into_iter()
            .map(|d| MetadataSearchItem {
                title: d.title.unwrap(),
                identifier: d.id.to_string(),
                image: d.poster_path.map(|p| self.0.get_image_url(p)),
                publish_year: d.release_date.and_then(|r| convert_date_to_year(&r)),
            })
            .collect_vec();
        let next_page = (page < search.total_pages).then(|| page + 1);
        Ok(SearchResults {
            items: resp.to_vec(),
            details: SearchDetails {
                next_page,
                total_items: search.total_results,
            },
        })
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let rsp = self
            .0
            .client
            .get(format!("{URL}/movie/{identifier}"))
            .query(&[
                ("append_to_response", "videos"),
                ("language", self.0.language.as_str()),
            ])
            .send()
            .await?;
        let data: TmdbMediaEntry = rsp.json().await?;
        let mut remote_videos = vec![];
        if let Some(vid) = data.videos {
            remote_videos.extend(vid.results.into_iter().map(|vid| EntityRemoteVideo {
                url: vid.key,
                source: EntityRemoteVideoSource::Youtube,
            }))
        }
        let rsp = self
            .0
            .client
            .get(format!("{URL}/movie/{identifier}/credits"))
            .query(&[("language", self.0.language.as_str())])
            .send()
            .await?;
        let credits: TmdbCreditsResponse = rsp.json().await?;
        let mut people = vec![];
        people.extend(
            credits
                .cast
                .clone()
                .into_iter()
                .flat_map(|g| {
                    g.id.and_then(|id| {
                        g.known_for_department.map(|r| PartialMetadataPerson {
                            role: r,
                            character: g.character,
                            source: MediaSource::Tmdb,
                            identifier: id.to_string(),
                            name: g.name.unwrap_or_default(),
                            ..Default::default()
                        })
                    })
                })
                .unique()
                .collect_vec(),
        );
        people.extend(
            credits
                .crew
                .clone()
                .into_iter()
                .flat_map(|g| {
                    g.id.and_then(|id| {
                        g.known_for_department.map(|r| PartialMetadataPerson {
                            role: r,
                            character: g.character,
                            source: MediaSource::Tmdb,
                            identifier: id.to_string(),
                            name: g.name.unwrap_or_default(),
                            ..Default::default()
                        })
                    })
                })
                .unique()
                .collect_vec(),
        );
        people.extend(
            data.production_companies
                .unwrap_or_default()
                .into_iter()
                .map(|p| PartialMetadataPerson {
                    name: p.name,
                    source: MediaSource::Tmdb,
                    identifier: p.id.to_string(),
                    role: "Production Company".to_owned(),
                    source_specifics: Some(PersonSourceSpecifics {
                        is_tmdb_company: Some(true),
                        ..Default::default()
                    }),
                    ..Default::default()
                })
                .collect_vec(),
        );
        let mut image_ids = Vec::from_iter(data.poster_path.map(|p| self.0.get_image_url(p)));
        if let Some(u) = data.backdrop_path {
            image_ids.push(self.0.get_image_url(u));
        }
        let ((), suggestions, watch_providers, external_identifiers) = try_join!(
            self.0.save_all_images("movie", identifier, &mut image_ids),
            self.0.get_all_suggestions("movie", identifier),
            self.0.get_all_watch_providers("movie", identifier),
            self.0.get_external_identifiers("movie", identifier)
        )?;
        let title = data.title.clone().unwrap();

        let remote_images = image_ids.into_iter().unique().collect();

        Ok(MetadataDetails {
            people,
            suggestions,
            watch_providers,
            is_nsfw: data.adult,
            title: title.clone(),
            description: data.overview,
            production_status: data.status.clone(),
            external_identifiers: Some(external_identifiers),
            original_language: self.0.get_language_name(data.original_language.clone()),
            publish_date: data
                .release_date
                .clone()
                .and_then(|r| convert_string_to_date(&r)),
            genres: data
                .genres
                .unwrap_or_default()
                .into_iter()
                .map(|g| g.name)
                .collect(),
            assets: EntityAssets {
                remote_images,
                remote_videos,
                ..Default::default()
            },
            publish_year: data
                .release_date
                .as_ref()
                .and_then(|r| convert_date_to_year(r)),
            movie_specifics: Some(MovieSpecifics {
                runtime: data.runtime,
            }),
            source_url: Some(format!(
                "https://www.themoviedb.org/movie/{}-{}",
                data.id, title
            )),
            provider_rating: data
                .vote_average
                .filter(|&av| av != dec!(0))
                .map(|av| av * dec!(10)),
            groups: Vec::from_iter(data.belongs_to_collection)
                .into_iter()
                .map(|c| CommitMetadataGroupInput {
                    name: "Loading...".to_string(),
                    unique: UniqueMediaIdentifier {
                        lot: MediaLot::Movie,
                        source: MediaSource::Tmdb,
                        identifier: c.id.to_string(),
                    },
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        })
    }

    async fn metadata_group_search(
        &self,
        page: u64,
        query: &str,
        display_nsfw: bool,
    ) -> Result<SearchResults<MetadataGroupSearchItem>> {
        let rsp = self
            .0
            .client
            .get(format!("{URL}/search/collection"))
            .query(&[
                ("query", query),
                ("page", &page.to_string()),
                ("language", self.0.language.as_str()),
                ("include_adult", &display_nsfw.to_string()),
            ])
            .send()
            .await?;
        let search: TmdbListResponse = rsp.json().await?;
        let resp = search
            .results
            .into_iter()
            .map(|d| MetadataGroupSearchItem {
                name: d.title.unwrap(),
                identifier: d.id.to_string(),
                image: d.poster_path.map(|p| self.0.get_image_url(p)),
                ..Default::default()
            })
            .collect_vec();
        let next_page = (page < search.total_pages).then(|| page + 1);
        Ok(SearchResults {
            items: resp,
            details: SearchDetails {
                next_page,
                total_items: search.total_results,
            },
        })
    }

    async fn metadata_group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        let data: TmdbCollection = self
            .0
            .client
            .get(format!("{URL}/collection/{identifier}"))
            .query(&[("language", self.0.language.as_str())])
            .send()
            .await?
            .json()
            .await?;
        let mut images = vec![];
        if let Some(i) = data.poster_path {
            images.push(self.0.get_image_url(i));
        }
        if let Some(i) = data.backdrop_path {
            images.push(self.0.get_image_url(i));
        }
        self.0
            .save_all_images("collection", identifier, &mut images)
            .await?;
        let parts = data
            .parts
            .into_iter()
            .map(|p| PartialMetadataWithoutId {
                lot: MediaLot::Movie,
                title: p.title.unwrap(),
                source: MediaSource::Tmdb,
                identifier: p.id.to_string(),
                image: p.poster_path.map(|p| self.0.get_image_url(p)),
                ..Default::default()
            })
            .collect_vec();
        let title = replace_from_end(data.name, " Collection", "");
        Ok((
            MetadataGroupWithoutId {
                lot: MediaLot::Movie,
                title: title.clone(),
                source: MediaSource::Tmdb,
                description: data.overview,
                identifier: identifier.to_owned(),
                parts: parts.len().try_into().unwrap(),
                source_url: Some(format!(
                    "https://www.themoviedb.org/collections/{identifier}-{title}"
                )),
                assets: EntityAssets {
                    remote_images: images,
                    ..Default::default()
                },
            },
            parts,
        ))
    }

    async fn get_trending_media(&self) -> Result<Vec<PartialMetadataWithoutId>> {
        self.0.get_trending_media("movie").await
    }
}

fn replace_from_end(input_string: String, search_string: &str, replace_string: &str) -> String {
    if let Some(last_index) = input_string.rfind(search_string) {
        let mut modified_string = input_string.clone();
        let end = last_index + search_string.len();
        modified_string.replace_range(last_index..end, replace_string);
        return modified_string;
    }
    input_string
}
