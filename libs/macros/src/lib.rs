use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, Data, DeriveInput};

#[proc_macro_derive(Mask, attributes(masked))]
pub fn derive_mask(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    let name = &ast.ident;
    let data = &ast.data;

    let fields = match data {
        Data::Struct(data_struct) => &data_struct.fields,
        _ => panic!("Mask can only be derived for structs"),
    };

    let masked_fields: Vec<_> = fields
        .iter()
        .filter(|field| field.attrs.iter().any(|attr| attr.path.is_ident("masked")))
        .collect();

    let masked_fields_ident: Vec<_> = masked_fields.iter().map(|field| &field.ident).collect();

    let gen = quote! {
        impl #name {
            pub fn masked_value(&self) -> Self {
                Self {
                    #(
                        #masked_fields_ident: if self.#masked_fields_ident.is_empty() {
                            "***".to_string()
                        } else {
                            "***".to_string()
                        },
                    )*
                    ..*self
                }
            }
        }
    };

    gen.into()
}
