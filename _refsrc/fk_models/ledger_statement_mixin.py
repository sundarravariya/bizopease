# -*- coding: utf-8 -*-
from odoo import fields
from odoo.osv import expression


class LedgerStatementMixin:
    _ledger_date_field = 'date'

    def _statement_enabled(self, domain, offset):
        date_from, date_to = self._extract_date_bounds(domain)
        return offset == 0 and bool(date_from or date_to)

    def _extract_date_bounds(self, domain):
        date_from = False
        date_to = False
        for token in expression.normalize_domain(domain or []):
            if not isinstance(token, tuple) or len(token) != 3:
                continue
            if token[0] != self._ledger_date_field:
                continue
            value = fields.Date.to_date(token[2]) if token[2] else False
            if not value:
                continue
            if token[1] in ('=', '>=', '>'):
                date_from = max(date_from, value) if date_from else value
            if token[1] in ('=', '<=', '<'):
                date_to = min(date_to, value) if date_to else value
        return date_from, date_to

    def _strip_date_domain(self, domain):
        normalized = expression.normalize_domain(domain or [])
        node, _ = self._parse_domain_node(normalized, 0)
        stripped = self._remove_date_from_node(node)
        if not stripped:
            return []
        return self._flatten_domain_node(stripped)

    def _parse_domain_node(self, tokens, index):
        token = tokens[index]
        if token == '!':
            child, next_index = self._parse_domain_node(tokens, index + 1)
            return ('!', child), next_index
        if token in ('&', '|'):
            left, next_index = self._parse_domain_node(tokens, index + 1)
            right, next_index = self._parse_domain_node(tokens, next_index)
            return (token, left, right), next_index
        return token, index + 1

    def _remove_date_from_node(self, node):
        if isinstance(node, tuple) and len(node) == 3 and node[0] not in ('&', '|', '!'):
            return None if node[0] == self._ledger_date_field else node
        if isinstance(node, tuple) and node and node[0] == '!':
            child = self._remove_date_from_node(node[1])
            return ('!', child) if child else None
        if isinstance(node, tuple) and node and node[0] in ('&', '|'):
            operator, left, right = node
            left = self._remove_date_from_node(left)
            right = self._remove_date_from_node(right)
            if left and right:
                return (operator, left, right)
            return left or right
        return node

    def _flatten_domain_node(self, node):
        if isinstance(node, tuple) and node and node[0] == '!':
            return ['!'] + self._flatten_domain_node(node[1])
        if isinstance(node, tuple) and node and node[0] in ('&', '|'):
            return [node[0]] + self._flatten_domain_node(node[1]) + self._flatten_domain_node(node[2])
        return [node]

    def _sum_statement_balance(self, domain):
        return sum(self.search(domain).mapped(self._statement_balance_field()))

    def _statement_balance_field(self):
        return 'balance'

    def _statement_row_values(self, specification, label, balance_value, row_date):
        values = {field_name: False for field_name in specification}
        values['id'] = self._statement_virtual_id(label)
        if 'date' in values:
            values['date'] = row_date
        if 'debit' in values:
            values['debit'] = balance_value if balance_value > 0 else 0.0
        if 'credit' in values:
            values['credit'] = abs(balance_value) if balance_value < 0 else 0.0
        balance_field = self._statement_balance_field()
        if balance_field in values:
            values[balance_field] = balance_value
        values.update(self._statement_row_labels(label))
        return values

    def _statement_row_labels(self, label):
        return {}

    def _statement_virtual_id(self, label):
        return -1 if label == 'Opening Balance' else -2

    def _append_statement_rows(self, domain, specification, result, offset=0):
        if not self._statement_enabled(domain, offset):
            return result

        date_from, date_to = self._extract_date_bounds(domain)
        base_domain = self._strip_date_domain(domain)
        opening_balance = 0.0
        if date_from:
            opening_balance = self._sum_statement_balance(
                expression.AND([base_domain, [(self._ledger_date_field, '<', date_from)]])
            )

        opening_row = self._statement_row_values(specification, 'Opening Balance', opening_balance, date_from or date_to)

        result['records'] = [opening_row] + result['records']
        return result
