# Supersix Studio

ระบบจัดการงานกราฟิกส่วนตัวของ Supersix Shop, เติมเกมกับเฟิร์น และ G-station
ใช้ React + Vite, Express, Node.js 24, Prisma 7 และ PostgreSQL บน Supabase
รายการงาน การตั้งค่า และข้อมูลไฟล์แนบอยู่ในฐานข้อมูล ส่วนไฟล์รูป/วิดีโอจริงอยู่บนดิสก์

## เริ่มใช้งาน

ใช้ Node.js 24 และคัดลอก `.env.example` เป็น `.env` พร้อมกรอกรหัสผ่านฐานข้อมูล
ถ้ามี `.env` ที่ตั้งค่าไว้แล้วให้ใช้ไฟล์นั้นต่อได้ ตัวอย่างนี้เชื่อมโปรเจกต์ `oqaauzpjfbyafwwvqmly`

```sh
npm ci --include=dev
npm run build
npm run db:migrate
npm run db:check
npm start
```

`npm start` เปิดโหมด production ที่ `0.0.0.0:10000` และต้องเข้าสู่ระบบด้วย HTTP Basic Authentication
ค่าเริ่มต้นคือ `super6` / `1234` เปลี่ยนได้ด้วย `APP_USERNAME` และ `APP_PASSWORD`
บนเครื่องส่วนตัวเปิด `http://127.0.0.1:10000` ได้ ส่วนโดเมน production ต้องใช้ HTTPS ผ่าน reverse proxy
ให้ proxy ส่ง Host ของโดเมนที่ผู้ใช้เปิดเข้ามา เพื่อให้การตรวจ same-origin ทำงาน

พัฒนาในเครื่องด้วย `npm run dev` ที่ `http://127.0.0.1:3000`
คำสั่งนี้สร้าง Prisma Client ให้อัตโนมัติและรับการเชื่อมต่อเฉพาะ localhost
เปลี่ยนพอร์ตได้ด้วย `npm start -- --port 10001` หรือ `npm run dev -- --port 3001`

## Environment

| ตัวแปร         | หน้าที่                                                            |
| -------------- | ------------------------------------------------------------------ |
| `APP_USERNAME` | ชื่อเข้าใช้งาน ค่าเริ่มต้น `super6`                                |
| `APP_PASSWORD` | รหัสเข้าใช้งาน ค่าเริ่มต้น `1234`                                  |
| `DATABASE_URL` | PostgreSQL connection สำหรับแอป ผ่าน transaction pooler พอร์ต 6543 |
| `DIRECT_URL`   | Connection สำหรับ Prisma Migrate ผ่าน session pooler พอร์ต 5432    |

ทั้งสอง database URL ใช้ `schema=supersix&sslmode=verify-full` และต้อง URL-encode รหัสผ่านที่มีอักขระพิเศษ
ตัวอย่าง URL อยู่ใน `.env.example` ส่วน `.env` จริงถูกกันออกจาก Git
ห้ามใส่ database URL หรือรหัสผ่านฐานข้อมูลใน `VITE_*` หรือ `NEXT_PUBLIC_*`
โปรเจกต์นี้ให้ Express เชื่อมฐานข้อมูลผ่าน Prisma จึงไม่ต้องใช้ Supabase publishable key ในเบราว์เซอร์

พอร์ต ที่เก็บไฟล์ และขนาดอัปโหลดกำหนดใน `server/config.mjs` ไม่ต้องตั้ง env เพิ่ม
โหมด production บน Linux เก็บไฟล์ที่ `/var/data/supersix-studio`
บน Windows และโหมด dev เก็บที่ `data/` รองรับไฟล์ละ 500 MB

## ฐานข้อมูลและ migrations

- Schema `supersix` มีตาราง `jobs`, `assets`, `settings` และ `_prisma_migrations`
- Prisma Client สร้างใน `server/generated/prisma/` จาก `prisma/schema.prisma` และไม่เก็บไฟล์ generated ใน Git
- Runtime ใช้ connection pool สูงสุด 5 connections และ transaction lock ต่อหนึ่งงาน
- การแก้ไขร้านและการอัปโหลดตรวจสถานะงานอีกครั้งใน transaction เพื่อป้องกันข้อมูลและโฟลเดอร์คลาดเคลื่อน
- ตารางเปิด RLS โดยไม่มี policy ให้ผู้ใช้เบราว์เซอร์เข้าถึง การอ่านเขียนทั้งหมดผ่าน Express ที่ตรวจการเข้าสู่ระบบ
- บัญชี PostgreSQL ฝั่งเซิร์ฟเวอร์ต้องเป็นเจ้าของตารางหรือมีสิทธิ์ข้าม RLS บัญชี `postgres` ที่ใช้ตั้งค่านี้รองรับ
- TLS ตรวจ certificate และ hostname ด้วย Supabase CA ที่อยู่ใน `certs/` ทั้ง runtime และ migration
- `/api/health` ตรวจการเชื่อมต่อฐานข้อมูลจริง ตอบ 503 หากฐานข้อมูลไม่พร้อม รวมคำขอที่มาพร้อมกันและเก็บผลไม่เกิน 5 วินาทีเพื่อลดภาระฐานข้อมูล

```sh
npm run db:generate   # สร้าง Prisma Client
npm run db:migrate    # ใช้ migrations ที่อยู่ใน repository
npm run db:status     # ตรวจ migration ที่ใช้ไปแล้ว
npm run db:check      # ตรวจการเชื่อมต่อและจำนวนรายการ โดยไม่แก้ข้อมูล
```

หากแก้ schema ให้ใช้ `npm run db:dev -- --name ชื่อการเปลี่ยนแปลง` กับฐานข้อมูลสำหรับพัฒนาแยกต่างหาก
ตรวจ SQL แล้ว commit โฟลเดอร์ migration ไปด้วย ส่วน production ใช้ `db:migrate` เท่านั้น
ไม่ใช้ `migrate reset` หรือ `db push` แทน migration บนฐานข้อมูลจริง

## ความทนทานและประสิทธิภาพ

- บันทึกเจตนาการย้ายโฟลเดอร์ใน `.operations/` ก่อนย้ายไฟล์ แล้วกู้ตำแหน่งให้ตรงกับ PostgreSQL เมื่อเริ่มเซิร์ฟเวอร์ใหม่ หากสถานะกำกวมจะหยุดเพื่อรักษาไฟล์ไว้ตรวจสอบ
- ย้าย path ของไฟล์แนบทั้งงานด้วย SQL แบบมี parameter ในคำสั่งเดียว แทนการส่งคำสั่งทีละไฟล์
- ล้างเฉพาะไฟล์ `<uuid>.partial` ที่แอปทิ้งไว้ใน `.uploading/` เมื่อเริ่มทำงาน รองรับเซิร์ฟเวอร์หนึ่ง instance ต่อดิสก์
- รับอัปโหลดพร้อมกันสูงสุด 2 ไฟล์ ตรวจพื้นที่ดิสก์ และคืน 429 พร้อม `Retry-After` เมื่อมีงานเต็ม หรือ 507 เมื่อพื้นที่ไม่พอ
- เมื่อได้รับ SIGTERM/SIGINT จะหยุดรับงานใหม่ ยกเลิกสตรีมอัปโหลดที่ยังไม่จบ และรอคำขอที่เหลือก่อนปิด โดยมีเวลาสูงสุด 25 วินาที
- หน้าเว็บไม่รับ snapshot เก่ามาทับข้อมูลที่เพิ่งบันทึก มี timeout สำหรับคำขอ และไม่ retry การเขียนอัตโนมัติเมื่อผลลัพธ์ไม่แน่นอน
- แสดงงานครั้งละ 48 รายการ กดแสดงเพิ่มได้ โดยการค้นหา ตัวนับ และ CSV ยังครอบคลุมรายการทั้งหมด
- โหลด metadata เฉพาะวิดีโอที่เลือกในแต่ละการ์ด และ cache ไฟล์ JS/CSS ที่มี hash โดยหน้าเว็บและ API ยังคง `no-store`

ฐานข้อมูลกับ filesystem ไม่ใช่ transaction เดียวกัน การกู้คืนช่วยแก้กรณีโปรเซสหยุดระหว่างย้ายร้าน แต่ยังต้องสำรองทั้งสองส่วน
หากเซิร์ฟเวอร์หยุดหลังย้ายไฟล์อัปโหลดสำเร็จแต่ก่อน commit metadata อาจมีไฟล์ที่ไม่ถูกอ้างอิงเหลือบนดิสก์ ซึ่งจะไม่ถูกนำมาลบอัตโนมัติ

## Deploy บน Render

ใช้ Web Service (Node.js) พร้อม Persistent Disk หรือ Blueprint จาก `render.yaml`

| ค่า                        | ตั้งเป็น                                |
| -------------------------- | --------------------------------------- |
| Node.js                    | 24 ตาม `package.json`                   |
| Region                     | Singapore (`singapore`)                 |
| Build Command              | `npm ci --include=dev && npm run check` |
| Pre-Deploy Command         | `npm run db:migrate`                    |
| Start Command              | `npm start`                             |
| Health Check Path          | `/api/health`                           |
| Persistent Disk mount path | `/var/data`                             |

กรอก `DATABASE_URL` และ `DIRECT_URL` จาก `.env` ใน Environment ของบริการ Render
Blueprint กำหนดสองค่านี้เป็น `sync: false` เพื่อให้กรอกความลับนอก Git
บัญชีเข้าเว็บยังใช้ `super6` / `1234` ตามค่าเริ่มต้นที่กำหนด
Blueprint เลือกแพ็กเกจ `starter` และ disk 10 GB ปรับตามการใช้งานได้
กำหนด Singapore สำหรับบริการใหม่ให้ใกล้ Supabase `ap-southeast-1`; Render ไม่รองรับการเปลี่ยน region ของบริการเดิมโดยตรง

ข้อมูล PostgreSQL อยู่ใน Supabase และคงอยู่ข้าม redeploy ของ Render
ไฟล์แนบยังต้องใช้ Persistent Disk ที่ `/var/data` และแอปหนึ่ง instance ที่ผูกกับ disk นั้น
การเชื่อม PostgreSQL ครั้งนี้ไม่ได้ย้ายไฟล์ไป Supabase Storage

## ย้ายข้อมูลเดิมจาก SQLite

ถ้ามี `studio.sqlite` เดิม ให้หยุดแอปและสำรอง SQLite พร้อม `uploads/` ก่อนสลับเวอร์ชัน
สร้างตาราง PostgreSQL ด้วย `npm run db:migrate` จากนั้นรัน:

```sh
npm run db:import-sqlite -- /var/data/supersix-studio/studio.sqlite
```

คำสั่งอ่าน SQLite แบบ read-only และนำเข้ารายการงาน ไฟล์แนบ การตั้งค่า รวมถึงถังพักใน transaction เดียว
รักษา ID, เวลา และ relative path เดิม ไม่แก้หรือลบไฟล์ SQLite และไม่อัปโหลดไฟล์รูป/วิดีโอ
ปลายทางต้องไม่มีข้อมูล หากมีข้อมูลแล้วจะหยุดโดยไม่เขียนทับ
ต้องเก็บ `uploads/` เดิมไว้ใต้ตำแหน่ง storage เดียวกัน แล้วค่อยเปิดแอป

## สำรองข้อมูล

สำรอง PostgreSQL schema `supersix` และโฟลเดอร์ `uploads/` ให้เป็นชุดเดียวกัน
เก็บ `.operations/` ไปด้วยหากมีรายการที่ยังไม่เสร็จ อย่าลบบันทึกกู้คืนด้วยตนเองขณะที่กำลังตรวจปัญหา
หยุดการเขียนระหว่างสำรองเพื่อให้ metadata ตรงกับไฟล์ รูป/วิดีโอไม่รวมอยู่ใน backup ของ Supabase
การส่งออก CSV เก็บเฉพาะตารางงาน และการย้ายรายการไปถังพักยังใช้พื้นที่ไฟล์บนดิสก์

## ฟังก์ชัน

- แยก 3 ร้าน เพิ่มงาน ผู้สั่ง บรีฟ วันทำ/ส่ง และจำนวนชิ้นงาน
- แนบรูป/วิดีโอหลายไฟล์ อัปโหลดแบบ streaming และดาวน์โหลดต้นฉบับ
- ตรวจวันอัปเดตตามเวลาประเทศไทย แยกงานเสร็จกับโพสต์ Facebook
- รอบ Reel วันเว้นวัน ค้นหา กรอง คลังงาน ถังพัก/กู้คืน และส่งออก CSV
- สถานะ Facebook บันทึกด้วยตนเอง ไม่มีการโพสต์หรืออ่านเพจอัตโนมัติ

## ตรวจโค้ด

```sh
npm run format
npm run check
npm test
```

`npm run check` ตรวจ format, ESLint (ไม่ยอมให้มี warning), TypeScript และ build production ตามลำดับ
Render ใช้คำสั่งนี้ระหว่าง build และจะหยุด deploy หากขั้นใดไม่ผ่าน
รันแยกได้ด้วย `npm run format:check`, `npm run lint`, `npm run lint:fix` และ `npm run build`
ตัวตรวจไม่แตะ `.env`, ไฟล์ generated, ไฟล์อัปโหลด และ migration SQL ที่ใช้งานไปแล้ว

ชุด integration test ใช้ PostgreSQL จริงจาก `.env` สร้าง schema ชั่วคราวชื่อ `supersix_test_<uuid>`
ใช้ migrations จาก repository และลบเฉพาะ schema ที่ตัวทดสอบสร้าง พร้อมล้างไฟล์ชั่วคราว
ไม่ reset หรือเขียนข้อมูลทดสอบใน schema `supersix` หากไม่มี connection การทดสอบจะล้มเหลว ไม่ข้ามเงียบ ๆ

## เอกสารอ้างอิง

- [Supabase กับ Prisma](https://supabase.com/docs/guides/database/prisma)
- [Prisma ORM 7](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)
- [Supabase TLS](https://supabase.com/docs/guides/platform/ssl-enforcement)
- [Render Web Services](https://render.com/docs/web-services)
- [Render Persistent Disks](https://render.com/docs/disks)
- [Render Regions](https://render.com/docs/regions)
