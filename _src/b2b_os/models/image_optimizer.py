# -*- coding: utf-8 -*-
import base64
import binascii
import io
import logging

from PIL import Image, UnidentifiedImageError

from odoo import api, models


_logger = logging.getLogger(__name__)


def _b2b_to_webp(value, max_size=2560, quality=92):
    if not value:
        return value

    if isinstance(value, str) and value.startswith('data:image'):
        header, _, payload = value.partition(',')
        converted = _b2b_to_webp(payload, max_size=max_size, quality=quality)
        return f'data:image/webp;base64,{converted}' if converted != payload else value

    try:
        raw = base64.b64decode(value)
    except (binascii.Error, TypeError, ValueError):
        return value

    try:
        with Image.open(io.BytesIO(raw)) as image:
            image_format = (image.format or '').upper()
            if image_format == 'WEBP':
                return value
            if image_format not in ('JPEG', 'JPG', 'PNG'):
                return value

            image.load()
            if max(image.size) > max_size:
                image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

            if image.mode not in ('RGB', 'RGBA'):
                image = image.convert('RGBA' if 'A' in image.getbands() else 'RGB')

            output = io.BytesIO()
            save_kwargs = {'format': 'WEBP', 'method': 6}
            if image_format == 'PNG':
                save_kwargs['lossless'] = True
            else:
                save_kwargs['quality'] = quality
            image.save(output, **save_kwargs)
            return base64.b64encode(output.getvalue()).decode('ascii')
    except (UnidentifiedImageError, OSError) as exc:
        _logger.debug("B2B OS skipped image optimization: %s", exc)
        return value


def _b2b_optimize_image_vals(vals, fields):
    for field in fields:
        if field in vals and vals[field]:
            vals[field] = _b2b_to_webp(vals[field])
    return vals


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            _b2b_optimize_image_vals(vals, ('image_1920',))
        return super().create(vals_list)

    def write(self, vals):
        _b2b_optimize_image_vals(vals, ('image_1920',))
        return super().write(vals)


class ProductProduct(models.Model):
    _inherit = 'product.product'

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            _b2b_optimize_image_vals(vals, ('image_1920', 'image_variant_1920'))
        return super().create(vals_list)

    def write(self, vals):
        _b2b_optimize_image_vals(vals, ('image_1920', 'image_variant_1920'))
        return super().write(vals)


class ProductImage(models.Model):
    _inherit = 'product.image'

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            _b2b_optimize_image_vals(vals, ('image_1920',))
        return super().create(vals_list)

    def write(self, vals):
        _b2b_optimize_image_vals(vals, ('image_1920',))
        return super().write(vals)


class ProductPublicCategory(models.Model):
    _inherit = 'product.public.category'

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            _b2b_optimize_image_vals(vals, ('image_1920',))
        return super().create(vals_list)

    def write(self, vals):
        _b2b_optimize_image_vals(vals, ('image_1920',))
        return super().write(vals)

    def b2b_display_image_url(self):
        self.ensure_one()
        if self.image_512 or self.image_1920:
            return '/web/image/product.public.category/%s/image_512' % self.id

        product = self.env['product.template'].sudo().search([
            ('website_published', '=', True),
            ('sale_ok', '=', True),
            ('public_categ_ids', 'child_of', self.id),
        ], limit=1, order='write_date desc, create_date desc, id desc')
        if product and (product.image_512 or product.image_1920):
            return '/web/image/product.template/%s/image_512' % product.id
        return False
