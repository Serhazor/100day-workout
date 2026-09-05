import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const clean = (v) => String(v ?? 'me').slice(0, 64);

export default async function handler(req, res) {
  // Простая защита общим ключом. Полноценная авторизация здесь избыточна:
  // это личный трекер на одного человека, а не многопользовательский сервис.
  if (!process.env.APP_KEY || req.headers['x-app-key'] !== process.env.APP_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const rows = await sql`select data from state where id = ${clean(req.query.id)}`;
      return res.status(200).json({ data: rows[0]?.data ?? null });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const data = body?.data;
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'expected { id, data }' });
      }
      await sql`
        insert into state (id, data, updated_at)
        values (${clean(body.id)}, ${JSON.stringify(data)}::jsonb, now())
        on conflict (id) do update
          set data = excluded.data, updated_at = now()`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
}
