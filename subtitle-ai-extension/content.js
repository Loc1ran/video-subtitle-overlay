// Video Subtitle Studio - AI Assistant Content Script (Widget-Free Edition)
// Seamless bridge for ChatGPT (chatgpt.com), DeepSeek (chat.deepseek.com), Gemini (gemini.google.com), Claude (claude.ai)
// Operates silently via extension popup or background messages without on-page widgets or visual clutter.

(function () {
  'use strict';

  const API_BASE = 'http://127.0.0.1:8000';
  let isProcessing = false;

  // 1. Detect Provider
  function getProvider() {
    const host = window.location.hostname;
    if (host.includes('chatgpt.com') || host.includes('openai.com')) return 'chatgpt';
    if (host.includes('deepseek.com')) return 'deepseek';
    if (host.includes('gemini.google.com')) return 'gemini';
    if (host.includes('claude.ai')) return 'claude';
    return 'generic';
  }

  const provider = getProvider();

  // 2. Background proxy communication (avoids Mixed Content / CORS blocks)
  function requestApi(action, payload = {}) {
    return new Promise((resolve, reject) => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action, payload }, (res) => {
          if (chrome.runtime.lastError) {
            directFetch(action, payload).then(resolve).catch(reject);
          } else if (res && res.success) {
            resolve(res.data);
          } else {
            reject(new Error((res && res.error) || 'Extension communication failed'));
          }
        });
      } else {
        directFetch(action, payload).then(resolve).catch(reject);
      }
    });
  }

  async function directFetch(action, payload) {
    if (action === 'CHECK_CONNECTION' || action === 'GET_JOB') {
      const res = await fetch(`${API_BASE}/api/ai-job`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    }
    if (action === 'SUBMIT_JOB') {
      const res = await fetch(`${API_BASE}/api/ai-job/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    }
  }

  // 3. Input Text into Chat (with native ProseMirror & React state synchronization)
  async function insertPrompt(text) {
    if (provider === 'chatgpt') {
      let el = null;
      for (let i = 0; i < 30; i++) {
        el = document.querySelector('#prompt-textarea, div[contenteditable="true"].ProseMirror, div[contenteditable="true"]#prompt-textarea, div[contenteditable="true"], textarea');
        if (el) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!el) throw new Error('ChatGPT input box not found. Please ensure chat is loaded.');

      el.focus();
      await new Promise((r) => setTimeout(r, 150));

      let inserted = false;

      // Method 1: Native execCommand insertText (Directly updates ProseMirror document & React state)
      try {
        el.focus();
        document.execCommand('selectAll', false, null);
        const ok = document.execCommand('insertText', false, text);
        await new Promise((r) => setTimeout(r, 200));
        const len = (el.innerText || el.textContent || '').trim().length;
        if (ok && len > 20) {
          inserted = true;
          console.log('[VSS] Text inserted via execCommand insertText (len=' + len + ')');
        }
      } catch (e) {
        console.warn('[VSS] execCommand insertText error:', e);
      }

      // Method 2: Synthetic ClipboardEvent with DataTransfer
      if (!inserted) {
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', text);
          const pasteEvt = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt
          });
          el.dispatchEvent(pasteEvt);
          await new Promise((r) => setTimeout(r, 200));
          const len = (el.innerText || el.textContent || '').trim().length;
          if (len > 20) {
            inserted = true;
            console.log('[VSS] Text inserted via synthetic paste event');
          }
        } catch (e) {
          console.warn('[VSS] Synthetic paste error:', e);
        }
      }

      // Method 3: Direct ProseMirror HTML injection with beforeinput event
      if (!inserted && el.isContentEditable) {
        try {
          const lines = text.split('\n');
          el.innerHTML = lines
            .map((l) => `<p>${l ? l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '<br class="ProseMirror-trailingBreak">'}</p>`)
            .join('');
          el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertFromPaste' }));
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
          inserted = true;
          console.log('[VSS] Text inserted via ProseMirror HTML injection');
        } catch (e) {
          console.warn('[VSS] ProseMirror HTML injection error:', e);
        }
      }

      // Method 4: Textarea prototype setter fallback
      if (!inserted && el.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(el, text);
        else el.value = text;
        inserted = true;
      }

      // Put cursor at the end & dispatch input events for React
      try {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e) {}

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    } else if (provider === 'deepseek') {
      let el = document.querySelector('textarea.ds-textarea, textarea');
      if (!el) throw new Error('DeepSeek textarea not found. Please ensure chat is loaded.');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (provider === 'gemini') {
      let el = document.querySelector('rich-textarea div[contenteditable="true"], div[contenteditable="true"]');
      if (!el) throw new Error('Gemini input not found. Please ensure chat is loaded.');
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (provider === 'claude') {
      let el = document.querySelector('div[contenteditable="true"], textarea');
      if (!el) throw new Error('Claude editor not found. Please ensure chat is loaded.');
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // 4. Click Send & Auto Enter
  async function clickSend() {
    let sendBtn = null;
    const deadline = Date.now() + 5000;

    // Poll until React / ProseMirror updates and activates the send button
    while (Date.now() < deadline) {
      if (provider === 'chatgpt') {
        sendBtn = document.querySelector(
          'button[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label*="Gửi" i]'
        );
      } else if (provider === 'deepseek') {
        sendBtn = document.querySelector('.ds-button--primary, button[aria-label*="Send"], div[role="button"][aria-label*="Send"]');
      } else if (provider === 'gemini') {
        sendBtn = document.querySelector('button.send-button, button[aria-label*="Send"], button[aria-label*="Gửi"]');
      } else if (provider === 'claude') {
        sendBtn = document.querySelector('button[aria-label*="Send"]');
      }

      if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
        break;
      }

      const inputEl = document.querySelector('#prompt-textarea, textarea.ds-textarea, div[contenteditable="true"], textarea');
      if (inputEl) {
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    const inputEl = document.querySelector('#prompt-textarea, textarea.ds-textarea, div[contenteditable="true"], textarea');

    // 1. Click send button if active
    if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
      console.log('[VSS] Clicking active send button...');
      sendBtn.focus();
      sendBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      sendBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      sendBtn.click();
    }

    // 2. ALWAYS also dispatch native Enter keydown/keyup on the input element
    if (inputEl) {
      console.log('[VSS] Dispatching Enter keyboard event on input...');
      inputEl.focus();
      inputEl.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true
      }));
      inputEl.dispatchEvent(new KeyboardEvent('keypress', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true
      }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true
      }));
    }

    // 3. Verify submission
    await new Promise((r) => setTimeout(r, 800));
    if (isGenerating() || (inputEl && (inputEl.innerText || inputEl.value || '').trim() === '')) {
      console.log('[VSS] Prompt successfully submitted to AI!');
    } else {
      console.log('[VSS] Retrying send button click...');
      const retryBtn = document.querySelector('button[data-testid="send-button"], button[aria-label*="Send" i]');
      if (retryBtn) retryBtn.click();
    }
  }

  // 5. Generation State Detection
  function isGenerating() {
    if (provider === 'chatgpt') {
      return !!document.querySelector('button[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="Dừng"]');
    } else if (provider === 'deepseek') {
      return !!document.querySelector('.ds-loading, .ds-button--primary svg rect');
    } else if (provider === 'gemini') {
      return !!document.querySelector('button[aria-label*="Stop"], mat-spinner, .sparkle-spinner');
    } else if (provider === 'claude') {
      return !!document.querySelector('button[aria-label*="Stop"]');
    }
    return false;
  }

  function getLatestAssistantText() {
    let selector = '';
    if (provider === 'chatgpt') {
      selector = 'div[data-message-author-role="assistant"], .markdown';
    } else if (provider === 'deepseek') {
      selector = '.ds-message .ds-markdown, .ds-markdown, .chat-message-content';
    } else if (provider === 'gemini') {
      selector = 'message-content, .model-response-text, .response-container-content';
    } else if (provider === 'claude') {
      selector = '.font-claude-message, .font-user-message ~ div, .standard-markdown';
    } else {
      selector = 'div[data-message-author-role="assistant"], .markdown, .ds-markdown, message-content';
    }

    if (!selector || !selector.trim()) return '';

    try {
      const elements = document.querySelectorAll(selector);
      if (elements && elements.length > 0) {
        return elements[elements.length - 1].innerText || '';
      }
    } catch (e) {
      console.warn('Selector query failed:', e);
    }
    return '';
  }

  // Floating Status HUD
  function showFloatingStatus(text) {
    try {
      let hud = document.getElementById('vss-floating-hud');
      if (!hud) {
        hud = document.createElement('div');
        hud.id = 'vss-floating-hud';
        hud.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999999;background:rgba(15,23,42,0.95);color:#38bdf8;border:1px solid rgba(56,189,248,0.5);border-radius:10px;padding:12px 18px;font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:600;box-shadow:0 10px 35px rgba(0,0,0,0.6);backdrop-filter:blur(10px);display:flex;align-items:center;gap:10px;pointer-events:none;transition:all 0.3s ease;';
        document.body.appendChild(hud);
      }
      hud.innerHTML = `<span style="font-size:15px">⚡</span> <span>Video Subtitle Studio:</span> <span style="color:#f8fafc;font-weight:400">${text}</span>`;
      if (text.includes('Success') || text.includes('Applied') || text.includes('complete')) {
        hud.style.borderColor = '#10b981';
        hud.style.color = '#10b981';
        setTimeout(() => {
          if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
        }, 5000);
      }
    } catch (e) {}
  }

  // 5.5 Auto-Enable ChatGPT Thinking / Reasoning Mode
  async function enableChatGptThinkingMode() {
    console.log('[VSS] Checking ChatGPT Thinking / Reasoning mode...');

    // 1. Scan for Reason / Think buttons in composer toolbar
    for (let attempt = 0; attempt < 12; attempt++) {
      const buttons = Array.from(
        document.querySelectorAll('button, div[role="button"], div[role="switch"], [data-testid*="reason" i], [data-testid*="think" i]')
      );
      let targetBtn = null;

      for (const btn of buttons) {
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        const testid = (btn.getAttribute('data-testid') || '').toLowerCase();
        const txt = (btn.textContent || '').trim().toLowerCase();

        if (
          testid.includes('reason') || testid.includes('think') ||
          label.includes('reason') || label.includes('think') || label.includes('suy nghĩ') ||
          txt === 'reason' || txt === 'think' || txt === 'suy nghĩ' ||
          txt.includes('deep research')
        ) {
          targetBtn = btn;
          break;
        }
      }

      if (targetBtn) {
        const isActive =
          targetBtn.getAttribute('aria-pressed') === 'true' ||
          targetBtn.getAttribute('aria-checked') === 'true' ||
          targetBtn.getAttribute('data-state') === 'checked' ||
          targetBtn.getAttribute('data-state') === 'active' ||
          targetBtn.classList.contains('active') ||
          targetBtn.className.includes('selected') ||
          targetBtn.className.includes('bg-token-main-surface-tertiary') ||
          targetBtn.querySelector('[data-state="checked"]');

        if (!isActive) {
          console.log('[VSS] Clicking Reason button to activate thinking mode...');
          targetBtn.focus();
          targetBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          targetBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          targetBtn.click();
          await new Promise((r) => setTimeout(r, 400));
        } else {
          console.log('[VSS] Reason / Thinking mode already active.');
        }
        return true;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    // 2. Secondary: Top Model dropdown check (switch to o3-mini or o1)
    try {
      const modelPicker = document.querySelector(
        'button[data-testid="model-switcher-dropdown-button"], button[aria-label*="model" i], button[aria-haspopup="menu"], header button:has(svg)'
      );
      if (modelPicker) {
        const currentModel = (modelPicker.textContent || '').toLowerCase();
        if (!currentModel.includes('o1') && !currentModel.includes('o3') && !currentModel.includes('think') && !currentModel.includes('reason')) {
          console.log('[VSS] Opening model dropdown to select o3-mini/o1...');
          modelPicker.click();
          await new Promise((r) => setTimeout(r, 500));
          const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"], div[role="option"], button[role="menuitem"], [data-radix-collection-item]'));
          for (const item of menuItems) {
            const itemText = (item.textContent || '').toLowerCase();
            if (itemText.includes('o3-mini') || itemText.includes('o1') || itemText.includes('think') || itemText.includes('reason')) {
              console.log('[VSS] Selected model:', itemText);
              item.click();
              await new Promise((r) => setTimeout(r, 500));
              return true;
            }
          }
          document.body.click();
        } else {
          console.log('[VSS] Active model already has reasoning capability:', currentModel);
          return true;
        }
      }
    } catch (e) {
      console.warn('[VSS] Model dropdown switch error:', e);
    }

    return false;
  }

  // 5.6 Localized Prompt Templates (Matching Target Translation Language)
  const LOCALIZED_PROMPTS = {
    vi: {
      thinkingHeader: "[CHẾ ĐỘ SUY NGHĨ & LÝ LUẬN SÂU ĐANG BẬT]\nVui lòng suy nghĩ từng bước và cân nhắc kỹ lưỡng ngữ cảnh trước khi đưa ra bản dịch:",
      thinkingRules: [
        "1. Ngữ cảnh & Mối quan hệ: Diễn biến tâm lý nhân vật, không khí lãng mạn, tán tỉnh ngầm, khoảng lặng ngập ngừng, trêu đùa dí dỏm hoặc gây hài.",
        "2. Bản địa hóa & Từ ngữ đời thường: Sử dụng văn phong tiếng Việt hiện đại, tự nhiên của giới trẻ, tránh dịch thô cứng hoặc dịch sát từng từ.",
        "3. Nhịp điệu & Độ ngắn gọn: Phụ đề video cần ngắn gọn, súc tích để người xem kịp đọc nhưng vẫn giữ đúng nhịp điệu và ngữ điệu hội thoại tự nhiên.",
        "4. Nhất quán: Giữ xưng hô, đại từ, biệt danh và giọng điệu của từng nhân vật đồng nhất xuyên suốt đoạn hội thoại."
      ],
      thinkingOutput: "Sau khi suy nghĩ, chỉ xuất kết quả cuối cùng theo đúng định dạng mảng JSON hợp lệ duy nhất:\nĐịnh dạng mẫu: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      standardDesc: "Bạn là chuyên gia dịch phụ đề video hàng đầu. Hãy dịch các câu thoại video sau đây sang tiếng Việt một cách tự nhiên, mượt mà và đúng ngữ điệu giao tiếp đời thường.\nGiữ giọng điệu tự nhiên, chân thực và phù hợp với nhịp độ hội thoại trong video.",
      standardFormat: "QUAN TRỌNG: Chỉ phản hồi duy nhất một mảng JSON hợp lệ, trong đó mỗi phần tử gồm \"id\" (số) và \"translated\" (chuỗi).\nĐịnh dạng mẫu: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      originalLinesHeader: "Các câu thoại gốc cần dịch:"
    },
    en: {
      thinkingHeader: "[THINKING & DEEP REASONING MODE ACTIVE]\nPlease think step-by-step and thoroughly reason through before producing the translations:",
      thinkingRules: [
        "1. Scene Context & Relationship: Interpersonal dynamics, romantic tension, awkward pauses, playful teasing, and comedic timing.",
        "2. Slang & Colloquial Localizations: Natural, contemporary phrasing in English, avoiding stiff or literal translations.",
        "3. Rhythm & Brevity: Subtitles must be readable quickly on video while preserving natural conversational speech cadence.",
        "4. Consistency: Keep character voices, nicknames, and pronouns natural and consistent across dialogue turns."
      ],
      thinkingOutput: "After your reasoning, output ONLY the final valid JSON array format:\nExample format: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      standardDesc: "You are an expert video subtitle translator. Translate the following spoken video dialogue lines accurately and naturally into English.\nKeep the tone natural, colloquial, and faithful to conversational rhythm.",
      standardFormat: "IMPORTANT: Respond ONLY with a valid JSON array where each object has \"id\" (number) and \"translated\" (string).\nExample format: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      originalLinesHeader: "Original Lines to translate:"
    },
    zh: {
      thinkingHeader: "[深度思考与推理模式已开启]\n请在生成翻译之前逐步思考并充分推导场景语境：",
      thinkingRules: [
        "1. 场景语境与人物关系：把握角色间的心理活动、情感张力、暧昧氛围、尴尬停顿与幽默互动。",
        "2. 口语化与本土化表达：使用自然地道的现代中文口语，避免僵硬死板的字面直译。",
        "3. 节奏感与精炼度：视频字幕必须简洁易读，方便观众瞬间捕捉，同时保留自然流畅的说话节奏。",
        "4. 一致性：保持各角色的称谓、代词、语气和性格特点在整个对话中始终如一。"
      ],
      thinkingOutput: "思考完成后，仅输出最终符合规范的 JSON 数组：\n示例格式: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      standardDesc: "你是一位精通视频字幕本地化的资深翻译专家。请将以下视频对话自然、流畅、准确地翻译为中文。\n语言风格贴近真实生活口语，契合视频交流的自然节奏。",
      standardFormat: "重要提示：仅返回一个合法的 JSON 数组，每个对象包含 \"id\"（数字）和 \"translated\"（字符串）。\n示例格式: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      originalLinesHeader: "待翻译的原台词:"
    },
    ja: {
      thinkingHeader: "[思考・深層推論モード有効]\n翻訳を生成する前に、文脈やニュアンスを順を追って深く思考・推敲してください：",
      thinkingRules: [
        "1. シーンの文脈と人間関係：登場人物の心理描写、恋愛感情、微妙な間、からかいやユーモアのタイミング。",
        "2. 自然な口語とローカライズ：現代の自然な若者言葉・日常会話表現を使用し、不自然な直訳を避けてください。",
        "3. リズムと簡潔さ：動画視聴者が瞬時に理解できるよう簡潔にまとめつつ、生きた会話のリズムを保ちます。",
        "4. 一貫性：人称代名詞、呼び名、キャラクターの口調・トーンを会話全体で一貫させてください。"
      ],
      thinkingOutput: "思考プロセスの後、最終的な有効な JSON 配列のみを出力してください：\n出力例: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      standardDesc: "あなたは映像字幕のプロフェッショナルです。以下の動画台詞を、自然で親しみやすい日本語に翻訳してください。\n会話のリズムを生かし、日常会話として違和感のない表現を心がけてください。",
      standardFormat: "重要：各要素が \"id\"（数値）と \"translated\"（文字列）を持つ有効な JSON 配列のみを出力してください。\n出力例: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      originalLinesHeader: "翻訳対象の原文台詞:"
    },
    ko: {
      thinkingHeader: "[심층 추론 및 생각 모드 활성화]\n번역을 생성하기 전에 맥락과 뉘앙스를 단계별로 깊이 생각하고 추론해 주세요:",
      thinkingRules: [
        "1. 장면 맥락 및 인물 관계: 캐릭터 간의 미묘한 심리, 설렘, 어색한 침묵, 장난스러운 대화 및 유머 타이밍.",
        "2. 자연스러운 구어체 및 현지화: 부자연스러운 직역을 지양하고 현대 한국어 일상 회화 및 최신 유행 어조를 반영합니다.",
        "3. 리듬감과 간결함: 영상 시청자가 빠르게 읽고 이해할 수 있도록 간결하게 다듬으면서 자연스러운 말맛을 살립니다.",
        "4. 일관성: 호칭, 대명사, 캐릭터 특유의 말투와 톤을 대화 전반에 걸쳐 일관되게 유지합니다."
      ],
      thinkingOutput: "생각 과정을 거친 후, 오직 최종적인 유효한 JSON 배열만 출력해 주세요:\n예시 형식: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      standardDesc: "당신은 최고의 영상 자막 번역 전문가입니다. 다음 영상 대사를 자연스럽고 생생한 한국어로 번역해 주세요.\n일상 구어체에 맞추어 생생하고 매끄럽게 대화 흐름을 살려 번역합니다.",
      standardFormat: "중요: 각 객체가 \"id\"(숫자)와 \"translated\"(문자열)로 구성된 유효한 JSON 배열만 응답해야 합니다.\n예시 형식: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      originalLinesHeader: "번역할 원문 대사:"
    },
    es: {
      thinkingHeader: "[MODO DE PENSAMIENTO Y RAZONAMIENTO PROFUNDO ACTIVO]\nPor favor, piensa paso a paso y analiza a fondo el contexto antes de producir las traducciones:",
      thinkingRules: [
        "1. Contexto de la escena y relaciones: Dinámica interpersonal, tensión romántica, pausas incómodas, bromas juguetonas y ritmo cómico.",
        "2. Modismos y lenguaje coloquial: Lenguaje juvenil, moderno y natural en español, evitando traducciones rígidas o literales.",
        "3. Ritmo y brevedad: Los subtítulos deben ser concisos y rápidos de leer en video, manteniendo la cadencia natural de la conversación.",
        "4. Coherencia: Mantén los pronombres, apodos y el tono de voz de cada personaje consistentes a lo largo de todo el diálogo."
      ],
      thinkingOutput: "Tras tu razonamiento, genera ÚNICAMENTE el formato de array JSON válido final:\nFormato de ejemplo: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      standardDesc: "Eres un experto traductor de subtítulos de video. Traduce las siguientes líneas de diálogo de video de manera precisa y natural al español.\nMantén un tono coloquial, natural y fiel al ritmo de la conversación.",
      standardFormat: "IMPORTANTE: Responde ÚNICAMENTE con un array JSON válido donde cada objeto tenga \"id\" (número) y \"translated\" (cadena).\nFormato de ejemplo: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      originalLinesHeader: "Líneas originales para traducir:"
    },
    fr: {
      thinkingHeader: "[MODE DE PENSÉE ET RAISONNEMENT PROFOND ACTIVÉ]\nVeuillez réfléchir étape par étape et analyser soigneusement le contexte avant de traduire :",
      thinkingRules: [
        "1. Contexte de la scène et relations : Dynamique entre les personnages, tension romantique, silences, taquineries et timing comique.",
        "2. Expressions idiomatiques et familières : Phrasé moderne et naturel en français, en évitant toute traduction rigide ou littérale.",
        "3. Rythme et concision : Les sous-titres doivent être rapides à lire en vidéo tout en préservant le rythme naturel de la parole.",
        "4. Cohérence : Maintenez le tutoiement/vouvoiement, les surnoms et la personnalité de chaque personnage tout au long du dialogue."
      ],
      thinkingOutput: "Après réflexion, produisez UNIQUEMENT le tableau JSON valide final :\nExemple de format : [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      standardDesc: "Vous êtes un traducteur expert de sous-titres vidéo. Traduisez fidèlement et naturellement les lignes de dialogue suivantes en français.\nConservez un ton naturel, vivant et fidèle au rythme de la conversation.",
      standardFormat: "IMPORTANT : Répondez UNIQUEMENT avec un tableau JSON valide où chaque objet contient \"id\" (nombre) et \"translated\" (chaîne).\nExemple de format : [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      originalLinesHeader: "Lignes originales à traduire :"
    },
    de: {
      thinkingHeader: "[TIEFEN-DENK- UND REFLEXIONSMODUS AKTIV]\nBitte denke Schritt für Schritt nach und analysiere den Kontext gründlich, bevor du übersetzt:",
      thinkingRules: [
        "1. Szenenkontext & Beziehungen: Zwischenmenschliche Dynamik, romantische Spannung, Pausen, spielerische Neckereien und Timing.",
        "2. Umgangssprache & Lokalisierung: Natürliche, zeitgemäße Formulierungen auf Deutsch, keine steifen oder wörtlichen Übersetzungen.",
        "3. Rhythmus & Kürze: Untertitel müssen im Video schnell lesbar sein und den natürlichen Redefluss bewahren.",
        "4. Konsistenz: Anredeformen, Spitznamen und Charakterstimmen über den gesamten Dialog hinweg einheitlich halten."
      ],
      thinkingOutput: "Gib nach deiner Überlegung NUR das finale, gültige JSON-Array-Format aus:\nBeispielformat: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      standardDesc: "Du bist ein professioneller Untertitel-Übersetzer. Übersetze die folgenden Dialogzeilen präzise und natürlich ins Deutsche.\nHalte den Tonfall authentisch, umgangssprachlich und lebendig.",
      standardFormat: "WICHTIG: Antworte AUSSCHLIESSLICH mit einem gültigen JSON-Array, in dem jedes Objekt \"id\" (Zahl) und \"translated\" (Text) enthält.\nBeispielformat: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      originalLinesHeader: "Zu übersetzende Originalzeilen:"
    },
    ru: {
      thinkingHeader: "[РЕЖИМ ГЛУБОКОГО МЫШЛЕНИЯ И РАССУЖДЕНИЯ ВКЛЮЧЕН]\nПожалуйста, рассуждайте пошагово и глубоко проанализируйте контекст перед переводом:",
      thinkingRules: [
        "1. Контекст сцены и отношения: Межличностная динамика, романтическое напряжение, неловкие паузы, шутливые подколы и комедийный тайминг.",
        "2. Сленг и живая речь: Естественная современная русская разговорная речь без сухих и буквальных калек.",
        "3. Ритм и краткость: Субтитры должны легко считываться в видео, сохраняя темп и дыхание живого диалога.",
        "4. Последовательность: Обращения, местоимения, прозвища и характерные интонации каждого персонажа должны быть едины на протяжении всей сцены."
      ],
      thinkingOutput: "После рассуждения выведите ТОЛЬКО итоговый валидный JSON-массив:\nПример формата: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      standardDesc: "Вы — первоклассный переводчик видеосубтитров. Переведите следующие реплики из видео на русский язык максимально точно и естественно.\nСохраняйте живой разговорный тон и ритм естественной речи.",
      standardFormat: "ВАЖНО: Отвечайте ТОЛЬКО валидным JSON-массивом, где каждый объект содержит \"id\" (число) и \"translated\" (строка).\nПример формата: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      originalLinesHeader: "Оригинальные строки для перевода:"
    },
    th: {
      thinkingHeader: "[เปิดโหมดการคิดและใช้เหตุผลเชิงลึก]\nโปรดคิดทีละขั้นตอนและพิจารณาบริบทอย่างละเอียดก่อนสร้างคำแปล:",
      thinkingRules: [
        "1. บริบทและมิติความสัมพันธ์: ความรู้สึกของตัวละคร ความโรแมนติก การหยอกล้อ จังหวะตลก และการเว้นจังหวะอารมณ์",
        "2. ภาษาพูดและการปรับให้เข้ากับวัฒนธรรม: ใช้ภาษาไทยที่ทันสมัย เป็นธรรมชาติของวัยรุ่น หลีกเลี่ยงการแปลตรงตัวที่แข็งกระด้าง",
        "3. จังหวะและความกระชับ: ซับไตเติลต้องกระชับ อ่านง่ายและรวดเร็วบนวิดีโอ โดยยังคงความเป็นธรรมชาติของการสนทนา",
        "4. ความสม่ำเสมอ: สรรพนาม การเรียกชื่อ และน้ำเสียงของตัวละครต้องคงที่ตลอดทั้งบทสนทนา"
      ],
      thinkingOutput: "หลังจากคิดวิเคราะห์แล้ว ให้ตอบกลับเฉพาะอาร์เรย์ JSON ที่ถูกต้องเท่านั้น:\nรูปแบบตัวอย่าง: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      standardDesc: "คุณเป็นผู้เชี่ยวชาญด้านการแปลซับไตเติลวิดีโอ โปรดแปลประโยคบทสนทนาต่อไปนี้เป็นภาษาไทยอย่างเป็นธรรมชาติและลื่นไหล\nใช้น้ำเสียงที่เป็นกันเอง เป็นภาษาพูดที่สมจริงและเข้ากับจังหวะของวิดีโอ",
      standardFormat: "สำคัญ: ตอบกลับเฉพาะอาร์เรย์ JSON ที่ถูกต้อง โดยแต่ละออบเจกต์มี \"id\" (ตัวเลข) และ \"translated\" (ข้อความ)\nรูปแบบตัวอย่าง: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      originalLinesHeader: "ประโยคต้นฉบับที่ต้องแปล:"
    },
    id: {
      thinkingHeader: "[MODE BERPIKIR & PENALARAN MENDALAM AKTIF]\nSilakan berpikir langkah demi langkah dan pertimbangkan konteks secara mendalam sebelum menerjemahkan:",
      thinkingRules: [
        "1. Konteks Adegan & Hubungan: Dinamika antarkarakter, ketegangan romantis, jeda canggung, candaan santai, dan waktu komedi.",
        "2. Bahasa Gaul & Lokalisasi Alami: Gunakan bahasa Indonesia gaul/sehari-hari yang kekinian, hindari terjemahan kaku atau kata per kata.",
        "3. Ritme & Keringkasan: Subtitle video harus ringkas agar mudah dibaca cepat sambil mempertahankan alur percakapan yang alami.",
        "4. Konsistensi: Jaga kata sapaan, nama panggilan, dan gaya bicara tiap karakter tetap konsisten di seluruh dialog."
      ],
      thinkingOutput: "Setelah bernalar, tampilkan HANYA format array JSON yang valid:\nContoh format: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      standardDesc: "Anda adalah penerjemah subtitle video profesional. Terjemahkan dialog video berikut ke dalam bahasa Indonesia yang alami dan luwes.\nPertahankan nada percakapan yang santai, hidup, dan sesuai dengan ritme video.",
      standardFormat: "PENTING: Jawab HANYA dengan array JSON yang valid di mana setiap objek memiliki \"id\" (angka) dan \"translated\" (string).\nContoh format: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
      originalLinesHeader: "Baris dialog asli yang akan diterjemahkan:"
    }
  };

  function buildLocalizedAiPrompt(targetLangCode, thinkingMode, linesText) {
    const code = (targetLangCode || 'en').toLowerCase();
    const template = LOCALIZED_PROMPTS[code] || LOCALIZED_PROMPTS.en;
    if (thinkingMode) {
      return `${template.thinkingHeader}\n${template.thinkingRules.join('\n')}\n\n${template.thinkingOutput}\n\n${template.originalLinesHeader}\n${linesText}`;
    } else {
      return `${template.standardDesc}\n\n${template.standardFormat}\n\n${template.originalLinesHeader}\n${linesText}`;
    }
  }

  // 6. Workflow Automation
  async function startTranslationWorkflow(job, progressCallback) {
    if (isProcessing) throw new Error('A translation workflow is already running.');
    if (!job || !job.segments || job.segments.length === 0) {
      throw new Error('No subtitle segments found in active job.');
    }

    isProcessing = true;
    const notify = (msg) => {
      console.log(`[Subtitle Studio AI] ${msg}`);
      showFloatingStatus(msg);
      if (progressCallback) progressCallback(msg);
    };

    try {
      if (provider === 'chatgpt') {
        const isThinking = job.thinking_mode !== false;
        if (isThinking) {
          try {
            notify('🧠 Enabling ChatGPT Thinking / Reasoning mode...');
            await enableChatGptThinkingMode();
          } catch (e) {
            console.warn('[VSS] Could not auto-toggle ChatGPT thinking mode:', e);
          }
        }
      } else if (provider === 'deepseek') {
        try {
          const thinkBtns = Array.from(document.querySelectorAll('button, div[role="button"]'))
            .filter(b => b.innerText && b.innerText.includes('DeepThink'));
          for (const btn of thinkBtns) {
            const isActive = btn.classList.contains('active') ||
                             btn.getAttribute('aria-pressed') === 'true' ||
                             btn.className.includes('selected') ||
                             btn.querySelector('.active');
            if (!isActive) {
              notify('🧠 Enabling DeepThink (R1) reasoning mode...');
              btn.click();
              await new Promise(r => setTimeout(r, 400));
              break;
            }
          }
        } catch (e) {
          console.warn('Could not auto-toggle DeepThink:', e);
        }
      }

      notify('Formatting dialogue prompt in target language...');
      let fullPrompt = job.prompt;
      if (!fullPrompt) {
        const langCode = (job.target_lang || 'vi').toLowerCase();
        const isThinking = job.thinking_mode !== false;
        const formattedLines = job.segments
          .map((seg) => `#${seg.id}: ${seg.text || seg.original || seg.custom_text || ''}`)
          .join('\n');
        fullPrompt = buildLocalizedAiPrompt(langCode, isThinking, formattedLines);
      }

      notify('Typing prompt into chat input...');
      await insertPrompt(fullPrompt);

      notify('Sending message to AI...');
      await clickSend();

      notify('Waiting for AI reasoning and response...');
      await new Promise((r) => setTimeout(r, 3500));

      let stableCounter = 0;
      let lastText = '';
      const maxWaitSeconds = 300; // Extended timeout for deep reasoning
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitSeconds * 1000) {
        await new Promise((r) => setTimeout(r, 1200));
        const generating = isGenerating();
        const currentText = getLatestAssistantText();

        if (currentText.length > 50 && currentText === lastText && !generating) {
          stableCounter++;
          if (stableCounter >= 2) break;
        } else {
          stableCounter = 0;
          lastText = currentText;
        }

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        notify(`Generating translations... (${elapsed}s)`);
      }

      if (!lastText || lastText.length < 20) {
        throw new Error('No assistant response detected from chat.');
      }

      notify('Submitting translations to Studio backend...');
      const result = await requestApi('SUBMIT_JOB', {
        file_id: job.file_id,
        response: lastText
      });

      if (result && result.success) {
        notify(`✅ Success! Applied ${result.updated_count} subtitles to Studio.`);
        return { success: true, count: result.updated_count };
      } else {
        throw new Error((result && result.detail) || 'Submission failed');
      }
    } finally {
      isProcessing = false;
    }
  }

  // 7. Message Listener for Popup & Background triggers (NO WIDGET INJECTED)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
      if (req.action === 'PING') {
        sendResponse({ success: true, provider, isProcessing });
        return false;
      }

      if (req.action === 'START_TRANSLATION') {
        (async () => {
          try {
            let job = req.job;
            if (!job) {
              const data = await requestApi('GET_JOB');
              job = data && data.job;
            }
            if (!job || !job.segments) {
              sendResponse({ success: false, error: 'No active video project or segments found in Studio.' });
              return;
            }
            const res = await startTranslationWorkflow(job, (statusMsg) => {
              try {
                chrome.runtime.sendMessage({ action: 'TRANSLATION_PROGRESS', message: statusMsg });
              } catch (e) {}
            });
            sendResponse({ success: true, result: res });
          } catch (err) {
            sendResponse({ success: false, error: err.message });
          }
        })();
        return true; // Keep message channel open for async response
      }
    });
  }

  // 8. Auto-Trigger on AI Chat Tabs:
  // Detects tabs opened via Video Subtitle Studio (via URL parameter, session storage, or recent queued job)
  if (provider !== 'generic') {
    (async () => {
      let isVssAuto =
        window.location.search.includes('ref=vss_auto') ||
        window.location.hash.includes('ref=vss_auto') ||
        window.location.search.includes('vss_auto');

      try {
        if (isVssAuto) {
          sessionStorage.setItem('vss_auto_active', 'true');
        } else if (sessionStorage.getItem('vss_auto_active') === 'true') {
          isVssAuto = true;
        }
      } catch (e) {}

      // Poll until the input box is ready and verify if an active queued job exists
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise((r) => setTimeout(r, 800));
        if (isProcessing) break;

        try {
          const inputEl = document.querySelector(
            '#prompt-textarea, textarea.ds-textarea, rich-textarea, div[contenteditable="true"], textarea'
          );
          if (!inputEl) continue;

          const data = await requestApi('GET_JOB');
          const job = data && data.job;
          if (!job || !job.segments || job.segments.length === 0) continue;

          const isRecentQueued = job.status === 'queued' && (Date.now() / 1000 - (job.created_at || 0) < 120);

          if (isVssAuto || isRecentQueued) {
            console.log('[Subtitle Studio AI] Active queued job detected. Attempting to claim...');
            const claimRes = await requestApi('CLAIM_JOB', { file_id: job.file_id }).catch(() => ({ claimed: true }));
            if (claimRes && claimRes.claimed) {
              console.log('[Subtitle Studio AI] Claimed job successfully. Executing translation workflow...');
              try { sessionStorage.removeItem('vss_auto_active'); } catch (e) {}
              showFloatingStatus('Queued job detected! Auto-starting translation...');
              await startTranslationWorkflow(job);
              break;
            }
          }
        } catch (err) {
          // Keep polling until page is fully initialized
        }
      }
    })();
  }

  console.log(`[Subtitle Studio AI] Extension active for ${provider} (Widget-Free mode).`);
})();
