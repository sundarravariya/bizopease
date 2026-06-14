# -*- coding: utf-8 -*-
from odoo import _, api, fields, models
from odoo.exceptions import UserError


class FlipkartQZPrintWizard(models.TransientModel):
    _name = 'flipkart.qz.print.wizard'
    _description = 'Flipkart QZ Print Wizard'

    consignment_id = fields.Many2one('flipkart.consignment', string='Consignment', required=True, readonly=True)
    select_all = fields.Boolean(string='Select All', default=True)
    line_ids = fields.One2many('flipkart.qz.print.wizard.line', 'wizard_id', string='Products')

    @api.model
    def default_get(self, fields_list):
        res = super().default_get(fields_list)
        consignment_id = self.env.context.get('active_id')
        if self.env.context.get('active_model') != 'flipkart.consignment' or not consignment_id:
            return res

        consignment = self.env['flipkart.consignment'].browse(consignment_id)
        res['consignment_id'] = consignment.id
        res['select_all'] = True
        res['line_ids'] = [
            (0, 0, {
                'consignment_line_id': line.id,
                'selected': True,
                'quantity': line.quantity_sent or 0,
            })
            for line in consignment.line_ids
        ]
        return res

    @api.onchange('select_all')
    def _onchange_select_all(self):
        for line in self.line_ids:
            line.selected = self.select_all

    def action_print_qz(self):
        self.ensure_one()
        selected_lines = self.line_ids.filtered(
            lambda line: line.selected and line.consignment_line_id and line.quantity > 0
        )
        if not selected_lines:
            raise UserError(_("Please select at least one product with quantity greater than zero."))
        return self.consignment_id._action_print_qz_from_wizard(selected_lines)


class FlipkartQZPrintWizardLine(models.TransientModel):
    _name = 'flipkart.qz.print.wizard.line'
    _description = 'Flipkart QZ Print Wizard Line'

    wizard_id = fields.Many2one('flipkart.qz.print.wizard', string='Wizard', required=True, ondelete='cascade')
    consignment_line_id = fields.Many2one('flipkart.consignment.line', string='Consignment Line', readonly=True)
    selected = fields.Boolean(string='Print', default=True)
    sku_id = fields.Char(string='SKU', related='consignment_line_id.sku_id', readonly=True)
    fsn = fields.Char(string='FSN', related='consignment_line_id.fsn', readonly=True)
    quantity = fields.Integer(string='Qty')
