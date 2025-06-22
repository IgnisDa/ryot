use std::sync::Arc;

use async_graphql::Result;
use common_models::{SearchDetails, SearchInput};
use database_models::{genre, prelude::Genre};
use database_utils::{ilike_sql, user_by_id};
use dependent_models::SearchResults;
use media_models::GenreListItem;
use migrations::AliasedMetadataToGenre;
use sea_orm::{
    EntityTrait, ItemsAndPagesNumber, JoinType, Order, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, QueryTrait, RelationTrait,
};
use sea_query::{Alias, Condition, Expr, Func, extension::postgres::PgExpr};
use supporting_service::SupportingService;

pub async fn genres_list(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: SearchInput,
) -> Result<SearchResults<String>> {
    let page: u64 = input.page.unwrap_or(1).try_into().unwrap();
    let preferences = user_by_id(&user_id, ss).await?.preferences;
    let num_items = "num_items";
    let query = Genre::find()
        .column_as(
            Expr::expr(Func::count(Expr::col((
                AliasedMetadataToGenre::Table,
                AliasedMetadataToGenre::MetadataId,
            )))),
            num_items,
        )
        .apply_if(input.query, |query, v| {
            query.filter(Condition::all().add(Expr::col(genre::Column::Name).ilike(ilike_sql(&v))))
        })
        .join(JoinType::Join, genre::Relation::MetadataToGenre.def())
        .group_by(Expr::tuple([
            Expr::col(genre::Column::Id).into(),
            Expr::col(genre::Column::Name).into(),
        ]))
        .order_by(Expr::col(Alias::new(num_items)), Order::Desc);
    let paginator = query
        .clone()
        .into_model::<GenreListItem>()
        .paginate(&ss.db, preferences.general.list_page_size);
    let ItemsAndPagesNumber {
        number_of_items,
        number_of_pages,
    } = paginator.num_items_and_pages().await?;
    let mut items = vec![];
    for c in paginator.fetch_page(page - 1).await? {
        items.push(c.id);
    }
    Ok(SearchResults {
        items,
        details: SearchDetails {
            total: number_of_items.try_into().unwrap(),
            next_page: (page < number_of_pages).then(|| (page + 1).try_into().unwrap()),
        },
    })
}
