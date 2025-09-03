use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use common_models::{
    EntityAssets, EntityRemoteVideo, EntityRemoteVideoSource, PersonSourceSpecifics, SearchDetails,
};
use common_utils::{convert_date_to_year, convert_string_to_date};
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{MetadataSearchSourceSpecifics, SearchResults};
use enum_models::MediaSource;
use itertools::Itertools;
use media_models::{
    MetadataDetails, MetadataGroupSearchItem, MetadataSearchItem, MovieSpecifics,
    PartialMetadataPerson, PartialMetadataWithoutId,
};
use supporting_service::SupportingService;
use traits::MediaProvider;

use crate::{
    base::TvdbService,
    models::{TvdbMovieExtendedResponse, TvdbSearchResponse, URL},
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

        let (next_page, total_items) = search.get_pagination(page);

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

        Ok(SearchResults {
            items: resp,
            details: SearchDetails {
                next_page,
                total_items,
            },
        })
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let rsp = self
            .base
            .client
            .get(format!("{URL}/movies/{identifier}/extended"))
            .send()
            .await?;
        let data: TvdbMovieExtendedResponse = rsp.json().await?;
        let movie_data = data.data;

        let title = movie_data
            .common
            .name
            .or(movie_data.title.clone())
            .unwrap_or_default();

        let mut remote_images = vec![];
        if let Some(artworks) = movie_data.common.artworks {
            remote_images.extend(
                artworks
                    .into_iter()
                    .filter_map(|art| art.image)
                    .collect_vec(),
            );
        }
        if let Some(poster) = movie_data.common.image.clone() {
            remote_images.push(poster);
        }
        if let Some(image_url) = movie_data.image_url.clone() {
            remote_images.push(image_url);
        }

        let mut remote_videos = vec![];
        if let Some(trailers) = movie_data.common.trailers {
            remote_videos.extend(
                trailers
                    .into_iter()
                    .filter_map(|trailer| {
                        trailer.url.map(|url| EntityRemoteVideo {
                            url,
                            source: EntityRemoteVideoSource::Youtube,
                        })
                    })
                    .collect_vec(),
            );
        }

        let mut people = vec![];
        if let Some(characters) = movie_data.common.characters {
            people.extend(
                characters
                    .into_iter()
                    .filter_map(|char| match (char.person_name, char.people_type) {
                        (Some(name), Some(role)) => Some(PartialMetadataPerson {
                            name,
                            role,
                            character: char.name,
                            source: MediaSource::Tvdb,
                            identifier: char.id.map(|id| id.to_string()).unwrap_or_default(),
                            ..Default::default()
                        }),
                        _ => None,
                    })
                    .collect_vec(),
            );
        }

        if let Some(companies) = movie_data.companies {
            let all_companies = [
                (companies.studio.as_ref(), "Studio"),
                (companies.network.as_ref(), "Network"),
                (companies.production.as_ref(), "Production Company"),
                (companies.distributor.as_ref(), "Distributor"),
                (companies.special_effects.as_ref(), "Special Effects"),
            ];

            for (company_list, role) in all_companies {
                if let Some(companies) = company_list {
                    people.extend(
                        companies
                            .iter()
                            .map(|company| PartialMetadataPerson {
                                role: role.to_string(),
                                source: MediaSource::Tvdb,
                                name: company.name.clone(),
                                identifier: company.id.to_string(),
                                source_specifics: Some(PersonSourceSpecifics {
                                    is_tvdb_company: Some(true),
                                    ..Default::default()
                                }),
                                ..Default::default()
                            })
                            .collect_vec(),
                    );
                }
            }
        }

        let genres = movie_data
            .common
            .genres
            .unwrap_or_default()
            .into_iter()
            .map(|g| g.name)
            .collect_vec();

        let publish_date = movie_data
            .common
            .first_air_date
            .as_ref()
            .and_then(|date| convert_string_to_date(date));

        let publish_year = movie_data
            .common
            .year
            .and_then(|t| t.parse().ok())
            .or_else(|| {
                movie_data
                    .common
                    .first_air_date
                    .as_ref()
                    .and_then(|date| convert_date_to_year(date))
            });

        let source_url = Some(format!(
            "https://thetvdb.com/movies/{}",
            movie_data.common.slug.as_deref().unwrap_or(identifier)
        ));

        Ok(MetadataDetails {
            genres,
            people,
            source_url,
            publish_date,
            publish_year,
            title: title.clone(),
            description: movie_data.common.overview,
            movie_specifics: Some(MovieSpecifics {
                runtime: movie_data.runtime,
            }),
            original_language: self
                .base
                .get_language_name(movie_data.common.original_language),
            assets: EntityAssets {
                remote_images,
                remote_videos,
                ..Default::default()
            },
            ..Default::default()
        })
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
}
