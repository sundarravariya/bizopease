{
    "name": "Material Theme",
    "version": "18.0.3.0",
    "summary": "Black & White Material Design backend theme with Enterprise-style home screen",
    "category": "Themes/Backend",
    "author": "Antigravity",
    "license": "LGPL-3",
    "depends": ["web"],
    "data": [
        "data/action.xml",
    ],
    "post_init_hook": "post_init_hook",
    "assets": {
        # variables.scss prepended so our $o-* overrides take effect
        # before Odoo's own primary_variables.scss compiles.
        "web._assets_primary_variables": [
            ("prepend", "material_theme/static/src/scss/variables.scss"),
        ],
        "web.assets_backend": [
            # Core theme styles
            "material_theme/static/src/scss/material_theme.scss",
            # App screen styles
            "material_theme/static/src/scss/app_screen.scss",
            # App screen OWL template
            "material_theme/static/src/xml/app_screen.xml",
            # App screen OWL component
            "material_theme/static/src/js/app_screen.js",
        ],
    },
    "installable": True,
    "application": False,
}
