# Deploy tmap-v2 (Coagentix backend)

ระบบนี้เป็นแบบ **key ผูกกับ account** → คุณ **ไม่จำเป็นต้อง**ใส่ provider key ของผู้ใช้บน server
(แต่ควรตั้ง `OPENROUTER_API_KEY` เป็น fallback ระดับ server — ดูข้อ 4 ด้านล่าง)

ผู้ใช้แต่ละคนจะ login แล้วเพิ่ม API key ของตัวเองในหน้าเว็บ

---

## ⚠️ ก่อน deploy
1. **เพิกถอน key เก่าที่เคยเปิดเผย แล้วสร้างใหม่** (Gemini / DeepSeek / DashScope / Groq)
2. อย่าใส่ key ลง `.env.example` หรือไฟล์ที่ commit — ใช้ host env vars หรือเพิ่มผ่านหน้าเว็บเท่านั้น

---

## Preflight: สิ่งที่ production **บังคับ** (server ไม่ boot ถ้าขาด)

`src/server/preflight.ts` ตรวจตอน start เมื่อ `NODE_ENV=production` — ขาดข้อใดข้อหนึ่ง
process จะ `exit(1)` ทันที:

| ต้องมี | รายละเอียด | override (ตั้งใจข้าม) |
|---|---|---|
| `JWT_SECRET` | 16+ ตัวอักษร — blueprint ให้ Render สร้างอัตโนมัติ (`generateValue`) | — |
| `COAGENTIX_MASTER_KEY` | 16+ ตัวอักษร — **ต้องตั้งเองใน dashboard** (`openssl rand -hex 32`) ตั้งครั้งเดียวแล้ว**ห้ามเปลี่ยน** ไม่งั้น key ที่เข้ารหัสไว้ทั้งหมดถอดไม่ได้ | — |
| Supabase (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`) | durable storage — ไม่ตั้ง = บัญชี/คีย์หายทุก redeploy | `COAGENTIX_ALLOW_EPHEMERAL_DB=1` (เดโมชั่วคราวเท่านั้น) |
| Redis (`REDIS_URL` / `REDIS_HOST`) | login lockout + rate limiter ข้าม instance | `COAGENTIX_ALLOW_NO_REDIS=1` (single instance เท่านั้น — blueprint ตั้งให้แล้ว) |

> ชื่อเก่า `AOF_MASTER_KEY` ยังใช้แทน `COAGENTIX_MASTER_KEY` ได้ (backward compat)
> แต่ deployment ใหม่ให้ใช้ชื่อใหม่

---

## ตัวเลือก A — Render (canonical, มี blueprint ที่ root repo)

1. push โค้ดขึ้น GitHub
2. ไปที่ https://dashboard.render.com → **New** → **Blueprint** → เชื่อม repo นี้
   (`render.yaml` อยู่ที่ root, `rootDir: tmap-v2`)
3. Render สร้าง `JWT_SECRET` ให้อัตโนมัติ ส่วนค่าที่เป็น `sync: false` **ต้องกรอกเอง**:
   - `COAGENTIX_MASTER_KEY` → `openssl rand -hex 32` (ตั้งครั้งเดียว เก็บสำเนาถาวร)
   - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` → ชี้ Supabase โปรเจกต์เดียวกับ aof-web
     (หรือถ้าเดโมแบบไม่มี Supabase: เพิ่ม `COAGENTIX_ALLOW_EPHEMERAL_DB=1` แทน —
     ยอมรับว่าบัญชี/คีย์รีเซ็ตทุก redeploy)
   - `OPENROUTER_API_KEY` → server-level fallback (ดูคอมเมนต์ใน `render.yaml`)
4. กด **Apply** → ได้ URL เช่น `https://coagentix.onrender.com` → เปิด → Register → Run
5. blueprint ตั้ง `COAGENTIX_ALLOW_NO_REDIS=1` ไว้แล้ว (free plan = instance เดียว) —
   ถ้า scale หลาย instance ให้เพิ่ม Render Key Value แล้วตั้ง `REDIS_URL` + ลบ override นี้

---

## ตัวเลือก B — เครื่อง/VPS ของคุณเอง (Docker)

```bash
docker build -t coagentix .
docker run -p 8787:8787 \
  -e NODE_ENV=production \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -e COAGENTIX_MASTER_KEY=$(openssl rand -hex 32) \
  -e SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... \
  -e COAGENTIX_ALLOW_NO_REDIS=1 \
  -v aof-data:/app/.aof-server \
  coagentix
```

- ไม่มี Supabase → ใส่ `-e COAGENTIX_ALLOW_EPHEMERAL_DB=1` แล้ว mount volume
  (`-v aof-data:/app/.aof-server`) เพื่อไม่ให้ข้อมูลหายเมื่อรีสตาร์ต
- เก็บ `COAGENTIX_MASTER_KEY` ไว้ที่เดียวถาวร — เปลี่ยนแล้วถอดรหัส key เก่าของผู้ใช้ไม่ได้

---

## ขึ้น production จริง ควรทำเพิ่ม
- ตั้ง `COAGENTIX_ALLOWED_ORIGINS` เป็นโดเมน frontend จริง (จำกัด CORS)
- ใช้ Supabase (อย่าใช้ ephemeral override) + Redis จริงเมื่อมีมากกว่า 1 instance
- บังคับ **HTTPS** (host ส่วนใหญ่ให้มาแล้ว; HSTS header เปิดอยู่แล้วใน production)
