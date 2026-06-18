# Deploy Nexora Code (web service)

ระบบนี้เป็นแบบ **key ผูกกับ account** → คุณ **ไม่ต้องใส่ provider key บน server**
server ต้องการแค่ 2 ความลับ: `JWT_SECRET` และ `NEXORA_MASTER_KEY` (host สร้างให้อัตโนมัติได้)

ผู้ใช้แต่ละคนจะ login แล้วเพิ่ม API key ของตัวเองในหน้าเว็บ

---

## ⚠️ ก่อน deploy
1. **เพิกถอน key เก่าที่เคยเปิดเผย แล้วสร้างใหม่** (Gemini / DeepSeek / DashScope / Groq)
2. อย่าใส่ key ลง `.env.example` หรือไฟล์ที่ commit — ใช้ host env vars หรือเพิ่มผ่านหน้าเว็บเท่านั้น

---

## ตัวเลือก A — Render (ง่ายสุด, มี blueprint ให้แล้ว)

1. push โค้ดขึ้น GitHub (โฟลเดอร์ `tmap-v2/` หรือ repo แยก)
2. ไปที่ https://dashboard.render.com → **New** → **Blueprint**
3. เชื่อม GitHub repo ที่มี `render.yaml`
4. Render จะสร้าง `JWT_SECRET` / `NEXORA_MASTER_KEY` ให้อัตโนมัติ → กด **Apply**
5. ได้ URL เช่น `https://nexora-code.onrender.com` → เปิด → Register → ใส่ key ของคุณ → Run

> free plan: ดิสก์ไม่ถาวร ข้อมูล user/key จะรีเซ็ตเมื่อ redeploy — เหมาะกับเดโม
> ใช้งานจริงหลายคน: เปลี่ยน `db.ts` เป็น PostgreSQL (TDD §6) แล้วใส่ `DATABASE_URL`

---

## ตัวเลือก B — Railway (รองรับ Docker)

```bash
npm i -g @railway/cli
railway login
railway init
railway up
# ตั้ง env (ค่าสุ่ม):
railway variables set JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
railway variables set NEXORA_MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

---

## ตัวเลือก C — เครื่อง/VPS ของคุณเอง (Docker)

```bash
docker build -t nexora-code .
docker run -p 8787:8787 \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -e NEXORA_MASTER_KEY=$(openssl rand -hex 32) \
  -v nexora-data:/app/.nexora-server \
  nexora-code
```
`-v nexora-data:/app/.nexora-server` ทำให้ข้อมูล user/key ไม่หายเมื่อรีสตาร์ต

---

## ขึ้น production จริง ควรทำเพิ่ม
- เปลี่ยน DB ไฟล์ → **PostgreSQL** (persist + scale)
- จำกัด **CORS** เป็นโดเมนจริง (ตอนนี้เปิดกว้างเพื่อ dev)
- ใส่ **rate limit** ฝั่ง server
- บังคับ **HTTPS** (host ส่วนใหญ่ให้มาแล้ว)
- เก็บ `NEXORA_MASTER_KEY` ไว้ที่เดียวถาวร — ถ้าเปลี่ยน key นี้ จะถอดรหัส key เก่าของผู้ใช้ไม่ได้
