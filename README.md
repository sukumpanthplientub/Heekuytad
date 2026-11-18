# Supersix Studio — Source code

ระบบจัดการงานกราฟิกส่วนตัวของ Supersix Shop, เติมเกมกับเฟิร์น และ G-station
ใช้ React + Vite, Node.js 24, Express, SQLite และเก็บรูป/วิดีโอเป็นไฟล์จริง

ชุดนี้เป็น source code พร้อมตั้งค่า Render ไม่มี `node_modules`, `dist`, ฐานข้อมูลผู้ใช้ หรือไฟล์อัปโหลดจริง

## Deploy บน Render

ใช้ **Web Service (Node.js)** พร้อม **Persistent Disk** หรือสร้าง Blueprint จาก `render.yaml`
ให้นำไฟล์ภายในโฟลเดอร์ `supersix-studio-source` ขึ้นเป็น root ของ Git repository

| ค่า                        | ตั้งเป็น                                |
| -------------------------- | --------------------------------------- |
| Node.js                    | 24                                      |
| Build Command              | `npm ci --include=dev && npm run build` |
| Start Command              | `npm start`                             |
| Health Check Path          | `/api/health`                           |
| Persistent Disk mount path | `/var/data`                             |
| `APP_MODE`                 | `hosted`                                |
| `APP_USERNAME`             | `super6` หรือชื่อที่คุณเลือก            |
| `APP_PASSWORD`             | รหัสผ่านส่วนตัวอย่างน้อย 16 ตัวอักษร    |
| `STORAGE_PATH`             | `/var/data/supersix-studio`             |
| `MAX_UPLOAD_MB`            | `500`                                   |

Render กำหนด `PORT` และ `RENDER_EXTERNAL_URL` ให้อัตโนมัติ แอปใช้ `0.0.0.0:$PORT`
ถ้าใช้โดเมนของตัวเอง ให้เพิ่ม `PUBLIC_URL=https://ชื่อโดเมนของคุณ`

Blueprint ตัวอย่างเลือกแพ็กเกจ `starter` และ disk 10 GB ซึ่งมีค่าใช้จ่ายบน Render
ปรับแพ็กเกจและขนาด disk ก่อน deploy ตามต้องการ ชุดโค้ดนี้ไม่ได้สร้างบริการหรือเรียกเก็บเงินให้คุณ

### เข้าใช้งานส่วนตัว

เมื่อเปิดเว็บ เบราว์เซอร์ถาม username/password ด้วย HTTP Basic Authentication
ใช้ค่าจาก `APP_USERNAME` และ `APP_PASSWORD` ใน Environment ของ Render
ถ้าใช้ Blueprint ระบบ Render จะสร้าง `APP_PASSWORD` แบบสุ่มให้ ดูค่าจากหน้า Environment ของบริการ
ถ้าไม่ได้ตั้งรหัสผ่านที่ยาวพอในโหมด hosted แอปจะไม่เริ่มทำงาน
Health check เปิดให้ตรวจสถานะ ส่วนหน้าเว็บ API และไฟล์แนบต้องเข้าสู่ระบบ

## ตำแหน่งไฟล์บนเซิร์ฟเวอร์

| ข้อมูล               | ตำแหน่ง                                                           |
| -------------------- | ----------------------------------------------------------------- |
| รายการงาน/การตั้งค่า | `/var/data/supersix-studio/studio.sqlite`                         |
| รูป                  | `/var/data/supersix-studio/uploads/<ร้าน>/<ปี>/<รหัสงาน>/images/` |
| วิดีโอ               | `/var/data/supersix-studio/uploads/<ร้าน>/<ปี>/<รหัสงาน>/videos/` |

ชื่อโฟลเดอร์ร้านคือ `supersix-shop`, `fern`, `g-station` ปีอ้างอิงปีที่สร้างงาน
ไฟล์ชื่อซ้ำไม่ทับกัน การลบในแอปย้ายรายการไปถังพักและกู้คืนได้ โดยไฟล์ยังอยู่และยังใช้พื้นที่ disk

**เมื่อ deploy บน Render ไฟล์จะอยู่บนเซิร์ฟเวอร์ Render** ดาวน์โหลดต้นฉบับกลับมาได้จากแต่ละงาน
แอปบนเซิร์ฟเวอร์จะไม่สร้างโฟลเดอร์ในคอมพิวเตอร์ส่วนตัวและไม่เรียก Windows File Explorer

ต้องแนบ Persistent Disk และให้ `STORAGE_PATH` อยู่ภายใน mount path จึงจะเก็บข้อมูลข้าม restart/redeploy ได้
พื้นที่ไฟล์ปกติของ Render เป็น ephemeral และ persistent disk รองรับบนบริการแบบชำระเงิน
SQLite ชุดนี้ออกแบบสำหรับแอปส่วนตัวหนึ่ง instance ที่ใช้ disk เดียว
สำรองฐานข้อมูลพร้อม `uploads` ทั้งชุด และหยุดแอปก่อนคัดลอกฐานข้อมูลโดยตรง

## ฟังก์ชัน

- แยก 3 ร้าน เพิ่มงาน ผู้สั่ง บรีฟ วันทำ/ส่ง และจำนวนชิ้นงานที่เลือกใส่ได้
- แนบหลายรูป/วิดีโอ แสดงตัวอย่างใหญ่ และบันทึกไฟล์แบบ streaming
- ตรวจวันอัปเดตตามเวลาประเทศไทย แยกงานเสร็จกับโพสต์ Facebook
- รอบ Reel วันเว้นวัน ไม่กำหนดจำนวนคลิปต่อวัน
- ค้นหา กรองงาน คลังงาน ถังพัก/กู้คืน และส่งออก CSV
- สถานะ Facebook บันทึกด้วยตนเอง ไม่มีการโพสต์หรืออ่านเพจอัตโนมัติ

## โครงสร้างโค้ด

| ตำแหน่ง                | หน้าที่                       |
| ---------------------- | ----------------------------- |
| `src/studio.tsx`       | หน้าหลัก                      |
| `src/job-card.tsx`     | การ์ดงานและไฟล์แนบ            |
| `src/local-panels.tsx` | การจัดเก็บไฟล์และถังพัก       |
| `src/globals.css`      | รูปแบบและสี                   |
| `server/api.mjs`       | API งานและไฟล์                |
| `server/storage.mjs`   | SQLite และโฟลเดอร์            |
| `server/security.mjs`  | การเข้าสู่ระบบและตรวจ request |
| `render.yaml`          | Blueprint สำหรับ Render       |

## ตรวจโค้ด

```sh
npm ci --include=dev
npm run build
npm test
```

การทดสอบสร้างฐานข้อมูลและไฟล์ในโฟลเดอร์ชั่วคราว และปิดเซิร์ฟเวอร์ทดสอบเอง
วิดีโอบาง codec อาจเล่นในเบราว์เซอร์ไม่ได้ แต่ดาวน์โหลดต้นฉบับได้

## เอกสารอ้างอิง

- [Render Web Services](https://render.com/docs/web-services)
- [Persistent Disks](https://render.com/docs/disks)
- [Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render environment variables](https://render.com/docs/environment-variables)
