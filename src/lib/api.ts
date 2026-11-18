/** API requests use the same origin as this application. */
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const isForm = body instanceof FormData;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? (isForm ? 30 * 60 * 1000 : 30000));
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal,
      ...(body === undefined
        ? {}
        : {
            headers: isForm ? {} : { "Content-Type": "application/json" },
            body: isForm ? body : JSON.stringify(body),
          }),
    });
    const data: unknown = response.status === 204 ? {} : await response.json().catch(() => null);
    if (!response.ok || !data || typeof data !== "object") {
      const message =
        data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : "ไม่สามารถอ่านข้อมูลจากโปรแกรมได้ กรุณาโหลดข้อมูลล่าสุดแล้วลองอีกครั้ง";
      const error = new Error(message) as Error & { status: number };
      error.status = response.status;
      throw error;
    }
    return data as T;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (timeout.aborted)
      throw new Error("คำขอใช้เวลานานเกินไป กรุณาโหลดข้อมูลล่าสุดก่อนลองอีกครั้ง", {
        cause: error,
      });
    if (error instanceof Error && "status" in error) throw error;
    throw new Error("เชื่อมต่อ Supersix Studio ไม่ได้ ตรวจการเชื่อมต่อแล้วลองอีกครั้ง", {
      cause: error,
    });
  }
}
