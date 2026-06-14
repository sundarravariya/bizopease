/** @odoo-module **/
import { registry } from "@web/core/registry";
import { loadJS } from "@web/core/assets";

const STORAGE_KEY = "flipkart_qz_printer";

async function ensureQZ() {
    if (typeof qz !== "undefined") return;
    await loadJS("/flipkart_os/static/src/js/lib/qz-tray.min.js");
}

/**
 * Fetch the public certificate from the Odoo server.
 * QZ Tray uses this to verify the identity of the site and remember the trust decision.
 */
async function fetchCertificate() {
    const res = await fetch("/qz/cert");
    if (!res.ok) throw new Error("Could not fetch QZ certificate");
    return await res.text();
}

/**
 * Sign the QZ Tray message with the server-side private key.
 * QZ Tray sends a random timestamp string; we sign it with SHA-512/RSA.
 */
async function signMessage(message) {
    const res = await fetch("/qz/sign", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "message=" + encodeURIComponent(message),
    });
    if (!res.ok) throw new Error("QZ signing endpoint failed: " + res.status);
    return await res.text(); // base64 signature
}

async function selectPrinter() {
    let allPrinters = [];
    try {
        allPrinters = await qz.printers.find();
    } catch {
        return localStorage.getItem(STORAGE_KEY) || "TSC TE244";
    }

    if (!allPrinters || allPrinters.length === 0) {
        return localStorage.getItem(STORAGE_KEY) || "TSC TE244";
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    const listText = allPrinters.map((p, i) => `${i + 1}. ${p}`).join("\n");
    const current = stored ? `\n\nCurrent: ${stored}` : "";
    const input = window.prompt(
        `Select printer (enter number or name):${current}\n\n${listText}`,
        stored || allPrinters[0]
    );

    if (!input) return stored || allPrinters[0];

    const byIndex = allPrinters[parseInt(input, 10) - 1];
    const chosen = byIndex || input.trim();
    localStorage.setItem(STORAGE_KEY, chosen);
    return chosen;
}

async function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
}

async function flipkartQZPrint(env, action) {
    try {
        console.log("QZ Print Action Triggered", action);
        const { attachment_id, tspl, pdf_data, name } = action.params || {};

        if (!attachment_id && !tspl && !pdf_data) {
            console.error("No print data provided.");
            env?.services?.notification?.add("No print data to send.", { type: "danger" });
            return;
        }

        try {
            await ensureQZ();
        } catch (e) {
            console.error("Failed to load QZ Tray JS:", e);
            env?.services?.notification?.add(
                "QZ Tray JS library missing. Contact admin.",
                { type: "danger", sticky: true }
            );
            return;
        }

        // ── Certificate + Signing ─────────────────────────────────────────────
        // QZ Tray calls these promises when establishing a connection.
        // Using a real signed certificate means QZ Tray permanently trusts
        // this site — no more "Allow" dialog after the first approval.
        qz.security.setCertificatePromise((resolve, reject) => {
            fetchCertificate()
                .then(cert => {
                    console.log("QZ Certificate loaded successfully.");
                    resolve(cert.trim());
                })
                .catch(err => {
                    console.warn("QZ cert fetch failed, falling back to anonymous:", err);
                    resolve("");
                });
        });

        // Default algorithm is used (SHA-1). We trim signatures to prevent whitespace issues.
        qz.security.setSignaturePromise((toSign) => {
            return (resolve, reject) => {
                console.log("QZ Requesting signature for:", toSign);
                signMessage(toSign)
                    .then(sig => {
                        console.log("QZ Signature received.");
                        resolve(sig.trim());
                    })
                    .catch(err => {
                        console.warn("QZ signing failed, falling back to unsigned:", err);
                        resolve("");
                    });
            };
        });

        // ── Connect ───────────────────────────────────────────────────────────
        try {
            if (!qz.websocket.isActive()) {
                console.log("Connecting to QZ Tray...");
                await qz.websocket.connect();
                console.log("QZ Tray Connected.");
            }
        } catch (err) {
            console.error("QZ Tray Connection Error:", err);
            env?.services?.notification?.add(
                "Cannot connect to QZ Tray. Is it running? Download from qz.io",
                { type: "danger", sticky: true }
            );
            return;
        }

        // ── Printer selection ─────────────────────────────────────────────────
        const forceSelect = window.event && window.event.shiftKey;
        let printerName = (!forceSelect && localStorage.getItem(STORAGE_KEY)) || null;

        if (!printerName) {
            printerName = await selectPrinter();
        }

        if (attachment_id || tspl) {
            // ── TSPL raw mode — rasterized at 203 DPI, BarTender quality ─────────
            let tsplB64 = tspl;
            if (attachment_id) {
                console.log("Fetching TSPL from server attachment...");
                const resp = await fetch(`/web/content/${attachment_id}`);
                if (!resp.ok) throw new Error("Failed to fetch print data: " + resp.status);
                const buffer = await resp.arrayBuffer();
                tsplB64 = await arrayBufferToBase64(buffer);
            }
            console.log(`Sending TSPL to ${printerName}...`);
            const config = qz.configs.create(printerName, { copies: 1 });
            await qz.print(config, [{ type: "raw", format: "base64", data: tsplB64 }]);
        } else {
            // ── PDF pixel mode — packing slips ───────────────────────────────────
            console.log(`Printing PDF to ${printerName}...`);
            const labelW = action.params.label_width  || 127;
            const labelH = action.params.label_height || 76;
            const config = qz.configs.create(printerName, {
                copies: 1,
                units: "mm",
                size: { width: labelW, height: labelH },
                scaleContent: false,
                rasterize: true,
            });
            await qz.print(config, [{
                type: "pixel",
                format: "pdf",
                flavor: "base64",
                data: pdf_data,
            }]);
        }

        await qz.websocket.disconnect();
        console.log("Print job sent successfully.");
        env?.services?.notification?.add(
            `Sent "${name || "labels"}" to ${printerName}`,
            { type: "success" }
        );

    } catch (err) {
        console.error("Global QZ Print Error:", err);
        env?.services?.notification?.add(
            "Print error: " + (err.message || err),
            { type: "danger", sticky: true }
        );
    }
}

registry.category("actions").add("flipkart_qz_print", flipkartQZPrint);
