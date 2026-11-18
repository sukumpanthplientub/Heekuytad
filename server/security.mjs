import { createHash, timingSafeEqual } from "node:crypto";

// Authenticate the page, APIs and every media request on hosted deployments.
// Origin checks also cover browser-cached HTTP Basic credentials.
export function localRequestGuard({
  port,
  dev = false,
  hosted = false,
  publicOrigin = "",
  appUsername = "super6",
  appPassword = "",
}) {
  if (hosted && (!publicOrigin || appPassword.length < 16))
    throw new Error("Hosted requests require a public origin and APP_PASSWORD");
  const hosts = hosted
    ? new Set([new URL(publicOrigin).host.toLowerCase()])
    : new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = hosted
    ? new Set([publicOrigin])
    : new Set([...hosts].map((host) => `http://${host}`));
  const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
  const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
  const digest = (text) => createHash("sha256").update(text).digest();
  const expectedCredential = digest(`${appUsername}:${appPassword}`);

  return (req, res, next) => {
    const reject = (message) => res.status(403).json({ error: message });
    const requestPath = req.path.toLowerCase();
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        `script-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "font-src 'self'",
        `connect-src 'self'${dev ? ` ws://127.0.0.1:${port} ws://localhost:${port}` : ""}`,
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ].join("; "),
    );

    // Render health checks can use an internal Host. This route exposes only
    // readiness, never jobs, paths, files or credentials.
    if (hosted && requestPath === "/api/health" && ["GET", "HEAD"].includes(req.method)) {
      res.setHeader("Cache-Control", "no-store");
      return next();
    }
    if (!hosted && !loopbackAddresses.has(req.socket.remoteAddress))
      return reject("โปรแกรมนี้เปิดให้ใช้งานเฉพาะภายในเครื่อง");
    if (!hosts.has(String(req.headers.host || "").toLowerCase()))
      return reject("เปิดโปรแกรมจาก URL ที่ตั้งค่าไว้");

    if (hosted) {
      const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(String(req.headers.authorization || ""));
      const valid =
        match && timingSafeEqual(expectedCredential, digest(Buffer.from(match[1], "base64")));
      if (!valid) {
        res.setHeader("WWW-Authenticate", 'Basic realm="Supersix Studio", charset="UTF-8"');
        res.setHeader("Cache-Control", "no-store");
        return res.status(401).json({ error: "กรุณาเข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่านของแอป" });
      }
      res.setHeader("Cache-Control", "private, no-store");
    }
    if (requestPath === "/api" || requestPath.startsWith("/api/")) {
      res.setHeader("Cache-Control", "private, no-store");
      const origin = req.headers.origin;
      if ((origin && !origins.has(origin)) || req.headers["sec-fetch-site"] === "cross-site")
        return reject("คำขอนี้ไม่ได้มาจากหน้า Supersix Studio ของคุณ");
      if (!safeMethods.has(req.method) && !origins.has(origin))
        return reject("เปิดหน้า Supersix Studio แล้วลองบันทึกอีกครั้ง");
    }
    next();
  };
}
