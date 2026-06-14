/** @odoo-module **/

import { Component } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

class MaterialAppScreen extends Component {
    static template = "material_theme.AppScreen";
    static props = ["*"];

    setup() {
        this.menu = useService("menu");
    }

    get apps() {
        return this.menu.getApps().filter(
            (app) => app.xmlid !== "material_theme.menu_material_app_screen"
        );
    }

    openApp = (app) => {
        this.menu.selectMenu(app);
    }
}

registry.category("actions").add("material_theme.app_screen", MaterialAppScreen);
