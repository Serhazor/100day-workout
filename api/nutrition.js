// ИИ-разбор чека и оценка КБЖУ по названию продукта. Отдельная функция от state.js,
// чтобы не завязывать хранение данных на наличие ключа Anthropic — без него приложение
// просто не покажет кнопки распознавания, всё остальное работает как обычно.
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TEXT = 8000;          // защита от случайно вставленной книги вместо чека
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // жёсткий лимит тела запроса на Vercel — 4.5 МБ, оставляем запас на JSON-обвязку base64

const clean = (v) => String(v ?? '').slice(0, MAX_TEXT);

function receiptPrompt(hasImage, text, mode) {
  if (mode === 'summary') {
    return 'Это скриншот или текст экрана приложения-трекера питания (например MyFitnessPal, Lifesum, ' +
      'Yazio) с ИТОГОВЫМИ значениями за день — это НЕ чек из магазина, и отдельных позиций тут может не ' +
      'быть вовсе, только суммы.\n' +
      (hasImage ? 'Посмотри на приложенный скриншот.' : 'Текст с экрана:\n' + clean(text)) + '\n\n' +
      'Найди суммарные итоговые числа за весь день (Calories/Total, белки/protein, углеводы/carbs, ' +
      'жиры/fat — и клетчатку/сахар/натрий, если они показаны). Это уже готовые итоги за день, а НЕ ' +
      'данные на 100 г или на одну порцию — не пересчитывай, не нормализуй, возьми числа как есть с экрана.\n' +
      'Ответь ТОЛЬКО JSON-массивом из РОВНО ОДНОГО объекта, без какого-либо другого текста, в точности ' +
      'такого вида:\n' +
      '[{"name":"Итог дня (MyFitnessPal)","servingLabel":"весь день","calories":1850,"protein":120,"carbs":180,"fat":60,"fiber":0,"sugar":0,"sodium":0}]\n' +
      '"name" — по-русски, коротко указывает источник (например "Итог дня (MyFitnessPal)"). Поле ' +
      '"servingLabel" всегда "весь день". Если какого-то показателя на экране нет — поставь 0, а не оценку.';
  }
  if (mode === 'label') {
    return 'Это фото или текст ПЕЧАТНОЙ таблицы «Пищевая ценность» (Nutrition Facts) с упаковки продукта — ' +
      'это НЕ чек из магазина и не скриншот трекера. Твоя задача — точно ПРОЧИТАТЬ (транскрибировать) числа, ' +
      'которые уже напечатаны производителем, а НЕ оценивать их по памяти о похожих продуктах.\n' +
      (hasImage ? 'Посмотри на приложенное фото этикетки.' : 'Текст этикетки:\n' + clean(text)) + '\n\n' +
      'Определи размер порции, для которой указаны значения в таблице (например «45 г», «1 порция (30 г)», ' +
      '«на 100 г») — это поле servingLabel. Если этот размер порции явно выражен в граммах — продублируй ' +
      'это число (без единиц измерения) в поле servingGrams; если вес не в граммах или не указан — поставь 0 ' +
      'в servingGrams.\n' +
      'Ответь ТОЛЬКО JSON-массивом из РОВНО ОДНОГО объекта, без какого-либо другого текста, в точности ' +
      'такого вида:\n' +
      '[{"name":"Название с упаковки","servingLabel":"45 г","servingGrams":45,"calories":190,"protein":8,"carbs":22,"fat":7,"fiber":2,"sugar":5,"sodium":140}]\n' +
      '"name" — по-русски, коротко. Числа бери ТОЧНО как написано на этикетке, ничего не округляй по своим ' +
      'догадкам — если какое-то значение не видно или отсутствует на этикетке, поставь 0.';
  }
  return 'Ты извлекаешь из чека из магазина или ресторана продукты питания и напитки для трекера калорий.\n' +
    (hasImage ? 'Посмотри на приложенное фото чека.' : 'Текст чека:\n' + clean(text)) + '\n\n' +
    'Для каждого отдельного продукта или напитка (игнорируй налог, чаевые, итог, скидки, баллы лояльности ' +
    'и непищевые позиции вроде пакетов или подарочных карт) оцени его типичную пищевую ценность как есть при продаже.\n' +
    'Ответь ТОЛЬКО JSON-массивом, без какого-либо другого текста, в точности такого вида:\n' +
    '[{"name":"Куриная грудка","servingLabel":"1 упаковка (400 г)","servingGrams":400,"calories":440,"protein":93,"carbs":0,"fat":5,"fiber":0,"sugar":0,"sodium":180}]\n' +
    'Все числа — на указанный servingLabel. Названия — по-русски, короткие и узнаваемые. ' +
    'Если из servingLabel можно определить вес порции в граммах — укажи его числом в servingGrams (без единиц); ' +
    'если нет — поставь 0. Если не уверен в самих значениях КБЖУ — дай разумную оценку, а не ноль.';
}

function lookupPrompt(name, servingLabel) {
  return 'Оцени типичную пищевую ценность продукта для личного трекера питания.\n' +
    'Продукт: ' + clean(name) + '\n' +
    (servingLabel ? 'Порция: ' + clean(servingLabel) + '\n' : 'Порция не указана — выбери разумную (например, "1 средний (61 г)" или "100 г").\n') +
    'Ответь ТОЛЬКО JSON-объектом, без какого-либо другого текста, в точности такого вида:\n' +
    '{"name":"Морковь","servingLabel":"1 средняя (61 г)","servingGrams":61,"calories":25,"protein":0.6,"carbs":6,"fat":0.1,"fiber":1.7,"sugar":2.9,"sodium":42}\n' +
    'Все числа — на указанный servingLabel. Название по-русски. Поле servingGrams — вес указанной порции в ' +
    'граммах числом (без единиц); если порция не весовая и вес непонятен, поставь 0. Если не уверен в КБЖУ — ' +
    'дай разумную оценку, а не ноль.';
}

function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  // модель иногда оборачивает ответ в ```json ... ``` несмотря на инструкцию — снимаем аккуратно
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch (e) { return undefined; } // undefined = было, но не распарсилось
}

export default async function handler(req, res) {
  if (!process.env.APP_KEY || req.headers['x-app-key'] !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'not_configured' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const kind = body?.kind;
    if (kind !== 'receipt' && kind !== 'lookup') {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const content = [];
    let prompt;
    if (kind === 'receipt') {
      const hasImage = !!body.imageBase64;
      if (hasImage) {
        if (!body.imageMediaType || !/^image\/(png|jpeg|jpg|webp)$/.test(body.imageMediaType)) {
          return res.status(400).json({ error: 'invalid_request' });
        }
        if (Buffer.byteLength(body.imageBase64, 'base64') > MAX_IMAGE_BYTES) {
          return res.status(400).json({ error: 'image_too_large' });
        }
        content.push({ type: 'image', source: { type: 'base64', media_type: body.imageMediaType, data: body.imageBase64 } });
      } else if (!body.text || !body.text.trim()) {
        return res.status(400).json({ error: 'invalid_request' });
      }
      const mode = body.mode === 'summary' ? 'summary' : (body.mode === 'label' ? 'label' : 'items');
      prompt = receiptPrompt(hasImage, body.text, mode);
    } else {
      if (!body.name || !body.name.trim()) {
        return res.status(400).json({ error: 'invalid_request' });
      }
      prompt = lookupPrompt(body.name, body.servingLabel);
    }
    content.push({ type: 'text', text: prompt });

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1536,
        messages: [{ role: 'user', content }]
      })
    });

    if (upstream.status === 429) return res.status(429).json({ error: 'rate_limited' });
    if (!upstream.ok) {
      console.error('anthropic error', upstream.status, await upstream.text().catch(() => ''));
      return res.status(502).json({ error: 'upstream_error' });
    }

    const json = await upstream.json();
    const text = json?.content?.find((b) => b.type === 'text')?.text;
    const parsed = extractJson(text);
    if (parsed === undefined) return res.status(422).json({ error: 'invalid_json' });
    if (parsed === null) return res.status(422).json({ error: 'empty_completion' });
    if (kind === 'receipt' && !Array.isArray(parsed)) return res.status(422).json({ error: 'invalid_json' });
    if (kind === 'lookup' && (typeof parsed !== 'object' || Array.isArray(parsed))) return res.status(422).json({ error: 'invalid_json' });

    return res.status(200).json({ data: parsed });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
}
