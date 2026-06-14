/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { AddToCartNotification } from "@website_sale/js/notification/add_to_cart_notification/add_to_cart_notification";
import { WebsiteSale } from "@website_sale/js/website_sale";
import "@website_sale/snippets/s_dynamic_snippet_products/000";
import publicWidget from "@web/legacy/js/public/public_widget";
import { rpc } from "@web/core/network/rpc";
import wSaleUtils from "@website_sale/js/website_sale_utils";

if (!window.__b2bCartNotificationDelayPatched) {
    window.__b2bCartNotificationDelayPatched = true;
    const originalShowCartNotification = wSaleUtils.showCartNotification.bind(wSaleUtils);
    wSaleUtils.showCartNotification = function (callService, props, options = {}) {
        return originalShowCartNotification(callService, props, {
            ...options,
            autocloseDelay: 3000,
        });
    };
}

function b2bShouldHidePrices() {
    return document.getElementById("wrapwrap")?.dataset?.b2bPriceMode === "hide";
}

function b2bUpgradeImageUrl(url, size = "image_1024") {
    if (!url) {
        return url;
    }
    return url.replace(/image_(?:128|256|512|1024|1920)/g, size);
}

function b2bEnhanceHomepageProductImages(root = document) {
    const selector = [
        ".s_dynamic_snippet_products img",
        ".s_b2b_stock_clearance img",
        ".o_carousel_product_card img",
    ].join(", ");
    root.querySelectorAll(selector).forEach((img) => {
        const src = img.getAttribute("src");
        if (src && src.includes("/web/image/") && src.includes("image_512")) {
            img.setAttribute("src", b2bUpgradeImageUrl(src, "image_1024"));
        }
        const srcset = img.getAttribute("srcset");
        if (srcset && srcset.includes("image_512")) {
            img.setAttribute("srcset", b2bUpgradeImageUrl(srcset, "image_1024"));
        }
    });
}

function b2bFindMainProductImage() {
    const selectors = [
        "#o-carousel-product .carousel-item.active img",
        "#o-carousel-product .carousel-item img",
        ".oe_website_sale .oe_product_image_img_wrapper img",
        ".oe_website_sale .oe_product_image_link img",
        ".oe_website_sale .o_carousel_product_img_link img",
    ];
    for (const selector of selectors) {
        const image = document.querySelector(selector);
        if (image) {
            return image;
        }
    }
    return null;
}

function b2bEnsureProductZoomButton() {
    const mainImage = b2bFindMainProductImage();
    if (!mainImage) {
        return;
    }
    const wrapper = mainImage.closest(
        "#o-carousel-product, .oe_product_image_img_wrapper, .oe_product_image_link, .o_carousel_product_img_link, .carousel-item"
    );
    if (!wrapper) {
        return;
    }
    wrapper.classList.add("b2b-zoom-wrapper");
    let button = wrapper.querySelector(".b2b-product-zoom-btn");
    if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-dark b2b-product-zoom-btn";
        button.setAttribute("aria-label", "Zoom image");
        button.setAttribute("title", "Zoom image");
        button.innerHTML = '<span class="fa fa-search-plus"></span>';
        wrapper.appendChild(button);
    }

    if (!document.getElementById("b2bProductZoomModal")) {
        document.body.insertAdjacentHTML(
            "beforeend",
            `
            <div class="modal fade" id="b2bProductZoomModal" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered modal-xl">
                    <div class="modal-content border-0 bg-transparent shadow-none">
                        <div class="modal-body p-0 position-relative">
                            <button type="button" class="btn btn-light b2b-product-zoom-close" data-bs-dismiss="modal" aria-label="Close">
                                <span class="fa fa-times"></span>
                            </button>
                            <img src="" alt="Zoomed product image" class="img-fluid w-100 b2b-product-zoom-image"/>
                        </div>
                    </div>
                </div>
            </div>`
        );
    }

    const openZoom = () => {
        const activeImage = b2bFindMainProductImage();
        if (!activeImage) {
            return;
        }
        const zoomImage = document.querySelector("#b2bProductZoomModal .b2b-product-zoom-image");
        if (!zoomImage) {
            return;
        }
        zoomImage.src = b2bUpgradeImageUrl(activeImage.currentSrc || activeImage.src, "image_1920");
        if (window.bootstrap?.Modal) {
            window.bootstrap.Modal.getOrCreateInstance(document.getElementById("b2bProductZoomModal")).show();
        } else {
            window.open(zoomImage.src, "_blank", "noopener");
        }
    };

    if (!button.dataset.b2bZoomBound) {
        button.addEventListener("click", openZoom);
        button.dataset.b2bZoomBound = "1";
    }
    mainImage.style.cursor = "zoom-in";
    if (!mainImage.dataset.b2bZoomBound) {
        mainImage.addEventListener("click", openZoom);
        mainImage.dataset.b2bZoomBound = "1";
    }
}

if (!window.__b2bQtyBindingInstalled) {
    window.__b2bQtyBindingInstalled = true;
    document.addEventListener("click", (ev) => {
        const action = ev.target.closest("a.b2b_qty_action");
        if (!action) {
            return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        const qtyInput = action.closest(".css_quantity")?.querySelector('input[name="add_qty"]');
        if (!qtyInput) {
            return;
        }
        const currentQty = Math.max(1, parseInt(qtyInput.value || 1, 10) || 1);
        qtyInput.value = action.classList.contains("b2b_qty_minus")
            ? Math.max(1, currentQty - 1)
            : currentQty + 1;
        qtyInput.dispatchEvent(new Event("change", { bubbles: true }));
    }, true);

}

patch(AddToCartNotification.prototype, {
    getFormattedPrice(line) {
        if (line.b2b_hide_price === true || (line.b2b_hide_price === undefined && b2bShouldHidePrices())) {
            return "";
        }
        return super.getFormattedPrice(...arguments);
    },
});

patch(WebsiteSale.prototype, {
    _onChangeCombination(ev, $parent, combination) {
        super._onChangeCombination(...arguments);

        const $productPrice = $parent.find(".product_price:first");
        const $baseUnitPrice = $parent.find(".o_base_unit_price_wrapper:first");
        if (!$productPrice.length) {
            return;
        }

        if (combination.b2b_hide_price) {
            $productPrice
                .removeClass("d-none")
                .addClass("d-inline-block b2b_price_hidden")
                .html('<h3 class="b2b_price_on_request d-none"></h3>');
            $baseUnitPrice.addClass("d-none");
        } else {
            $productPrice.removeClass("b2b_price_hidden");
        }
    },
});

if (publicWidget.registry.dynamic_snippet_products_cta) {
    patch(publicWidget.registry.dynamic_snippet_products_cta.prototype, {
        async _onClickAddToCart(ev) {
            const button = ev.currentTarget;
            const card = button.closest(".o_carousel_product_card") || this.el;
            const qtyInput = card ? card.querySelector('input[name="add_qty"]') : null;
            const addQty = Math.max(1, parseInt(qtyInput?.value || 1, 10) || 1);

            if (!button.dataset.productSelected || button.dataset.isCombo === "True") {
                const dummyForm = document.createElement("form");
                dummyForm.setAttribute("method", "post");
                dummyForm.setAttribute("action", "/shop/cart/update");

                const inputPT = document.createElement("input");
                inputPT.setAttribute("name", "product_template_id");
                inputPT.setAttribute("type", "hidden");
                inputPT.setAttribute("value", button.dataset.productTemplateId);
                dummyForm.appendChild(inputPT);

                const inputPP = document.createElement("input");
                inputPP.setAttribute("name", "product_id");
                inputPP.setAttribute("type", "hidden");
                inputPP.setAttribute("value", button.dataset.productId);
                dummyForm.appendChild(inputPP);

                const inputQty = document.createElement("input");
                inputQty.setAttribute("name", "add_qty");
                inputQty.setAttribute("type", "hidden");
                inputQty.setAttribute("value", addQty);
                dummyForm.appendChild(inputQty);

                await this._handleAdd($(dummyForm));
            } else {
                const data = await rpc("/shop/cart/update_json", {
                    product_id: parseInt(button.dataset.productId, 10),
                    add_qty: addQty,
                    display: false,
                });
                wSaleUtils.updateCartNavBar(data);
                wSaleUtils.showCartNotification(this.call.bind(this), data.notification_info);
            }

            if (this.add2cartRerender) {
                this.trigger_up("widgets_start_request", {
                    $target: this.$el.closest(".s_dynamic"),
                });
            }
        },
    });
}

// Add logic to handle local quantity button updates on the grid
// without triggering the live cart AJAX update.
publicWidget.registry.B2BGridQty = publicWidget.Widget.extend({
    selector: 'body',
    events: {
        'click a.b2b_qty_action': '_onClickQtyUpdate',
    },

    start: function () {
        this._decorateQuantityControls();
        this._ensureCheckoutBillingDefault();
        b2bEnhanceHomepageProductImages(this.el);
        b2bEnsureProductZoomButton();
        if (!window.__b2bHomepageImageObserverInstalled) {
            window.__b2bHomepageImageObserverInstalled = true;
            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1) {
                            b2bEnhanceHomepageProductImages(node);
                            b2bEnsureProductZoomButton();
                        }
                    });
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
        return this._super.apply(this, arguments);
    },

    _decorateQuantityControls: function () {
        this.$('.css_quantity').each(function () {
            const $qty = $(this);
            const $input = $qty.find('input[name="add_qty"]');
            if (!$input.length || $qty.hasClass('b2b_qty_ready')) {
                return;
            }
            $qty.addClass('b2b_qty_group b2b_qty_ready input-group input-group-sm');
            if ($qty.find('.b2b_qty_action').length || $qty.find('a, button').length) {
                return;
            }
            if (!$qty.find('.b2b_qty_minus').length) {
                $input.before(
                    '<a href="#" class="btn btn-outline-secondary b2b_qty_action b2b_qty_minus" aria-label="Decrease quantity"><span class="fa fa-minus"></span></a>'
                );
            }
            if (!$qty.find('.b2b_qty_plus').length) {
                $input.after(
                    '<a href="#" class="btn btn-outline-secondary b2b_qty_action b2b_qty_plus" aria-label="Increase quantity"><span class="fa fa-plus"></span></a>'
                );
            }
        });
    },

    _ensureCheckoutBillingDefault: function () {
        const $toggle = this.$('#use_delivery_as_billing');
        if (!$toggle.length || $toggle.is(':checked')) {
            return;
        }
        $toggle.prop('checked', true).trigger('change');
        this.$('a[name="website_sale_main_button"]').removeClass('disabled');
    },

    _onClickQtyUpdate: function (ev) {
        ev.preventDefault();
        const $link = $(ev.currentTarget);
        const $input = $link.closest('.css_quantity').find('input[name="add_qty"]');
        let qty = parseFloat($input.val() || 0);

        if ($link.hasClass('b2b_qty_minus')) {
            qty = Math.max(1, qty - 1);
        } else if ($link.hasClass('b2b_qty_plus')) {
            qty = qty + 1;
        }

        $input.val(qty);
    },
});

publicWidget.registry.B2BProductOnlySearch = publicWidget.Widget.extend({
    selector: '.o_searchbar_form',

    start: function () {
        const $input = this.$('.search-query');
        $input.attr('data-search-type', 'products');
        $input.attr('data-display-description', 'false');
        $input.attr('data-display-image', 'true');
        $input.attr('data-display-detail', 'true');
        $input.removeAttr('data-no-fuzzy');
        this.$el.attr('action', '/shop');
        return this._super.apply(this, arguments);
    },
});

if (publicWidget.registry.searchBar) {
    publicWidget.registry.searchBar.include({
        _render: function (res) {
            this._super.apply(this, arguments);
            if (!res || !this.$menu || !res.results) {
                return;
            }

            const self = this;
            const $items = this.$menu.find('a.dropdown-item');
            $items.each(function (index) {
                const result = res.results[index];
                if (!result) {
                    return;
                }
                const $item = $(this);
                const $searchRow = $item.find('.o_search_result_item');
                if (!$searchRow.length || $searchRow.find('.b2b-search-result-cart-form').length) {
                    return;
                }

                const href = $item.attr('href') || '';
                const templateIdMatch = href.match(/-(\d+)(?:\?.*)?$/);
                const templateId = result.product_template_id || (templateIdMatch ? templateIdMatch[1] : '');
                if (!templateId) {
                    return;
                }

                $searchRow.find('p').remove();
                const $priceBlock = $searchRow.find('.flex-shrink-0.ms-auto');
                if ($priceBlock.length) {
                    $priceBlock.addClass('b2b-search-result-price');
                }
                $searchRow.append(`
                    <div class="d-flex align-items-center gap-1 ms-auto b2b-search-result-cart-form"
                         data-product-id="${result.product_id || ''}"
                         data-product-template-id="${templateId}">
                        <div class="css_quantity input-group input-group-sm b2b_qty_group" style="max-width:106px;">
                            <a href="#" class="btn btn-outline-secondary b2b_qty_action b2b_qty_minus" aria-label="Decrease quantity">
                                <span class="fa fa-minus"></span>
                            </a>
                            <input type="text" name="add_qty" class="form-control quantity text-center" value="1" data-min="1"/>
                            <a href="#" class="btn btn-outline-secondary b2b_qty_action b2b_qty_plus" aria-label="Increase quantity">
                                <span class="fa fa-plus"></span>
                            </a>
                        </div>
                        <button type="button" class="btn btn-primary b2b-icon-cart-btn b2b_search_result_add_to_cart" aria-label="Add to cart" title="Add to cart">
                            <span class="fa fa-shopping-cart"></span>
                        </button>
                    </div>
                `);
                const $wrapper = $searchRow.find('.b2b-search-result-cart-form').last();
                $wrapper.find('.b2b_search_result_add_to_cart').on('click', async function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const wrapper = ev.currentTarget.closest(".b2b-search-result-cart-form");
                    if (!wrapper) {
                        return;
                    }
                    const qtyInput = wrapper.querySelector('input[name="add_qty"]');
                    const addQty = Math.max(1, parseInt(qtyInput?.value || 1, 10) || 1);
                    let productId = parseInt(wrapper.dataset.productId || 0, 10);
                    const productTemplateId = parseInt(wrapper.dataset.productTemplateId || 0, 10);
                    if (!productId && productTemplateId) {
                        const meta = await rpc("/b2b/search/cart_meta", {
                            template_id: productTemplateId,
                        });
                        productId = parseInt(meta?.product_id || 0, 10);
                        if (productId) {
                            wrapper.dataset.productId = String(productId);
                        }
                    }
                    if (!productId) {
                        return;
                    }
                    const data = await rpc("/shop/cart/update_json", {
                        product_id: productId,
                        add_qty: addQty,
                        display: false,
                    });
                    wSaleUtils.updateCartNavBar(data);
                    wSaleUtils.showCartNotification(self.call.bind(self), data.notification_info);
                });
            });
        },
    });
}
