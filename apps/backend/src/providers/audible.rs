use anyhow::{anyhow, Result};
use async_trait::async_trait;
use convert_case::{Case, Casing};
use database::{MetadataLot, MetadataSource};
use http_types::mime;
use itertools::Itertools;
use rs_utils::{convert_date_to_year, convert_string_to_date};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use strum::{Display, EnumIter, IntoEnumIterator};
use surf::{http::headers::ACCEPT, Client};

use crate::{
    entities::metadata_group::MetadataGroupWithoutId,
    models::{
        media::{
            AudioBookSpecifics, MediaDetails, MediaSearchItem, MediaSpecifics, MetadataFreeCreator,
            MetadataImageForMediaDetails, MetadataImageLot, MetadataPerson, PartialMetadataPerson,
            PartialMetadataWithoutId,
        },
        NamedObject, SearchDetails, SearchResults,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::get_base_http_client,
};

static LOCALES: [&str; 10] = ["au", "ca", "de", "es", "fr", "in", "it", "jp", "gb", "us"];
static AUDNEX_URL: &str = "https://api.audnex.us";

#[derive(EnumIter, Display)]
enum AudibleSimilarityType {
    InTheSameSeries,
    ByTheSameNarrator,
    RawSimilarities,
    ByTheSameAuthor,
    NextInSameSeries,
}

#[derive(Serialize, Deserialize)]
struct PrimaryQuery {
    response_groups: String,
    image_sizes: String,
}

impl Default for PrimaryQuery {
    fn default() -> Self {
        Self {
            response_groups: [
                "contributors",
                "category_ladders",
                "media",
                "product_attrs",
                "product_extended_attrs",
                "series",
                "relationships",
                "rating",
            ]
            .join(","),
            image_sizes: ["2400"].join(","),
        }
    }
}

#[derive(Serialize, Deserialize)]
struct SearchQuery {
    title: String,
    num_results: i32,
    page: i32,
    products_sort_by: String,
    #[serde(flatten)]
    primary: PrimaryQuery,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AudiblePoster {
    #[serde(rename = "2400")]
    image_2400: Option<String>,
    #[serde(rename = "500")]
    image_500: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AudibleCategoryLadderCollection {
    ladder: Vec<NamedObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AudibleRelationshipItem {
    asin: String,
    sort: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AudibleRating {
    display_average_rating: Option<Decimal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AudibleRatings {
    num_reviews: i32,
    overall_distribution: AudibleRating,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AudibleAuthor {
    asin: Option<String>,
    name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AudibleItem {
    asin: String,
    title: String,
    is_adult_product: Option<bool>,
    authors: Option<Vec<AudibleAuthor>>,
    narrators: Option<Vec<NamedObject>>,
    rating: Option<AudibleRatings>,
    product_images: Option<AudiblePoster>,
    merchandising_summary: Option<String>,
    publisher_summary: Option<String>,
    release_date: Option<String>,
    runtime_length_min: Option<i32>,
    category_ladders: Option<Vec<AudibleCategoryLadderCollection>>,
    series: Option<Vec<AudibleItem>>,
    relationships: Option<Vec<AudibleRelationshipItem>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct AudnexResponse {
    asin: String,
    name: String,
    image: Option<String>,
    description: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct AudibleItemResponse {
    product: AudibleItem,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct AudibleItemSimResponse {
    similar_products: Vec<AudibleItem>,
}

#[derive(Debug, Clone)]
pub struct AudibleService {
    client: Client,
    page_limit: i32,
    locale: String,
}

impl MediaProviderLanguages for AudibleService {
    fn supported_languages() -> Vec<String> {
        LOCALES.into_iter().map(String::from).collect()
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

impl AudibleService {
    fn url_from_locale(locale: &str) -> String {
        let suffix = match locale {
            "us" => "com",
            "ca" => "ca",
            "uk" => "co.uk",
            "au" => "co.au",
            "fr" => "fr",
            "de" => "de",
            "jp" => "co.jp",
            "it" => "it",
            "in" => "co.in",
            "es" => "es",
            _ => unreachable!(),
        };
        format!("https://api.audible.{}/1.0/catalog/products/", suffix)
    }

    pub async fn new(config: &config::AudibleConfig, page_limit: i32) -> Self {
        let url = Self::url_from_locale(&config.locale);
        let client = get_base_http_client(&url, vec![(ACCEPT, mime::JSON)]);
        Self {
            client,
            page_limit,
            locale: config.locale.clone(),
        }
    }
}

#[async_trait]
impl MediaProvider for AudibleService {
    async fn person_details(&self, identity: &PartialMetadataPerson) -> Result<MetadataPerson> {
        let data: AudnexResponse =
            surf::get(format!("{}/authors/{}", AUDNEX_URL, identity.identifier))
                .query(&json!({ "region": self.locale }))
                .unwrap()
                .await
                .map_err(|e| anyhow!(e))?
                .body_json()
                .await
                .map_err(|e| anyhow!(e))?;
        Ok(MetadataPerson {
            identifier: data.asin,
            name: data.name,
            description: data.description,
            images: Some(Vec::from_iter(data.image)),
            source: MetadataSource::Audible,
            gender: None,
            death_date: None,
            birth_date: None,
            place: None,
            website: None,
            related: vec![],
        })
    }

    async fn group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        let data: AudibleItemResponse = self
            .client
            .get(identifier)
            .query(&PrimaryQuery::default())
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?
            .body_json()
            .await
            .map_err(|e| anyhow!(e))?;
        let items = data
            .product
            .relationships
            .unwrap()
            .into_iter()
            .sorted_by_key(|f| f.sort.parse::<i32>().unwrap())
            .map(|i| i.asin)
            .collect_vec();
        let mut collection_contents = vec![];
        for i in items {
            let mut rsp = self
                .client
                .get(&i)
                .query(&PrimaryQuery::default())
                .unwrap()
                .await
                .map_err(|e| anyhow!(e))?;
            let data: AudibleItemResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
            collection_contents.push(PartialMetadataWithoutId {
                title: data.product.title,
                image: data.product.product_images.and_then(|i| i.image_2400),
                identifier: i,
                source: MetadataSource::Audible,
                lot: MetadataLot::AudioBook,
            })
        }
        Ok((
            MetadataGroupWithoutId {
                display_images: vec![],
                parts: collection_contents.len().try_into().unwrap(),
                identifier: identifier.to_owned(),
                title: data.product.title,
                description: None,
                images: vec![],
                lot: MetadataLot::AudioBook,
                source: MetadataSource::Audible,
            },
            collection_contents,
        ))
    }

    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let mut rsp = self
            .client
            .get(identifier)
            .query(&PrimaryQuery::default())
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: AudibleItemResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let mut groups = vec![];
        for s in data.product.clone().series.unwrap_or_default() {
            groups.push(s.asin);
        }
        let mut item = self.audible_response_to_search_response(data.product);
        let mut suggestions = vec![];
        for sim_type in AudibleSimilarityType::iter() {
            let data: AudibleItemSimResponse = self
                .client
                .get(format!("{}/sims", identifier))
                .query(&json!({
                    "similarity_type": sim_type.to_string(),
                    "response_groups": "media"
                }))
                .unwrap()
                .await
                .map_err(|e| anyhow!(e))?
                .body_json()
                .await
                .map_err(|e| anyhow!(e))?;
            for sim in data.similar_products.into_iter() {
                suggestions.push(PartialMetadataWithoutId {
                    title: sim.title,
                    image: sim.product_images.and_then(|i| i.image_500),
                    identifier: sim.asin,
                    source: MetadataSource::Audible,
                    lot: MetadataLot::AudioBook,
                });
            }
        }
        item.suggestions = suggestions.into_iter().unique().collect();
        item.group_identifiers = groups;
        Ok(item)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let page = page.unwrap_or(1);
        #[derive(Serialize, Deserialize, Debug)]
        struct AudibleSearchResponse {
            total_results: i32,
            products: Vec<AudibleItem>,
        }
        let mut rsp = self
            .client
            .get("")
            .query(&SearchQuery {
                title: query.to_owned(),
                num_results: self.page_limit,
                page: page - 1,
                products_sort_by: "Relevance".to_owned(),
                primary: PrimaryQuery::default(),
            })
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: AudibleSearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .products
            .into_iter()
            .map(|d| {
                let a = self.audible_response_to_search_response(d);
                MediaSearchItem {
                    identifier: a.identifier,
                    title: a.title,
                    image: a.url_images.first().map(|i| i.image.clone()),
                    publish_year: a.publish_year,
                }
            })
            .collect_vec();
        let next_page = if search.total_results - ((page) * self.page_limit) > 0 {
            Some(page + 1)
        } else {
            None
        };
        Ok(SearchResults {
            details: SearchDetails {
                next_page,
                total: search.total_results,
            },
            items: resp,
        })
    }
}

impl AudibleService {
    fn audible_response_to_search_response(&self, item: AudibleItem) -> MediaDetails {
        let images = Vec::from_iter(item.product_images.unwrap().image_2400.map(|a| {
            MetadataImageForMediaDetails {
                image: a,
                lot: MetadataImageLot::Poster,
            }
        }));
        let release_date = item.release_date.unwrap_or_default();
        let people = item
            .authors
            .unwrap_or_default()
            .into_iter()
            .filter_map(|a| {
                a.asin.map(|au| PartialMetadataPerson {
                    identifier: au,
                    source: MetadataSource::Audible,
                    role: "Author".to_owned(),
                    character: None,
                })
            })
            .collect_vec();
        let creators = item
            .narrators
            .unwrap_or_default()
            .into_iter()
            .map(|a| MetadataFreeCreator {
                name: a.name,
                role: "Narrator".to_owned(),
                image: None,
            })
            .collect_vec();
        let description = item.publisher_summary.or(item.merchandising_summary);
        let rating = if let Some(r) = item.rating {
            if r.num_reviews > 0 {
                r.overall_distribution.display_average_rating
            } else {
                None
            }
        } else {
            None
        };
        MediaDetails {
            identifier: item.asin,
            lot: MetadataLot::AudioBook,
            source: MetadataSource::Audible,
            is_nsfw: item.is_adult_product,
            title: item.title,
            description,
            people,
            creators,
            genres: item
                .category_ladders
                .unwrap_or_default()
                .into_iter()
                .flat_map(|c| {
                    c.ladder
                        .into_iter()
                        .map(|l| l.name)
                        .flat_map(|c| c.split(" & ").map(|g| g.to_case(Case::Title)).collect_vec())
                })
                .unique()
                .collect(),
            publish_year: convert_date_to_year(&release_date),
            publish_date: convert_string_to_date(&release_date),
            specifics: MediaSpecifics::AudioBook(AudioBookSpecifics {
                runtime: item.runtime_length_min,
            }),
            url_images: images,
            videos: vec![],
            provider_rating: rating,
            suggestions: vec![],
            group_identifiers: vec![],
            s3_images: vec![],
            production_status: None,
            original_language: None,
        }
    }
}
