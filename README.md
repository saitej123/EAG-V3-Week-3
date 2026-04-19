# Agentic FairFrame

<p align="center">
  <img src="./public/icons/icon128.png" alt="Agentic FairFrame logo" width="96" />
</p>

> **Your AI-powered QA and Design Critic** — an autonomous AI agent that actively tests your webpage using real tools.

Agentic FairFrame is a Chrome extension that lives in your **side panel**. Open any website, run a review, and watch the AI agent think, test, and analyze the page in real-time.

---

## How the Agentic Loop Works

Instead of one-shot "send data → get answer", the AI runs in a **multi-turn loop** — calling the LLM multiple times, using tools, and accumulating the full conversation history at every step:

```
Query1 → LLM Response → Tool Call : Tool Result →
Query2 → LLM Response → Tool Call : Tool Result →
Query3 → LLM Response → Final JSON Result
```

**Each query contains ALL past interactions** — the LLM always sees every previous query, every tool call, and every tool result before deciding its next action.

### The Loop in Code (`src/background/geminiAudit.ts`)

```typescript
// conversationHistory stores ALL past interactions (queries + responses + tool results)
const conversationHistory: any[] = [{ role: "user", parts }];

while (!isDone && loopCount < MAX_LOOPS) {
  loopCount++;
  onLog(`Agent is thinking (Turn ${loopCount})...`);    // ← streams to UI

  // 1. Send the FULL conversation history to Gemini
  const requestBody = {
    contents: conversationHistory,   // ← ALL past turns included
    tools: agenticToolsSchema,       // ← tells LLM what tools exist
  };
  const data = await fetch(geminiUrl, { body: JSON.stringify(requestBody) });

  // 2. Append the model's response to history
  conversationHistory.push(cand.content);

  // 3. Check: did the LLM call a tool, or return the final answer?
  const fnCallParts = responseParts.filter(p => p.functionCall);

  if (fnCallParts.length > 0) {
    // ── TOOL CALL PATH (parallel execution via Promise.allSettled) ──
    const settled = await Promise.allSettled(
      fnCallParts.map(async (fnCallPart) => {
        onLog(`Tool Call: ${fnName}`);
        const result = await executeTool(fnName, args);
        onLog(`Result (${fnName}): ${JSON.stringify(result)}`);
        return { functionResponse: { name: fnName, response: { output: result } } };
      })
    );
    // Append ALL tool results at once → next iteration sends FULL history
    conversationHistory.push({ role: "function", parts: settled.map(s => s.value) });

  } else {
    // ── FINAL ANSWER PATH ──
    const finalJSON = parseGeminiJsonText(generatedText);
    isDone = true;  // exit the loop
  }
}
```

---

## Reasoning Chain Display

The extension displays the agent's reasoning chain in **two places** — not just the final answer:

1. **Live terminal on the Home tab** — shows the reasoning chain while the agent is running
2. **Dedicated "Agent" tab** — persists the full chain after the run completes so you can review every tool call and result at any time

```typescript
// Background script streams each step to the side panel via messages
const onAgentLog = (msg: string) => {
  chrome.runtime.sendMessage({ type: "AGENT_LOG_UPDATE", message: msg });
};

// Side panel listens and stores timestamped entries
useEffect(() => {
  const handler = (req: any) => {
    if (req.type === "AGENT_LOG_UPDATE") {
      setAgentLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg: req.message }]);
    }
  };
  chrome.runtime.onMessage.addListener(handler);
}, []);
```

The **Agent tab** renders each entry with color-coded highlighting:

| Color | Meaning |
|-------|---------|
| Violet | Agent is thinking (new turn) |
| Yellow | Tool call being executed |
| Blue | Tool result returned |
| Green | Audit complete |
| Orange | Warning / retry |

---

## Parallel Tool Execution

When Gemini requests multiple tools in a single response, all calls run **concurrently** using `Promise.allSettled` — not one at a time:

```
Sequential (before):  Tool A (200ms) → Tool B (800ms) → Tool C (150ms) = ~1150ms
Parallel   (after):   Tool A (200ms) ─┐
                      Tool B (800ms) ─┤ = ~800ms (limited by slowest tool)
                      Tool C (150ms) ─┘
```

All 5 tools are safe to parallelize — they are independent operations (pure math, network fetch, or read-only DOM inspection) with no shared mutable state.

```typescript
const settled = await Promise.allSettled(
  fnCallParts.map(async (fnCallPart) => {
    const result = await executeTool(fnCallPart.functionCall.name, args);
    return { functionResponse: { name, response: { output: result } } };
  })
);
// Even if one tool throws, others still return valid results
```

---

## Side Panel Tabs

The side panel has **5 tabs**:

| Tab | Icon | What it shows |
|-----|------|---------------|
| **Home** | Squares | Run button, live terminal during analysis, summary cards |
| **Findings** | List | All issues found, export to Markdown/JSON |
| **Agent** | Brain | Full reasoning chain — every tool call and result with timestamps |
| **This page** | Monitor | Page metadata, viewport, model info, snapshot |
| **Activity** | Scroll | Raw step-by-step debug log |

---

## 5 Custom Tool Functions (`src/background/agentTools.ts`)

The LLM decides which tools to call and with what arguments. Each tool runs independently and returns structured data back to the LLM.

| # | Tool | What it does | Type |
|---|------|-------------|------|
| 1 | `calculate_color_contrast` | Computes WCAG contrast ratio between two hex colors | Pure math |
| 2 | `test_hyperlink_health` | Pings a URL to check if it's broken (404) or alive (200) | Network fetch |
| 3 | `simulate_focus_tabs` | Finds focusable elements to test keyboard navigation | Browser scripting |
| 4 | `check_image_alt_texts` | Counts images missing `alt` attributes | DOM inspection |
| 5 | `analyze_heading_hierarchy` | Extracts H1-H6 tag sequence to verify logical structure | DOM inspection |

### Tool Implementation Examples

```typescript
// Tool 1: Pure calculation — WCAG color contrast ratio
export function calculate_color_contrast(fg_hex: string, bg_hex: string) {
  const l1 = luminance(hexToRgb(fg_hex));
  const l2 = luminance(hexToRgb(bg_hex));
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return { ratio: ratio.toFixed(2) + ":1", passes_AA: ratio >= 4.5 };
}

// Tool 2: Network fetch — check if a link is broken
export async function test_hyperlink_health(url: string) {
  const res = await fetch(url, { method: 'HEAD' });
  return { url, status: res.status, isBroken: !res.ok };
}

// Tool 3: Browser interaction — simulate keyboard tabbing
export async function simulate_focus_tabs(tabId: number, count: number) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (c) => {
      const focusable = document.querySelectorAll('a, button, input, [tabindex]');
      return Array.from(focusable).slice(0, c).map(el => el.innerText?.trim());
    },
    args: [count]
  });
  return { focused_elements: results[0].result };
}
```

### Tool Schema (sent to Gemini so the LLM knows what's available)

```typescript
export const agenticToolsSchema = [{
  functionDeclarations: [
    {
      name: "calculate_color_contrast",
      description: "Calculates WCAG contrast ratio between two hex colors.",
      parameters: { type: "OBJECT", properties: {
        fg_hex: { type: "STRING" }, bg_hex: { type: "STRING" }
      }, required: ["fg_hex", "bg_hex"] }
    },
    {
      name: "test_hyperlink_health",
      description: "Checks if a hyperlink is broken (404) or works (200).",
      parameters: { type: "OBJECT", properties: {
        url: { type: "STRING" }
      }, required: ["url"] }
    },
    // ... + simulate_focus_tabs, check_image_alt_texts, analyze_heading_hierarchy
  ]
}];
```

---

## Example Agent Run (what the Agent tab shows)

```
[11:08:01] 🤖 Agent initializing...
[11:08:02] 💭 Agent is thinking (Turn 1)...
[11:08:04] 🛠️ Tool Call: Executing calculate_color_contrast
[11:08:04] 🛠️ Tool Call: Executing test_hyperlink_health
[11:08:04] 📥 Result (calculate_color_contrast): {"ratio":"1.36:1","passes_AA_normal":false}
[11:08:05] 📥 Result (test_hyperlink_health): {"url":"...","status":404,"isBroken":true}
[11:08:05] 💭 Agent is thinking (Turn 2)...
[11:08:07] 🛠️ Tool Call: Executing simulate_focus_tabs
[11:08:07] 🛠️ Tool Call: Executing check_image_alt_texts
[11:08:07] 📥 Result (simulate_focus_tabs): {"focused_elements":["Home","About","Contact"]}
[11:08:07] 📥 Result (check_image_alt_texts): {"total_images":3,"missing_alt_attributes":2}
[11:08:08] 💭 Agent is thinking (Turn 3)...
[11:08:09] 🛠️ Tool Call: Executing analyze_heading_hierarchy
[11:08:09] 📥 Result (analyze_heading_hierarchy): {"heading_order":["h1","h3","h4"]}
[11:08:10] 💭 Agent is thinking (Turn 4)...
[11:08:15] ✅ Audit Complete! Generating final report.
```

---

## Screenshots

![Agentic FairFrame in the browser - wide view](./Images/2.png)

| Side Panel View | Highlights View |
| :---: | :---: |
| ![Agentic FairFrame side panel](./Images/1.png) | ![Agentic FairFrame side panel](./Images/4.png) |
| ![Agentic FairFrame side panel](./Images/3.png) | ![Agentic FairFrame side panel](./Images/5.png) |

---

## Quick Start

1. **Get the code** and install:
   ```bash
   npm install && npm run build
   ```
2. **Load into Chrome:** Open `chrome://extensions`, toggle **Developer mode** on, click **Load unpacked**, and select the `dist` folder.
3. **Add your API Key:** Open **Agentic FairFrame** from the side panel. Add your **Gemini API key** ([get one free](https://aistudio.google.com/apikey)).
4. **Start Testing:** Visit any website, open the side panel, click **Review this page**, and watch the agent work!

---

## Architecture

| File | Role |
| :--- | :--- |
| `src/background/geminiAudit.ts` | The agentic loop — calls Gemini multiple times, manages conversation history, dispatches tool calls in parallel |
| `src/background/agentTools.ts` | 5 custom tool functions + their schema declarations for Gemini |
| `src/background/index.ts` | Bridges agent logs to the side panel UI via `chrome.runtime.sendMessage` |
| `src/sidepanel/App.tsx` | React UI — 5 tabs including the dedicated **Agent** tab for the full reasoning chain |
| `public/icons/icon-source.svg` | SVG source for the extension icon (robot agent in scanning brackets) |

---

## For Developers

| Command | Purpose |
| :--- | :--- |
| `npm run typecheck` | Run TypeScript validation |
| `npm run verify` | Build + sanity check |
| `npm run icons` | Regenerate PNG icons from `public/icons/icon-source.svg` |

**Default AI Engine:** [Google Gemini](https://ai.google.dev/) (free API key).

---

<p align="center"><strong>Agentic FairFrame</strong> · Open Source Chrome Extension</p>
