import { createHash, timingSafeEqual } from "node:crypto";

// Authenticate the page, APIs and every media request on hosted deployments.
// Origin checks also cover browser-cached HTTP Basic credentials.
export function localRequestGuard({
  port,
  dev = false,
  hosted = false,
  appUsername = "super6",
  appPassword = "",
}) {
  if (hosted && !appPassword) throw new Error("Hosted requests require APP_PASSWORD");
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const localOrigins = new Set([...hosts].map((host) => `http://${host}`));
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
    const host = String(req.headers.host || "").toLowerCase();
    let origins = localOrigins;
    if (hosted) {
      // Use the request's domain, never client-supplied forwarding headers.
      // The production reverse proxy terminates HTTPS before forwarding to Node.
      let url;
      try {
        url = new URL(`https://${host}`);
      } catch {
        return reject("Invalid request host");
      }
      if (!host || /[\s\\/@?#]/.test(host) || url.username || url.password)
        return reject("Invalid request host");
      const localHttp =
        loopbackAddresses.has(req.socket.remoteAddress) &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      origins = new Set([url.origin]);
      if (localHttp) origins.add(new URL(`http://${host}`).origin);
    } else if (!hosts.has(host)) return reject("เปิดโปรแกรมจาก URL ที่ตั้งค่าไว้");

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
