import crypto from "node:crypto";
import {ObjectStoreError, sha256} from "./object_store.js";

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const encoder = new TextEncoder();
const hmac = (key, value, encoding) => crypto.createHmac("sha256", key).update(value).digest(encoding);
const digestHex = value => crypto.createHash("sha256").update(value).digest("hex");
const encodePath = value => String(value).split("/").map(encodeURIComponent).join("/");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function required(value, name) {
  const result = String(value || "").trim();
  if (!result) throw new ObjectStoreError(`${name} is required for S3-compatible storage.`, 500);
  return result;
}

function amzTimestamp(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signingKey(secret, date, region) {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

export class S3ObjectStore {
  constructor({
    endpoint, bucket, region = "us-east-1", accessKeyId, secretAccessKey,
    sessionToken = "", prefix = "isaf/objects", fetchImpl = globalThis.fetch,
    maxAttempts = 3, retryBaseMs = 50, clock = () => new Date(), sleeper = sleep,
  } = {}) {
    this.endpoint = new URL(required(endpoint, "S3 endpoint"));
    this.bucket = required(bucket, "S3 bucket");
    this.region = required(region, "S3 region");
    this.accessKeyId = required(accessKeyId, "S3 access key ID");
    this.secretAccessKey = required(secretAccessKey, "S3 secret access key");
    this.sessionToken = String(sessionToken || "");
    this.prefix = String(prefix || "").replace(/^\/+|\/+$/g, "");
    if (typeof fetchImpl !== "function") throw new ObjectStoreError("A fetch implementation is required for S3-compatible storage.");
    this.fetch = fetchImpl;
    this.maxAttempts = Math.max(1, Math.min(8, Number(maxAttempts) || 3));
    this.retryBaseMs = Math.max(0, Number(retryBaseMs) || 0);
    this.clock = clock;
    this.sleeper = sleeper;
  }

  key(hash) { return [this.prefix, hash].filter(Boolean).join("/"); }

  url(key) {
    const base = this.endpoint.href.replace(/\/$/, "");
    return new URL(`${base}/${encodeURIComponent(this.bucket)}/${encodePath(key)}`);
  }

  signedRequest(method, key, bytes = Buffer.alloc(0), extraHeaders = {}) {
    const url = this.url(key);
    const time = this.clock();
    const stamp = amzTimestamp(time);
    const shortDate = stamp.slice(0, 8);
    const payloadHash = sha256(bytes);
    const headers = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": stamp,
      ...Object.fromEntries(Object.entries(extraHeaders).map(([name, value]) => [name.toLowerCase(), String(value).trim()])),
    };
    if (this.sessionToken) headers["x-amz-security-token"] = this.sessionToken;
    const names = Object.keys(headers).sort();
    const canonicalHeaders = names.map(name => `${name}:${headers[name].replace(/\s+/g, " ")}\n`).join("");
    const signedHeaders = names.join(";");
    const canonical = [method, url.pathname, url.searchParams.toString(), canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${shortDate}/${this.region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${digestHex(canonical)}`;
    const signature = hmac(signingKey(this.secretAccessKey, shortDate, this.region), stringToSign, "hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    delete headers.host;
    return {url, headers};
  }

  async request(method, key, bytes = Buffer.alloc(0), headers = {}) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const signed = this.signedRequest(method, key, bytes, headers);
        const response = await this.fetch(signed.url, {
          method, headers: signed.headers, body: method === "PUT" ? bytes : undefined,
        });
        if (!RETRYABLE.has(response.status) || attempt === this.maxAttempts) return response;
        lastError = new ObjectStoreError(`S3-compatible storage returned ${response.status}.`);
      } catch (error) {
        lastError = error;
        if (attempt === this.maxAttempts) throw new ObjectStoreError("S3-compatible storage is unavailable. Retry later.", 503);
      }
      await this.sleeper(this.retryBaseMs * 2 ** (attempt - 1));
    }
    throw lastError;
  }

  error(response, action) {
    if (response.status === 401 || response.status === 403) {
      return new ObjectStoreError(`S3-compatible storage denied ${action}. Check the configured storage permissions.`, 403);
    }
    if (response.status === 404) return new ObjectStoreError("Repository file not found.", 404);
    return new ObjectStoreError(`S3-compatible storage failed during ${action} (${response.status}).`, 502);
  }

  verifyMetadata(response, hash, size) {
    const storedHash = response.headers.get("x-amz-meta-sha256");
    const storedSize = Number(response.headers.get("content-length"));
    if (storedHash !== hash || (Number.isFinite(storedSize) && storedSize !== size)) {
      throw new ObjectStoreError("Repository file integrity metadata does not match the requested content.");
    }
  }

  async put(input) {
    const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
    const hash = sha256(bytes);
    const key = this.key(hash);
    const existing = await this.request("HEAD", key);
    if (existing.ok) {
      this.verifyMetadata(existing, hash, bytes.length);
      return {hash, size: bytes.length, storageKey: key};
    }
    if (existing.status !== 404) throw this.error(existing, "object lookup");
    const response = await this.request("PUT", key, bytes, {
      "content-type": "application/octet-stream",
      "if-none-match": "*",
      "x-amz-meta-sha256": hash,
    });
    if (response.status === 412) {
      const raced = await this.request("HEAD", key);
      if (!raced.ok) throw this.error(raced, "duplicate verification");
      this.verifyMetadata(raced, hash, bytes.length);
    } else if (!response.ok) {
      throw this.error(response, "object upload");
    }
    return {hash, size: bytes.length, storageKey: key};
  }

  async get(hash) {
    if (!/^[a-f0-9]{64}$/.test(String(hash))) throw new ObjectStoreError("Invalid file reference.", 400);
    const response = await this.request("GET", this.key(hash));
    if (!response.ok) throw this.error(response, "object download");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== hash) {
      throw new ObjectStoreError("Repository file integrity check failed. Restore a verified backup.");
    }
    return bytes;
  }
}

export function createS3ObjectStoreFromEnv(env = process.env, options = {}) {
  return new S3ObjectStore({
    endpoint: env.ISAF_S3_ENDPOINT,
    bucket: env.ISAF_S3_BUCKET,
    region: env.ISAF_S3_REGION || "us-east-1",
    accessKeyId: env.ISAF_S3_ACCESS_KEY_ID,
    secretAccessKey: env.ISAF_S3_SECRET_ACCESS_KEY,
    sessionToken: env.ISAF_S3_SESSION_TOKEN || "",
    prefix: env.ISAF_S3_PREFIX || "isaf/objects",
    ...options,
  });
}
