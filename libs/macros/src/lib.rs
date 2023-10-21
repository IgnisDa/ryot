use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, Data, DeriveInput};

fn mask_field(field: &syn::Field) -> proc_macro2::TokenStream {
    let field_name = &field.ident;

    quote! {
        #field_name: self.#field_name.masked_value()
    }
}

#[proc_macro_derive(Mask, attributes(masked))]
pub fn derive_mask(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    let name = &ast.ident;

    let fields = match &ast.data {
        Data::Struct(data_struct) => &data_struct.fields,
        _ => panic!("Mask can only be derived for structs"),
    };

    let masked_fields: Vec<_> = fields.iter().map(|field| mask_field(field)).collect();

    let gen = quote! {
        impl MaskedValue for #name {
            fn masked_value(&self) -> Self {
                Self {
                    #(#masked_fields),*
                }
            }
        }
    };

    gen.into()
}
