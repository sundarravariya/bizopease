{
    "name": "Product Quantity Based Pricing",
    "version": "1.0",
    "depends": ["sale", "product"],
    "author": "ChatGPT",
    "category": "Sales",
    "summary": "Add quantity-based sale pricing to products.",
    "data": [
        "security/ir.model.access.csv",
        "views/product_template_view.xml",
        "views/pricing_sheet_view.xml"
    ],
    "installable": True,
    "application": False,
    "auto_install": False
}
