use anyhow::{anyhow, Result};
use async_trait::async_trait;
use convert_case::{Case, Casing};
use enums::{MediaLot, MediaSource};
use itertools::Itertools;
use models::{
    metadata_group::MetadataGroupWithoutId, AudioBookSpecifics, MediaDetails, MetadataFreeCreator,
    MetadataImageForMediaDetails, MetadataPerson, MetadataSearchItem, NamedObject,
    PartialMetadataPerson, PartialMetadataWithoutId, PeopleSearchItem, PersonSourceSpecifics,
    SearchDetails, SearchResults,
};
use paginate::Pages;
use reqwest::Client;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use strum::{Display, EnumIter, IntoEnumIterator};
use traits::{MediaProvider, MediaProviderLanguages};
use utils::{convert_date_to_year, convert_string_to_date, get_base_http_client};

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
            "au" => "com.au",
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
        let client = get_base_http_client(&url, None);
        Self {
            client,
            page_limit,
            locale: config.locale.clone(),
        }
    }
}

#[async_trait]
impl MediaProvider for AudibleService {
    async fn people_search(
        &self,
        query: &str,
        page: Option<i32>,
        _source_specifics: &Option<PersonSourceSpecifics>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let internal_page: usize = page.unwrap_or(1).try_into().unwrap();
        let req_internal_page = internal_page - 1;
        let client = Client::new();
        let data: Vec<AudibleAuthor> = client
            .get(format!("{}/authors", AUDNEX_URL))
            .query(&json!({ "region": self.locale, "name": query }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        let data = data
            .into_iter()
            .map(|a| PeopleSearchItem {
                identifier: a.asin.unwrap_or_default(),
                name: a.name,
                image: None,
                birth_year: None,
            })
            .collect_vec();
        let total_items = data.len();
        let pages = Pages::new(total_items, self.page_limit.try_into().unwrap());
        let selected_page = pages.with_offset(req_internal_page);
        let items = data[selected_page.start..selected_page.end + 1].to_vec();
        let has_next_page = pages.page_count() > internal_page;
        Ok(SearchResults {
            details: SearchDetails {
                next_page: if has_next_page {
                    Some((internal_page + 1).try_into().unwrap())
                } else {
                    None
                },
                total: total_items.try_into().unwrap(),
            },
            items,
        })
    }

    async fn person_details(
        &self,
        identity: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<MetadataPerson> {
        let client = Client::new();
        let data: AudnexResponse = client
            .get(format!("{}/authors/{}", AUDNEX_URL, identity))
            .query(&json!({ "region": self.locale }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        Ok(MetadataPerson {
            identifier: data.asin,
            name: data.name,
            description: data.description,
            images: Some(Vec::from_iter(data.image)),
            source: MediaSource::Audible,
            gender: None,
            death_date: None,
            birth_date: None,
            place: None,
            website: None,
            related: vec![],
            source_specifics: None,
        })
    }

    async fn metadata_group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        let data: AudibleItemResponse = self
            .client
            .get(identifier)
            .query(&PrimaryQuery::default())
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
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
            let rsp = self
                .client
                .get(&i)
                .query(&PrimaryQuery::default())
                .send()
                .await
                .map_err(|e| anyhow!(e))?;
            let data: AudibleItemResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
            collection_contents.push(PartialMetadataWithoutId {
                title: data.product.title,
                image: data.product.product_images.and_then(|i| i.image_2400),
                identifier: i,
                source: MediaSource::Audible,
                lot: MediaLot::AudioBook,
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
                lot: MediaLot::AudioBook,
                source: MediaSource::Audible,
            },
            collection_contents,
        ))
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MediaDetails> {
        let rsp = self
            .client
            .get(identifier)
            .query(&PrimaryQuery::default())
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: AudibleItemResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
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
                .send()
                .await
                .map_err(|e| anyhow!(e))?
                .json()
                .await
                .map_err(|e| anyhow!(e))?;
            for sim in data.similar_products.into_iter() {
                suggestions.push(PartialMetadataWithoutId {
                    title: sim.title,
                    image: sim.product_images.and_then(|i| i.image_500),
                    identifier: sim.asin,
                    source: MediaSource::Audible,
                    lot: MediaLot::AudioBook,
                });
            }
        }
        item.suggestions = suggestions.into_iter().unique().collect();
        item.group_identifiers = groups;
        Ok(item)
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        #[derive(Serialize, Deserialize, Debug)]
        struct AudibleSearchResponse {
            total_results: i32,
            products: Vec<AudibleItem>,
        }
        let rsp = self
            .client
            .get("")
            .query(&SearchQuery {
                title: query.to_owned(),
                num_results: self.page_limit,
                page: page - 1,
                products_sort_by: "Relevance".to_owned(),
                primary: PrimaryQuery::default(),
            })
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: AudibleSearchResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .products
            .into_iter()
            .map(|d| {
                let a = self.audible_response_to_search_response(d);
                MetadataSearchItem {
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
        let images = Vec::from_iter(
            item.product_images
                .unwrap()
                .image_2400
                .map(|a| MetadataImageForMediaDetails { image: a }),
        );
        let release_date = item.release_date.unwrap_or_default();
        let people = item
            .authors
            .unwrap_or_default()
            .into_iter()
            .filter_map(|a| {
                a.asin.map(|au| PartialMetadataPerson {
                    identifier: au,
                    source: MediaSource::Audible,
                    role: "Author".to_owned(),
                    name: a.name,
                    character: None,
                    source_specifics: None,
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
            lot: MediaLot::AudioBook,
            source: MediaSource::Audible,
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
            audio_book_specifics: Some(AudioBookSpecifics {
                runtime: item.runtime_length_min,
            }),
            url_images: images,
            provider_rating: rating,
            ..Default::default()
        }
    }
}
