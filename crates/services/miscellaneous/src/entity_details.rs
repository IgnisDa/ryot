use std::{cmp::Reverse, collections::HashMap};

use async_graphql::{Error, Result};
use common_models::SearchDetails;
use database_models::{
    metadata_group_to_person, metadata_to_genre, metadata_to_metadata_group, metadata_to_person,
    prelude::{
        Genre, MetadataGroup, MetadataGroupToPerson, MetadataToGenre, MetadataToMetadataGroup,
        MetadataToPerson, Person,
    },
};
use database_utils::{transform_entity_assets, user_by_id};
use dependent_models::{GenreDetails, GraphqlPersonDetails, MetadataGroupDetails, SearchResults};
use itertools::Itertools;
use media_models::{
    GenreDetailsInput, GenreListItem, PersonDetailsGroupedByRole, PersonDetailsItemWithCharacter,
};
use sea_orm::{
    ColumnTrait, EntityTrait, ItemsAndPagesNumber, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect,
};
use supporting_service::SupportingService;

pub async fn person_details(
    person_id: String,
    supporting_service: &std::sync::Arc<SupportingService>,
) -> Result<GraphqlPersonDetails> {
    let mut details = Person::find_by_id(person_id.clone())
        .one(&supporting_service.db)
        .await?
        .unwrap();
    transform_entity_assets(&mut details.assets, supporting_service).await;
    let metadata_associations = MetadataToPerson::find()
        .filter(metadata_to_person::Column::PersonId.eq(&person_id))
        .order_by_asc(metadata_to_person::Column::Index)
        .all(&supporting_service.db)
        .await?;
    let mut metadata_contents: HashMap<_, Vec<_>> = HashMap::new();
    for assoc in metadata_associations {
        let to_push = PersonDetailsItemWithCharacter {
            character: assoc.character,
            entity_id: assoc.metadata_id,
        };
        metadata_contents
            .entry(assoc.role)
            .and_modify(|e| e.push(to_push.clone()))
            .or_insert(vec![to_push]);
    }
    let associated_metadata = metadata_contents
        .into_iter()
        .map(|(name, items)| PersonDetailsGroupedByRole {
            count: items.len(),
            name,
            items,
        })
        .sorted_by_key(|f| Reverse(f.count))
        .collect_vec();
    let associated_metadata_groups = MetadataGroupToPerson::find()
        .filter(metadata_group_to_person::Column::PersonId.eq(person_id))
        .order_by_asc(metadata_group_to_person::Column::Index)
        .all(&supporting_service.db)
        .await?;
    let mut metadata_group_contents: HashMap<_, Vec<_>> = HashMap::new();
    for assoc in associated_metadata_groups {
        let to_push = PersonDetailsItemWithCharacter {
            entity_id: assoc.metadata_group_id,
            ..Default::default()
        };
        metadata_group_contents
            .entry(assoc.role)
            .and_modify(|e| e.push(to_push.clone()))
            .or_insert(vec![to_push]);
    }
    let associated_metadata_groups = metadata_group_contents
        .into_iter()
        .map(|(name, items)| PersonDetailsGroupedByRole {
            count: items.len(),
            name,
            items,
        })
        .sorted_by_key(|f| Reverse(f.count))
        .collect_vec();
    Ok(GraphqlPersonDetails {
        details,
        associated_metadata,
        associated_metadata_groups,
    })
}

pub async fn genre_details(
    supporting_service: &std::sync::Arc<SupportingService>,
    user_id: String,
    input: GenreDetailsInput,
) -> Result<GenreDetails> {
    let page = input.page.unwrap_or(1);
    let genre = Genre::find_by_id(input.genre_id.clone())
        .one(&supporting_service.db)
        .await?
        .unwrap();
    let preferences = user_by_id(&user_id, supporting_service).await?.preferences;
    let paginator = MetadataToGenre::find()
        .filter(metadata_to_genre::Column::GenreId.eq(input.genre_id))
        .paginate(&supporting_service.db, preferences.general.list_page_size);
    let ItemsAndPagesNumber {
        number_of_items,
        number_of_pages,
    } = paginator.num_items_and_pages().await?;
    let mut contents = vec![];
    for association_items in paginator.fetch_page(page - 1).await? {
        contents.push(association_items.metadata_id);
    }
    Ok(GenreDetails {
        details: GenreListItem {
            id: genre.id,
            name: genre.name,
            num_items: Some(number_of_items.try_into().unwrap()),
        },
        contents: SearchResults {
            details: SearchDetails {
                total: number_of_items.try_into().unwrap(),
                next_page: if page < number_of_pages {
                    Some((page + 1).try_into().unwrap())
                } else {
                    None
                },
            },
            items: contents,
        },
    })
}

pub async fn metadata_group_details(
    supporting_service: &std::sync::Arc<SupportingService>,
    metadata_group_id: String,
) -> Result<MetadataGroupDetails> {
    let mut group = MetadataGroup::find_by_id(metadata_group_id)
        .one(&supporting_service.db)
        .await?
        .ok_or_else(|| Error::new("Group not found"))?;
    transform_entity_assets(&mut group.assets, supporting_service).await;
    let contents = MetadataToMetadataGroup::find()
        .select_only()
        .column(metadata_to_metadata_group::Column::MetadataId)
        .filter(metadata_to_metadata_group::Column::MetadataGroupId.eq(group.id.clone()))
        .order_by_asc(metadata_to_metadata_group::Column::Part)
        .into_tuple::<String>()
        .all(&supporting_service.db)
        .await?;
    Ok(MetadataGroupDetails {
        contents,
        details: group,
    })
}
