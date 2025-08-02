use anyhow::{Result, anyhow};
use application_utils::get_base_http_client;
use async_trait::async_trait;
use common_models::{
    EntityAssets, MetadataSearchSourceSpecifics, NamedObject, PersonSourceSpecifics, SearchDetails,
};
use common_utils::{PAGE_SIZE, convert_date_to_year, convert_string_to_date};
use convert_case::{Case, Casing};
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{PersonDetails, SearchResults};
use educe::Educe;
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    AudioBookSpecifics, CommitMetadataGroupInput, MetadataDetails, MetadataFreeCreator,
    MetadataSearchItem, PartialMetadataPerson, PartialMetadataWithoutId, PeopleSearchItem,
    UniqueMediaIdentifier,
};
use paginate::Pages;
use reqwest::Client;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use strum::{Display, EnumIter, IntoEnumIterator};
use traits::MediaProvider;

static AUDNEX_URL: &str = "https://api.audnex.us";

#[derive(EnumIter, Display)]
enum AudibleSimilarityType {
    InTheSameSeries,
    ByTheSameNarrator,
    RawSimilarities,
    ByTheSameAuthor,
    NextInSameSeries,
}

#[derive(Serialize, Deserialize, Educe)]
#[educe(Default)]
struct PrimaryQuery {
    #[educe(
        Default = "contributors,category_ladders,media,product_attrs,product_extended_attrs,series,relationships,rating"
    )]
    response_groups: String,
    #[educe(Default = "2400")]
    image_sizes: String,
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
    url: String,
    client: Client,
    locale: String,
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
        format!("https://api.audible.{}/1.0/catalog/products", suffix)
    }

    pub async fn new(config: &config_definition::AudibleConfig) -> Result<Self> {
        let url = Self::url_from_locale(&config.locale);
        let client = get_base_http_client(None);
        Ok(Self {
            url,
            client,
            locale: config.locale.clone(),
        })
    }
}

#[async_trait]
impl MediaProvider for AudibleService {
    async fn people_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
        _source_specifics: &Option<PersonSourceSpecifics>,
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
                ..Default::default()
            })
            .collect_vec();
        let total_items = data.len();
        let pages = Pages::new(total_items, PAGE_SIZE.try_into().unwrap());
        let selected_page = pages.with_offset(req_internal_page);
        let items = data[selected_page.start..selected_page.end + 1].to_vec();
        let has_next_page = pages.page_count() > internal_page;
        Ok(SearchResults {
            items,
            details: SearchDetails {
                total: total_items.try_into().unwrap(),
                next_page: has_next_page.then(|| (internal_page + 1).try_into().unwrap()),
            },
        })
    }

    async fn person_details(
        &self,
        identity: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
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
        let name = data.name;
        Ok(PersonDetails {
            name: name.clone(),
            identifier: data.asin,
            source: MediaSource::Audible,
            description: data.description,
            assets: EntityAssets {
                remote_images: Vec::from_iter(data.image),
                ..Default::default()
            },
            source_url: Some(format!(
                "https://www.audible.com/author/{}/{}",
                name, identity
            )),
            ..Default::default()
        })
    }

    async fn metadata_group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        let data: AudibleItemResponse = self
            .client
            .get(format!("{}/{}", self.url, identifier))
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
                .get(format!("{}/{}", self.url, i))
                .query(&PrimaryQuery::default())
                .send()
                .await
                .map_err(|e| anyhow!(e))?;
            let data: AudibleItemResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
            collection_contents.push(PartialMetadataWithoutId {
                identifier: i,
                lot: MediaLot::AudioBook,
                title: data.product.title,
                source: MediaSource::Audible,
                image: data.product.product_images.and_then(|i| i.image_2400),
                ..Default::default()
            });
        }
        let title = data.product.title;
        Ok((
            MetadataGroupWithoutId {
                title: title.clone(),
                lot: MediaLot::AudioBook,
                source: MediaSource::Audible,
                identifier: identifier.to_owned(),
                parts: collection_contents.len().try_into().unwrap(),
                source_url: Some(format!(
                    "https://www.audible.com/series/{}/{}",
                    identifier, title
                )),
                ..Default::default()
            },
            collection_contents,
        ))
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let rsp = self
            .client
            .get(format!("{}/{}", self.url, identifier))
            .query(&PrimaryQuery::default())
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: AudibleItemResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let mut item = self.audible_response_to_search_response(data.product.clone());
        let mut suggestions = vec![];
        let mut groups = vec![];
        for s in data.product.series.unwrap_or_default() {
            groups.push(CommitMetadataGroupInput {
                name: s.title,
                unique: UniqueMediaIdentifier {
                    lot: item.lot,
                    identifier: s.asin,
                    source: MediaSource::Audible,
                },
                ..Default::default()
            });
        }
        for sim_type in AudibleSimilarityType::iter() {
            let data: AudibleItemSimResponse = self
                .client
                .get(format!("{}/{}/sims", self.url, identifier))
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
                    identifier: sim.asin,
                    lot: MediaLot::AudioBook,
                    source: MediaSource::Audible,
                    image: sim.product_images.and_then(|i| i.image_500),
                    ..Default::default()
                });
            }
        }
        item.suggestions = suggestions.into_iter().unique().collect();
        item.groups = groups;
        Ok(item)
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        #[derive(Serialize, Deserialize, Debug)]
        struct AudibleSearchResponse {
            total_results: i32,
            products: Vec<AudibleItem>,
        }
        let rsp = self
            .client
            .get(&self.url)
            .query(&SearchQuery {
                title: query.to_owned(),
                num_results: PAGE_SIZE,
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
                    title: a.title,
                    identifier: a.identifier,
                    publish_year: a.publish_year,
                    image: a.assets.remote_images.first().cloned(),
                }
            })
            .collect_vec();
        let next_page = (search.total_results - ((page) * PAGE_SIZE) > 0).then(|| page + 1);
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
    fn audible_response_to_search_response(&self, item: AudibleItem) -> MetadataDetails {
        let images = Vec::from_iter(item.product_images.unwrap().image_2400);
        let release_date = item.release_date.unwrap_or_default();
        let people = item
            .authors
            .unwrap_or_default()
            .into_iter()
            .filter_map(|a| {
                a.asin.map(|au| PartialMetadataPerson {
                    name: a.name,
                    identifier: au,
                    role: "Author".to_owned(),
                    source: MediaSource::Audible,
                    ..Default::default()
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
                ..Default::default()
            })
            .collect_vec();
        let description = item.publisher_summary.or(item.merchandising_summary);
        let rating = match item.rating {
            Some(r) if r.num_reviews > 0 => r.overall_distribution.display_average_rating,
            _ => None,
        };
        let assets = EntityAssets {
            remote_images: images,
            ..Default::default()
        };
        MetadataDetails {
            people,
            creators,
            description,
            assets,
            provider_rating: rating,
            lot: MediaLot::AudioBook,
            title: item.title.clone(),
            source: MediaSource::Audible,
            identifier: item.asin.clone(),
            is_nsfw: item.is_adult_product,
            source_url: Some(format!(
                "https://www.audible.com/pd/{}/{}",
                item.title, item.asin
            )),
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
            ..Default::default()
        }
    }
}
