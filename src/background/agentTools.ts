// src/background/agentTools.ts
//
// ──────────────────────────────────────────────────────────────
// CUSTOM TOOL FUNCTIONS (5 tools — each called by the LLM agent)
// ──────────────────────────────────────────────────────────────
// The Gemini LLM decides WHICH tool to call and WITH WHAT arguments.
// Each function runs, returns a result, and that result is fed back
// into the next LLM query as part of the conversation history.
//
// Tool Categories:
//   Tool 1 — Pure calculation      (calculate_color_contrast)
//   Tool 2 — External network call (test_hyperlink_health)
//   Tool 3 — Browser interaction   (simulate_focus_tabs)
//   Tool 4 — DOM inspection        (check_image_alt_texts)
//   Tool 5 — DOM inspection        (analyze_heading_hierarchy)
// ──────────────────────────────────────────────────────────────

// ── Tool 1: WCAG Color Contrast Calculator (pure math, no network) ──
export function calculate_color_contrast(fg_hex: string, bg_hex: string) {
    const hexToRgb = (hex: string) => {
        const h = hex.replace('#', '');
        const val = parseInt(h.length === 3 ? h.split('').map(c => c+c).join('') : h, 16);
        return { r: (val >> 16) & 255, g: (val >> 8) & 255, b: val & 255 };
    };
    
    const luminance = (r: number, g: number, b: number) => {
        const a = [r, g, b].map(v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
    };
    
    try {
        const fg = hexToRgb(fg_hex);
        const bg = hexToRgb(bg_hex);
        const l1 = luminance(fg.r, fg.g, fg.b);
        const l2 = luminance(bg.r, bg.g, bg.b);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const ratioStr = ratio.toFixed(2) + ":1";
        
        return { 
            ratio: ratioStr, 
            passes_AA_normal: ratio >= 4.5,
            passes_AA_large: ratio >= 3.0,
            passes_AAA_normal: ratio >= 7.0 
        };
    } catch (e) {
        return { error: "Invalid hex color format. Provide colors like #FFFFFF" };
    }
}

// ── Tool 2: Hyperlink Health Checker (external network fetch) ──
export async function test_hyperlink_health(url: string) {
    try {
        let res = await fetch(url, { method: 'HEAD' });
        // some servers block HEAD requests and return 405 Method Not Allowed
        if (res.status === 405 || res.status === 403) {
            res = await fetch(url, { method: 'GET' });
        }
        return { url, status: res.status, isBroken: !res.ok };
    } catch (e) {
        return { url, status: "Network Error or CORS block", isBroken: true, message: (e as Error).message };
    }
}

// ── Tool 3: Keyboard Tab Simulator (chrome.scripting on active tab) ──
export async function simulate_focus_tabs(tabId: number, count: number) {
    const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (c) => {
            const focusable = document.querySelectorAll('a, button, input, [tabindex]:not([tabindex="-1"])');
            return Array.from(focusable).slice(0, c).map(el => {
                const text = (el as HTMLElement).innerText?.trim() || (el as HTMLElement).getAttribute('aria-label') || el.tagName.toLowerCase();
                return text.substring(0, 20);
            });
        },
        args: [count]
    });
    return { focused_elements: results[0].result || [] };
}

// ── Tool 4: Image Alt-Text Auditor (DOM inspection via scripting) ──
export async function check_image_alt_texts(tabId: number) {
    const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
            const images = document.querySelectorAll('img');
            let missingAlt = 0;
            let total = images.length;
            images.forEach(img => {
                if (!img.hasAttribute('alt') || img.getAttribute('alt')?.trim() === '') {
                    missingAlt++;
                }
            });
            return { total_images: total, missing_alt_attributes: missingAlt };
        }
    });
    return results[0].result || { total_images: 0, missing_alt_attributes: 0 };
}

// ── Tool 5: Heading Hierarchy Analyzer (DOM inspection via scripting) ──
export async function analyze_heading_hierarchy(tabId: number) {
    const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
            const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
            const hierarchy = Array.from(headings).map(h => h.tagName.toLowerCase());
            return { heading_order: hierarchy };
        }
    });
    return results[0].result || { heading_order: [] };
}

// ──────────────────────────────────────────────────────────────
// TOOL SCHEMA — sent to Gemini so it knows what tools exist.
// The LLM reads these declarations and decides which to call.
// ──────────────────────────────────────────────────────────────
export const agenticToolsSchema = [{
    functionDeclarations: [
        {
            name: "calculate_color_contrast",
            description: "Calculates exact WCAG accessibility contrast ratio between foreground and background hex colors.",
            parameters: { type: "OBJECT", properties: { fg_hex: { type: "STRING" }, bg_hex: { type: "STRING" } }, required: ["fg_hex", "bg_hex"] }
        },
        {
            name: "test_hyperlink_health",
            description: "Checks if a specific hyperlink is broken (404) or works (200).",
            parameters: { type: "OBJECT", properties: { url: { type: "STRING" } }, required: ["url"] }
        },
        {
            name: "simulate_focus_tabs",
            description: "Simulates pressing the TAB key multiple times to test keyboard navigation accessibility.",
            parameters: { type: "OBJECT", properties: { count: { type: "INTEGER" } }, required: ["count"] }
        },
        {
            name: "check_image_alt_texts",
            description: "Scans the active web page to count how many images are missing their descriptive 'alt' tags for screen readers.",
            parameters: { type: "OBJECT", properties: {} } // No parameters needed
        },
        {
            name: "analyze_heading_hierarchy",
            description: "Extracts the exact sequence of heading tags (h1, h2, etc) on the page to verify logical SEO and accessibility structure.",
            parameters: { type: "OBJECT", properties: {} } // No parameters needed
        }
    ]
}];