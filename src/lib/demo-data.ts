import { addDays, type Asset, type Job } from "./studio-types";

/** Illustrative records only. These are never persisted as the user's jobs. */
export function getDemoJobs(today: string): Job[] {
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const at = (day: string, time: string) => `${day}T${time}:00+07:00`;
  const asset = (jobId: string, key: string, name: string, day = today, time = "10:25"): Asset => ({
    id: `demo-asset-${key}`,
    jobId,
    name,
    mimeType: "image/svg+xml",
    size: DEMO_ASSET_SIZES[key] || 4096,
    kind: "image",
    url: `/demo/${key}.svg`,
    createdAt: at(day, time),
  });
  const base = (id: string): Job => ({
    id,
    store: "supersix",
    title: "",
    requester: "ทำเอง",
    brief: "",
    type: "image",
    plannedDate: today,
    dueDate: today,
    priority: "normal",
    quantity: null,
    workStatus: "todo",
    postStatus: "unposted",
    postUrl: "",
    postDate: "",
    postNote: "",
    referenceUrl: "",
    createdAt: at(yesterday, "09:00"),
    updatedAt: at(today, "09:00"),
    completedAt: null,
    archived: false,
    assets: [],
  });
  return [
    {
      ...base("demo-s6-heartopia"),
      title: "ภาพโปรโมชัน Heartopia",
      requester: "คุณ A (ตัวอย่าง)",
      brief:
        "ออกแบบภาพโปรโมชันโทนเขียวสบายตา เน้นชื่อเกมและบรรยากาศอบอุ่น ไฟล์แนบเป็นตัวอย่างแนวทางภาพ ไม่มีข้อมูลราคาจริง",
      priority: "high",
      quantity: 3,
      workStatus: "doing",
      updatedAt: at(today, "10:25"),
      assets: [asset("demo-s6-heartopia", "heartopia", "Heartopia-concept.svg")],
    },
    {
      ...base("demo-s6-reel"),
      title: "Reel · อีกมุมของเกมที่คุณรัก",
      brief:
        "วางไอเดียคอนเทนต์และภาพปกสำหรับรอบทำ Reel ไฟล์แนบเป็นภาพปกตัวอย่างเท่านั้น ยังไม่มีไฟล์วิดีโอ จำนวนคลิปเพิ่มได้ตามงานจริง",
      type: "reel",
      dueDate: tomorrow,
      workStatus: "doing",
      updatedAt: at(today, "11:10"),
      assets: [asset("demo-s6-reel", "reel-cover", "Reel-cover-concept.svg", today, "11:10")],
    },
    {
      ...base("demo-s6-whiteout"),
      title: "แบนเนอร์ Whiteout Survival",
      requester: "คุณ B (ตัวอย่าง)",
      brief:
        "ภาพแนวนอนโทนฟ้าเย็น ใช้บรรยากาศภูเขาและองค์ประกอบเรียบ อ่านชื่อเกมได้ชัดเจน ตัวอย่างนี้ทำเสร็จแล้วและยังรอโพสต์",
      quantity: 1,
      workStatus: "done",
      completedAt: at(today, "10:05"),
      updatedAt: at(today, "10:05"),
      postNote: "รอเลือกช่วงเวลาลงโพสต์",
      assets: [asset("demo-s6-whiteout", "whiteout", "Whiteout-concept.svg", today, "09:50")],
    },
    {
      ...base("demo-s6-kingshot"),
      title: "ภาพโปรโมชัน Kingshot รอบใหม่",
      requester: "คุณ C (ตัวอย่าง)",
      brief: "รับบรีฟไว้ก่อน รอรายละเอียดข้อความและรูปแพ็กที่จะใช้ ยังไม่ได้ระบุจำนวนภาพ",
      plannedDate: tomorrow,
      dueDate: tomorrow,
      updatedAt: at(today, "08:45"),
    },
    {
      ...base("demo-fern-palmon"),
      store: "fern",
      title: "ภาพ Palmon สำหรับหน้าเพจ",
      requester: "เฟิร์น (ตัวอย่าง)",
      brief:
        "คอนเซ็ปต์ภาพโทนลาเวนเดอร์ เน้นความนุ่มนวลและชื่อเกม ตัวอย่างสถานะงานที่ทำเสร็จและโพสต์แล้ว",
      plannedDate: yesterday,
      dueDate: yesterday,
      quantity: 1,
      workStatus: "done",
      postStatus: "posted",
      postDate: yesterday,
      postNote: "สถานะตัวอย่าง ไม่มีโพสต์ Facebook จริง",
      completedAt: at(yesterday, "15:20"),
      updatedAt: at(yesterday, "17:30"),
      assets: [asset("demo-fern-palmon", "palmon", "Palmon-concept.svg", yesterday, "15:20")],
    },
    {
      ...base("demo-gstation-brand"),
      store: "gstation",
      title: "ชุดภาพ G-station · Level up",
      requester: "คุณ D (ตัวอย่าง)",
      brief: "พัฒนาคอนเซ็ปต์ภาพสีน้ำเงินเข้มกับสีเขียวอ่อน สำหรับภาพหลักและภาพต่อเนื่องของร้าน",
      dueDate: tomorrow,
      quantity: 2,
      workStatus: "doing",
      updatedAt: at(today, "11:35"),
      assets: [asset("demo-gstation-brand", "gstation", "G-station-concept.svg", today, "11:35")],
    },
  ];
}

const DEMO_ASSET_SIZES: Record<string, number> = {
  heartopia: 3920,
  palmon: 3673,
  whiteout: 2950,
  gstation: 3141,
  "reel-cover": 3050,
};
