# -*- coding: utf-8 -*-
# Legacy /dashboard React+Vite build RETIRED on 2026-06-12.
# The admin UI now lives at /portal (separate nginx alias, unaffected).
# The old /dashboard route and its /api/headless/execute JSON proxy have been
# removed. Original controller preserved as api.py.bak on the server.
from odoo import http


class HeadlessApiController(http.Controller):
    pass
