/** API requests use the same origin as this application. */
export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      ...(body === undefined
        ? {}
        : {
            headers: isForm ? {} : { "Content-Type": "application/json" },
            body: isForm ? body : JSON.stringify(body),
          }),
    });
  } catch {
    throw new Error("เชื่อมต่อ Supersix Studio ไม่ได้ ตรวจการเชื่อมต่อแล้วลองอีกครั้ง");
  }
  const data =
    response.status === 204
      ? {}
      : await response.json().catch(() => ({
          error: "ไม่สามารถอ่านข้อมูลจากโปรแกรมได้ กรุณาลองอีกครั้ง",
        }));
  if (!response.ok) {
    const error = new Error(
      typeof data.error === "string" ? data.error : "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง",
    ) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return data as T;
}
