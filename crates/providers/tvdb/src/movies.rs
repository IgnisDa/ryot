use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use common_models::{
    EntityAssets, EntityRemoteVideo, EntityRemoteVideoSource, PersonSourceSpecifics,
};
use common_utils::{convert_date_to_year, convert_string_to_date};
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{MetadataSearchSourceSpecifics, SearchResults};
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    CommitMetadataGroupInput, EntityTranslationDetails, MetadataDetails, MetadataSearchItem,
    MovieSpecifics, PartialMetadataPerson, PartialMetadataWithoutId, UniqueMediaIdentifier,
};
use supporting_service::SupportingService;
use traits::MediaProvider;

use crate::{
    base::TvdbService,
    models::{TvdbListDetailsResponse, TvdbMovieExtendedResponse, URL},
};

pub struct TvdbMovieService(TvdbService);

impl TvdbMovieService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        Ok(Self(TvdbService::new(ss).await?))
    }
}

#[async_trait]
impl MediaProvider for TvdbMovieService {
    async fn metadata_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        self.0.trigger_search(page, query, "movie").await
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let rsp = self
            .0
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
                    .filter_map(
                        |chr| match (chr.people_id, chr.person_name, chr.people_type) {
                            (Some(id), Some(name), Some(role)) => Some(PartialMetadataPerson {
                                name,
                                role,
                                character: chr.name,
                                source: MediaSource::Tvdb,
                                identifier: id.to_string(),
                                ..Default::default()
                            }),
                            _ => None,
                        },
                    )
                    .collect_vec(),
            );
        }

        if let Some(companies) = movie_data.companies {
            let all_companies = [
                (companies.studio.as_ref(), "Studio"),
                (companies.network.as_ref(), "Network"),
                (companies.distributor.as_ref(), "Distributor"),
                (companies.production.as_ref(), "Production Company"),
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

        let source_url = movie_data
            .common
            .slug
            .map(|slug| format!("https://thetvdb.com/movies/{}", slug));

        let groups = movie_data
            .lists
            .unwrap_or_default()
            .into_iter()
            .filter(|l| l.is_official.unwrap_or(false))
            .map(|l| CommitMetadataGroupInput {
                name: l.name.unwrap_or_else(|| "Loading...".to_string()),
                image: l.image,
                unique: UniqueMediaIdentifier {
                    lot: MediaLot::Movie,
                    source: MediaSource::Tvdb,
                    identifier: l.id.to_string(),
                },
                ..Default::default()
            })
            .collect();

        Ok(MetadataDetails {
            genres,
            people,
            groups,
            source_url,
            publish_date,
            publish_year,
            title: title.clone(),
            description: movie_data.common.overview,
            movie_specifics: Some(MovieSpecifics {
                runtime: movie_data.runtime,
            }),
            original_language: self
                .0
                .get_language_name(movie_data.common.original_language),
            assets: EntityAssets {
                remote_images,
                remote_videos,
                ..Default::default()
            },
            ..Default::default()
        })
    }

    async fn metadata_group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        let rsp = self
            .0
            .client
            .get(format!("{URL}/lists/{identifier}/extended"))
            .send()
            .await?;
        let data: TvdbListDetailsResponse = rsp.json().await?;
        let list_data = data.data;

        let mut images = vec![];
        if let Some(image) = list_data.image.clone() {
            images.push(image);
        }

        let parts = list_data
            .entities
            .unwrap_or_default()
            .into_iter()
            .sorted_by_key(|e| e.order)
            .filter_map(|entity| {
                entity.movie_id.map(|id| PartialMetadataWithoutId {
                    lot: MediaLot::Movie,
                    source: MediaSource::Tvdb,
                    identifier: id.to_string(),
                    title: "Loading...".to_string(),
                    ..Default::default()
                })
            })
            .collect_vec();

        let list_name = list_data.name.unwrap_or_else(|| "Unnamed List".to_string());

        let source_url = list_data
            .url
            .map(|f| format!("https://thetvdb.com/lists/{}", f));

        Ok((
            MetadataGroupWithoutId {
                source_url,
                lot: MediaLot::Movie,
                title: list_name.clone(),
                source: MediaSource::Tvdb,
                description: list_data.overview,
                identifier: identifier.to_owned(),
                parts: parts.len().try_into().unwrap(),
                assets: EntityAssets {
                    remote_images: images,
                    ..Default::default()
                },
                ..Default::default()
            },
            parts,
        ))
    }

    async fn translate_metadata(
        &self,
        identifier: &str,
        target_language: &str,
    ) -> Result<EntityTranslationDetails> {
        self.0
            .translate("movies", identifier, target_language)
            .await
    }

    async fn translate_metadata_group(
        &self,
        identifier: &str,
        target_language: &str,
    ) -> Result<EntityTranslationDetails> {
        self.0.translate("lists", identifier, target_language).await
    }
}
