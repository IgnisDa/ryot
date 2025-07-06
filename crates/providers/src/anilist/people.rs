use anyhow::{Result, anyhow};
use async_trait::async_trait;
use chrono::NaiveDate;
use common_models::{EntityAssets, PersonSourceSpecifics, SearchDetails};
use common_utils::PAGE_SIZE;
use dependent_models::{MetadataPersonRelated, PersonDetails, SearchResults};
use enum_models::{MediaLot, MediaSource};
use graphql_client::{GraphQLQuery, Response};
use media_models::{PartialMetadataWithoutId, PeopleSearchItem};
use traits::MediaProvider;

use crate::anilist::base::AnilistService;
use crate::anilist::models::{
    STUDIO_ROLE, StaffQuery, StaffSearchQuery, StudioQuery, StudioSearchQuery, URL,
    get_in_preferred_language, staff_query, staff_search_query, studio_query, studio_search_query,
};

#[derive(Debug, Clone)]
pub struct NonMediaAnilistService {
    base: AnilistService,
}

impl NonMediaAnilistService {
    pub async fn new(config: &config::AnilistConfig) -> Self {
        Self {
            base: AnilistService::new(config).await,
        }
    }
}

#[async_trait]
impl MediaProvider for NonMediaAnilistService {
    async fn people_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let is_studio = matches!(
            source_specifics,
            Some(PersonSourceSpecifics {
                is_anilist_studio: Some(true),
                ..
            })
        );
        let (items, total, next_page) = if is_studio {
            let variables = studio_search_query::Variables {
                page: page.unwrap_or(1).into(),
                search: query.to_owned(),
                per_page: PAGE_SIZE.into(),
            };
            let body = StudioSearchQuery::build_query(variables);
            let search = self
                .base
                .client
                .post(URL)
                .json(&body)
                .send()
                .await
                .map_err(|e| anyhow!(e))?
                .json::<Response<studio_search_query::ResponseData>>()
                .await
                .map_err(|e| anyhow!(e))?
                .data
                .unwrap()
                .page
                .unwrap();
            let total = search.page_info.unwrap().total.unwrap().try_into().unwrap();
            let next_page =
                (total - (page.unwrap_or(1) * PAGE_SIZE) > 0).then(|| page.unwrap_or(1) + 1);
            let items = search
                .studios
                .unwrap()
                .into_iter()
                .map(|s| {
                    let data = s.unwrap();
                    PeopleSearchItem {
                        name: data.name,
                        identifier: data.id.to_string(),
                        ..Default::default()
                    }
                })
                .collect();
            (items, total, next_page)
        } else {
            let variables = staff_search_query::Variables {
                page: page.unwrap_or(1).into(),
                search: query.to_owned(),
                per_page: PAGE_SIZE.into(),
            };
            let body = StaffSearchQuery::build_query(variables);
            let search = self
                .base
                .client
                .post(URL)
                .json(&body)
                .send()
                .await
                .map_err(|e| anyhow!(e))?
                .json::<Response<staff_search_query::ResponseData>>()
                .await
                .map_err(|e| anyhow!(e))?
                .data
                .unwrap()
                .page
                .unwrap();
            let total = search.page_info.unwrap().total.unwrap().try_into().unwrap();
            let next_page =
                (total - (page.unwrap_or(1) * PAGE_SIZE) > 0).then(|| page.unwrap_or(1) + 1);
            let items = search
                .staff
                .unwrap()
                .into_iter()
                .map(|s| {
                    let data = s.unwrap();
                    PeopleSearchItem {
                        identifier: data.id.to_string(),
                        name: data.name.unwrap().full.unwrap(),
                        image: data.image.and_then(|i| i.medium),
                        birth_year: data
                            .date_of_birth
                            .and_then(|b| b.year.map(|y| y.try_into().unwrap())),
                    }
                })
                .collect();
            (items, total, next_page)
        };
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items,
        })
    }

    async fn person_details(
        &self,
        identity: &str,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        let is_studio = matches!(
            source_specifics,
            Some(PersonSourceSpecifics {
                is_anilist_studio: Some(true),
                ..
            })
        );
        let data = if is_studio {
            let variables = studio_query::Variables {
                id: identity.parse::<i64>().unwrap(),
            };
            let body = StudioQuery::build_query(variables);
            let details = self
                .base
                .client
                .post(URL)
                .json(&body)
                .send()
                .await
                .map_err(|e| anyhow!(e))?
                .json::<Response<studio_query::ResponseData>>()
                .await
                .map_err(|e| anyhow!(e))?
                .data
                .unwrap()
                .studio
                .unwrap();
            let related_metadata = details
                .media
                .unwrap()
                .edges
                .unwrap()
                .into_iter()
                .map(|r| {
                    let data = r.unwrap().node.unwrap();
                    MetadataPersonRelated {
                        role: STUDIO_ROLE.to_owned(),
                        metadata: PartialMetadataWithoutId {
                            source: MediaSource::Anilist,
                            identifier: data.id.to_string(),
                            title: data.title.unwrap().native.unwrap(),
                            image: data.cover_image.unwrap().extra_large,
                            lot: match data.type_.unwrap() {
                                studio_query::MediaType::ANIME => MediaLot::Anime,
                                studio_query::MediaType::MANGA => MediaLot::Manga,
                                studio_query::MediaType::Other(_) => unreachable!(),
                            },
                            ..Default::default()
                        },
                        ..Default::default()
                    }
                })
                .collect();
            PersonDetails {
                related_metadata,
                name: details.name,
                website: details.site_url,
                source: MediaSource::Anilist,
                identifier: details.id.to_string(),
                source_specifics: source_specifics.to_owned(),
                ..Default::default()
            }
        } else {
            let variables = staff_query::Variables {
                id: identity.parse::<i64>().unwrap(),
            };
            let body = StaffQuery::build_query(variables);
            let details = self
                .base
                .client
                .post(URL)
                .json(&body)
                .send()
                .await
                .map_err(|e| anyhow!(e))?
                .json::<Response<staff_query::ResponseData>>()
                .await
                .map_err(|e| anyhow!(e))?
                .data
                .unwrap()
                .staff
                .unwrap();
            let images = Vec::from_iter(details.image.and_then(|i| i.large));
            let birth_date = details.date_of_birth.and_then(|d| {
                if let (Some(y), Some(m), Some(d)) = (d.year, d.month, d.day) {
                    NaiveDate::from_ymd_opt(
                        y.try_into().unwrap(),
                        m.try_into().unwrap(),
                        d.try_into().unwrap(),
                    )
                } else {
                    None
                }
            });
            let death_date = details.date_of_death.and_then(|d| {
                if let (Some(y), Some(m), Some(d)) = (d.year, d.month, d.day) {
                    NaiveDate::from_ymd_opt(
                        y.try_into().unwrap(),
                        m.try_into().unwrap(),
                        d.try_into().unwrap(),
                    )
                } else {
                    None
                }
            });
            let mut related_metadata = vec![];
            details
                .character_media
                .unwrap()
                .edges
                .unwrap()
                .into_iter()
                .for_each(|r| {
                    let edge = r.unwrap();
                    let characters = edge.characters.unwrap_or_default();
                    let data = edge.node.unwrap();
                    let title = data.title.unwrap();
                    let title = get_in_preferred_language(
                        title.native,
                        title.english,
                        title.romaji,
                        &self.base.preferred_language,
                    );
                    for character in characters {
                        if let Some(character) = character.and_then(|c| c.name) {
                            related_metadata.push(MetadataPersonRelated {
                                character: character.full,
                                role: "Voicing".to_owned(),
                                metadata: PartialMetadataWithoutId {
                                    title: title.clone(),
                                    source: MediaSource::Anilist,
                                    identifier: data.id.to_string(),
                                    image: data.cover_image.clone().unwrap().extra_large,
                                    lot: match data.type_.clone().unwrap() {
                                        staff_query::MediaType::ANIME => MediaLot::Anime,
                                        staff_query::MediaType::MANGA => MediaLot::Manga,
                                        staff_query::MediaType::Other(_) => unreachable!(),
                                    },
                                    ..Default::default()
                                },
                            })
                        }
                    }
                });
            related_metadata.extend(details.staff_media.unwrap().edges.unwrap().into_iter().map(
                |r| {
                    let edge = r.unwrap();
                    let data = edge.node.unwrap();
                    let title = data.title.unwrap();
                    let title = get_in_preferred_language(
                        title.native,
                        title.english,
                        title.romaji,
                        &self.base.preferred_language,
                    );
                    MetadataPersonRelated {
                        role: edge.staff_role.unwrap_or_else(|| "Production".to_owned()),
                        metadata: PartialMetadataWithoutId {
                            title,
                            source: MediaSource::Anilist,
                            identifier: data.id.to_string(),
                            image: data.cover_image.unwrap().extra_large,
                            lot: match data.type_.unwrap() {
                                staff_query::MediaType::ANIME => MediaLot::Anime,
                                staff_query::MediaType::MANGA => MediaLot::Manga,
                                staff_query::MediaType::Other(_) => unreachable!(),
                            },
                            ..Default::default()
                        },
                        ..Default::default()
                    }
                },
            ));
            PersonDetails {
                related_metadata,
                death_date,
                birth_date,
                assets: EntityAssets {
                    remote_images: images,
                    ..Default::default()
                },
                gender: details.gender,
                place: details.home_town,
                source: MediaSource::Anilist,
                description: details.description,
                identifier: details.id.to_string(),
                name: details.name.unwrap().full.unwrap(),
                source_specifics: source_specifics.to_owned(),
                ..Default::default()
            }
        };
        Ok(data)
    }
}
