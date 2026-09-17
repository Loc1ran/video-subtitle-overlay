export interface PromptTemplate {
  thinkingHeader: string;
  thinkingRules: string[];
  thinkingOutput: string;
  standardDesc: string;
  standardFormat: string;
  originalLinesHeader: string;
}

export const LOCALIZED_PROMPTS: Record<string, PromptTemplate> = {
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
      "4. Konsistensi: Jaga kata sapaan, nama panggilan, và gaya bicara tiap karakter tetap konsisten di seluruh dialog."
    ],
    thinkingOutput: "Setelah bernalar, tampilkan HANYA format array JSON yang valid:\nContoh format: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
    standardDesc: "Anda adalah penerjemah subtitle video profesional. Terjemahkan dialog video berikut ke dalam bahasa Indonesia yang alami dan luwes.\nPertahankan nada percakapan yang santai, hidup, dan sesuai dengan ritme video.",
    standardFormat: "PENTING: Jawab HANYA dengan array JSON yang valid di mana setiap objek memiliki \"id\" (angka) dan \"translated\" (string).\nContoh format: [{\"id\": 1, \"translated\": \"...\"}, {\"id\": 2, \"translated\": \"...\"}]",
    originalLinesHeader: "Baris dialog asli yang akan diterjemahkan:"
  }
};

export function buildLocalizedAiPrompt(targetLangCode: string, thinkingMode: boolean, linesText: string): string {
  const code = (targetLangCode || "en").toLowerCase();
  const template = LOCALIZED_PROMPTS[code] || LOCALIZED_PROMPTS.en;

  if (thinkingMode) {
    return `${template.thinkingHeader}\n${template.thinkingRules.join("\n")}\n\n${template.thinkingOutput}\n\n${template.originalLinesHeader}\n${linesText}`;
  } else {
    return `${template.standardDesc}\n\n${template.standardFormat}\n\n${template.originalLinesHeader}\n${linesText}`;
  }
}
