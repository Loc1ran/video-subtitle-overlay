// Subtitle Studio AI Assistant - Service Worker (Background Script)
// Proxies requests to http://127.0.0.1:8000 to bypass Mixed Content & CORS restrictions on HTTPS AI chats.

const API_BASE = "http://127.0.0.1:8000";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "CHECK_CONNECTION" || request.action === "GET_JOB") {
    fetch(`${API_BASE}/api/ai-job`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        sendResponse({ success: true, data });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (request.action === "CLAIM_JOB") {
    fetch(`${API_BASE}/api/ai-job/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.payload || {})
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        sendResponse({ success: true, data });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (request.action === "SUBMIT_JOB") {
    fetch(`${API_BASE}/api/ai-job/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.payload)
    })
      .then(async (res) => {
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText || `HTTP ${res.status}`);
        }
        const data = await res.json();
        sendResponse({ success: true, data });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (request.action === "OPEN_STUDIO") {
    chrome.tabs.create({ url: API_BASE });
    sendResponse({ success: true });
    return false;
  }
});

// Track tabs opened with vss_auto even before client-side redirects strip query params
const vssAutoTabs = new Set();
const triggeredTabs = new Set();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const currentUrl = (changeInfo.url || (tab && tab.url) || "").toLowerCase();
  
  if (currentUrl.includes("ref=vss_auto") || currentUrl.includes("vss_auto")) {
    vssAutoTabs.add(tabId);
  }

  if (changeInfo.status === "complete" && tab && tab.url) {
    const url = tab.url.toLowerCase();
    const isAiHost =
      url.includes("chatgpt.com") ||
      url.includes("openai.com") ||
      url.includes("deepseek.com") ||
      url.includes("gemini.google.com") ||
      url.includes("claude.ai");

    if (isAiHost) {
      const wasMarked = vssAutoTabs.has(tabId);
      if (wasMarked) vssAutoTabs.delete(tabId);

      if (triggeredTabs.has(tabId)) return;

      setTimeout(async () => {
        try {
          const res = await fetch(`${API_BASE}/api/ai-job`);
          if (res.ok) {
            const data = await res.json();
            const job = data && data.job;
            const isRecentQueued = job && job.status === "queued" && (Date.now() / 1000 - (job.created_at || 0) < 120);

            if (wasMarked || isRecentQueued) {
              triggeredTabs.add(tabId);
              setTimeout(() => triggeredTabs.delete(tabId), 30000);
              console.log("[Background] Auto-triggering translation in tab:", tabId);
              chrome.tabs.sendMessage(tabId, { action: "START_TRANSLATION", job }).catch(() => {});
            }
          }
        } catch (e) {
          console.warn("[Background] Failed checking ai-job:", e);
        }
      }, 1200);
    }
  }
});
