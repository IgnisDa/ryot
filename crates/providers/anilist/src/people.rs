use anyhow::Result;
use async_trait::async_trait;
use chrono::NaiveDate;
use common_models::{EntityAssets, PersonSourceSpecifics, SearchDetails};
use common_utils::{PAGE_SIZE, compute_next_page};
use dependent_models::{MetadataPersonRelated, PersonDetails, SearchResults};
use enum_models::{MediaLot, MediaSource};
use media_models::{PartialMetadataWithoutId, PeopleSearchItem};
use traits::MediaProvider;

use crate::{
    base::AnilistService,
    models::{
        GraphQLResponse, MediaSearchResponse, STUDIO_ROLE, StaffDetailsResponse,
        StudioDetailsResponse, URL, build_staff_details_query, build_staff_search_query,
        build_studio_details_query, build_studio_search_query, get_in_preferred_language,
    },
};

#[derive(Debug, Clone)]
pub struct NonMediaAnilistService(AnilistService);

impl NonMediaAnilistService {
    pub async fn new(config: &config_definition::AnilistConfig) -> Result<Self> {
        Ok(Self(AnilistService::new(config).await?))
    }
}

#[async_trait]
impl MediaProvider for NonMediaAnilistService {
    async fn people_search(
        &self,
        page: u64,
        query: &str,
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
        let (items, total_items, next_page) = if is_studio {
            let body = build_studio_search_query(query, page, PAGE_SIZE);
            let search = self
                .0
                .client
                .post(URL)
                .json(&body)
                .send()
                .await?
                .json::<GraphQLResponse<MediaSearchResponse>>()
                .await?
                .data
                .unwrap()
                .page
                .unwrap();
            let total = search.page_info.unwrap().total.unwrap();
            let next_page = compute_next_page(page, PAGE_SIZE, total);
            let items = search
                .studios
                .unwrap_or_default()
                .into_iter()
                .flatten()
                .map(|data| PeopleSearchItem {
                    name: data.name,
                    identifier: data.id.to_string(),
                    ..Default::default()
                })
                .collect();
            (items, total, next_page)
        } else {
            let body = build_staff_search_query(query, page, PAGE_SIZE);
            let search = self
                .0
                .client
                .post(URL)
                .json(&body)
                .send()
                .await?
                .json::<GraphQLResponse<MediaSearchResponse>>()
                .await?
                .data
                .unwrap()
                .page
                .unwrap();
            let total_items = search.page_info.unwrap().total.unwrap();
            let next_page = compute_next_page(page, PAGE_SIZE, total_items);
            let items = search
                .staff
                .unwrap_or_default()
                .into_iter()
                .flatten()
                .map(|data| PeopleSearchItem {
                    identifier: data.id.to_string(),
                    name: data.name.and_then(|n| n.full).unwrap_or_default(),
                    image: data.image.and_then(|i| i.medium),
                    birth_year: data.date_of_birth.and_then(|b| b.year),
                })
                .collect();
            (items, total_items, next_page)
        };
        Ok(SearchResults {
            items,
            details: SearchDetails {
                next_page,
                total_items,
            },
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
            let body = build_studio_details_query(identity.parse::<i64>().unwrap());
            let details = self
                .0
                .client
                .post(URL)
                .json(&body)
                .send()
                .await?
                .json::<GraphQLResponse<StudioDetailsResponse>>()
                .await?
                .data
                .unwrap()
                .studio
                .unwrap();
            let related_metadata = details
                .media
                .unwrap_or_default()
                .edges
                .unwrap_or_default()
                .into_iter()
                .flatten()
                .filter_map(|edge| edge.node)
                .map(|data| MetadataPersonRelated {
                    role: STUDIO_ROLE.to_owned(),
                    metadata: PartialMetadataWithoutId {
                        source: MediaSource::Anilist,
                        identifier: data.id.to_string(),
                        title: data.title.and_then(|t| t.native).unwrap_or_default(),
                        image: data.cover_image.and_then(|c| c.extra_large),
                        lot: match data.media_type.as_deref() {
                            Some("ANIME") => MediaLot::Anime,
                            Some("MANGA") => MediaLot::Manga,
                            _ => unreachable!(),
                        },
                        ..Default::default()
                    },
                    ..Default::default()
                })
                .collect();
            PersonDetails {
                related_metadata,
                name: details.name,
                website: details.site_url,
                source_specifics: source_specifics.to_owned(),
                ..Default::default()
            }
        } else {
            let body = build_staff_details_query(identity.parse::<i64>().unwrap());
            let details = self
                .0
                .client
                .post(URL)
                .json(&body)
                .send()
                .await?
                .json::<GraphQLResponse<StaffDetailsResponse>>()
                .await?
                .data
                .unwrap()
                .staff
                .unwrap();
            let images = Vec::from_iter(details.image.and_then(|i| i.large));
            let birth_date = details
                .date_of_birth
                .and_then(|d| match (d.year, d.month, d.day) {
                    (Some(y), Some(m), Some(d)) => NaiveDate::from_ymd_opt(y, m, d),
                    _ => None,
                });
            let death_date = details
                .date_of_death
                .and_then(|d| match (d.year, d.month, d.day) {
                    (Some(y), Some(m), Some(d)) => NaiveDate::from_ymd_opt(y, m, d),
                    _ => None,
                });
            let mut related_metadata = vec![];
            details
                .character_media
                .unwrap_or_default()
                .edges
                .unwrap_or_default()
                .into_iter()
                .flatten()
                .for_each(|edge| {
                    let characters = edge.characters.unwrap_or_default();
                    if let Some(data) = edge.node {
                        let title = data.title.as_ref();
                        let title = if let Some(title) = title {
                            get_in_preferred_language(
                                title.native.clone(),
                                title.english.clone(),
                                title.romaji.clone(),
                                &self.0.preferred_language,
                            )
                        } else {
                            String::new()
                        };
                        for character in characters {
                            if let Some(character) = character.and_then(|c| c.name) {
                                related_metadata.push(MetadataPersonRelated {
                                    character: character.full,
                                    role: "Voicing".to_owned(),
                                    metadata: PartialMetadataWithoutId {
                                        title: title.clone(),
                                        source: MediaSource::Anilist,
                                        identifier: data.id.to_string(),
                                        image: data
                                            .cover_image
                                            .as_ref()
                                            .and_then(|c| c.extra_large.clone()),
                                        lot: match data.media_type.as_deref() {
                                            Some("ANIME") => MediaLot::Anime,
                                            Some("MANGA") => MediaLot::Manga,
                                            _ => unreachable!(),
                                        },
                                        ..Default::default()
                                    },
                                })
                            }
                        }
                    }
                });
            related_metadata.extend(
                details
                    .staff_media
                    .unwrap_or_default()
                    .edges
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|edge| {
                        edge.and_then(|edge| {
                            edge.node.map(|data| {
                                let title = data.title.as_ref();
                                let title = if let Some(title) = title {
                                    get_in_preferred_language(
                                        title.native.clone(),
                                        title.english.clone(),
                                        title.romaji.clone(),
                                        &self.0.preferred_language,
                                    )
                                } else {
                                    String::new()
                                };
                                MetadataPersonRelated {
                                    role: edge
                                        .staff_role
                                        .unwrap_or_else(|| "Production".to_owned()),
                                    metadata: PartialMetadataWithoutId {
                                        title,
                                        source: MediaSource::Anilist,
                                        identifier: data.id.to_string(),
                                        image: data.cover_image.and_then(|c| c.extra_large),
                                        lot: match data.media_type.as_deref() {
                                            Some("ANIME") => MediaLot::Anime,
                                            Some("MANGA") => MediaLot::Manga,
                                            _ => unreachable!(),
                                        },
                                        ..Default::default()
                                    },
                                    ..Default::default()
                                }
                            })
                        })
                    }),
            );
            PersonDetails {
                death_date,
                birth_date,
                related_metadata,
                gender: details.gender,
                place: details.home_town,
                description: details.description,
                source_specifics: source_specifics.to_owned(),
                name: details.name.and_then(|n| n.full).unwrap_or_default(),
                assets: EntityAssets {
                    remote_images: images,
                    ..Default::default()
                },
                ..Default::default()
            }
        };
        Ok(data)
    }
}
