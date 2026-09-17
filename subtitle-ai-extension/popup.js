document.addEventListener("DOMContentLoaded", async () => {
  const statusEl = document.getElementById("server-status");
  const jobIdEl = document.getElementById("job-id");
  const actionBox = document.getElementById("action-box");
  const actionTabTitle = document.getElementById("action-tab-title");
  const btnRunTab = document.getElementById("btn-run-tab");
  const progressStatus = document.getElementById("progress-status");

  let activeJobData = null;

  // 1. Check Studio connection & current job
  try {
    const res = await fetch("http://127.0.0.1:8000/api/ai-job");
    if (res.ok) {
      const data = await res.json();
      statusEl.innerHTML = '<span class="dot green"></span> Online (:8000)';
      if (data.job && data.job.file_id) {
        activeJobData = data.job;
        const count = activeJobData.segments ? activeJobData.segments.length : 0;
        jobIdEl.textContent = `${activeJobData.file_id} (${count} lines)`;
      } else {
        jobIdEl.textContent = "Waiting for video...";
      }
    } else {
      throw new Error("offline");
    }
  } catch (e) {
    statusEl.innerHTML = '<span class="dot red"></span> Offline';
    jobIdEl.textContent = "Start app first";
  }

  // 2. Detect if active tab is an AI chat
  if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      const activeTab = tabs[0];
      const url = activeTab.url || "";

      let providerName = null;
      if (url.includes("chatgpt.com") || url.includes("openai.com")) providerName = "ChatGPT";
      else if (url.includes("deepseek.com")) providerName = "DeepSeek";
      else if (url.includes("gemini.google.com")) providerName = "Gemini";
      else if (url.includes("claude.ai")) providerName = "Claude";

      if (providerName && actionBox) {
        actionBox.style.display = "block";
        actionTabTitle.textContent = `⚡ ${providerName} Detected`;

        if (btnRunTab) {
          btnRunTab.addEventListener("click", () => {
            btnRunTab.disabled = true;
            progressStatus.style.display = "block";
            progressStatus.textContent = "Initiating translation workflow...";

            chrome.tabs.sendMessage(activeTab.id, { action: "START_TRANSLATION", job: activeJobData }, (res) => {
              if (chrome.runtime.lastError) {
                progressStatus.style.color = "#ef4444";
                progressStatus.textContent = "Error: Please reload the AI chat tab first.";
                btnRunTab.disabled = false;
              } else if (res && res.success) {
                progressStatus.style.color = "#10b981";
                progressStatus.innerHTML = `✅ <strong>Completed!</strong> ${res.result?.count || ""} subtitles updated in Studio.`;
                btnRunTab.disabled = false;
              } else {
                progressStatus.style.color = "#ef4444";
                progressStatus.textContent = `Failed: ${(res && res.error) || "Unknown error"}`;
                btnRunTab.disabled = false;
              }
            });
          });
        }
      }
    });
  }

  // 3. Listen for progress updates from content script
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === "TRANSLATION_PROGRESS" && progressStatus) {
        progressStatus.style.display = "block";
        progressStatus.textContent = msg.message;
      }
    });
  }

  // 4. Ensure external links open cleanly
  document.querySelectorAll("a[href]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const url = link.getAttribute("href");
      if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url });
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    });
  });
});
