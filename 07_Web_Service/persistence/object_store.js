import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

export class ObjectStoreError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "ObjectStoreError";
    this.status = status;
  }
}

export function assertObjectStore(store) {
  for (const method of ["put", "get"]) {
    if (typeof store?.[method] !== "function") {
      throw new TypeError(`Object store must implement ${method}().`);
    }
  }
  return store;
}

export class FileObjectStore {
  constructor(root) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, {recursive: true});
  }

  put(bytes) {
    if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
    const hash = sha256(bytes);
    const file = path.join(this.root, hash);
    try {
      fs.writeFileSync(file, bytes, {flag: "wx", mode: 0o600});
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (sha256(fs.readFileSync(file)) !== hash) {
        throw new ObjectStoreError("Repository file integrity check failed.");
      }
    }
    return {hash, size: bytes.length};
  }

  get(hash) {
    if (!/^[a-f0-9]{64}$/.test(String(hash))) {
      throw new ObjectStoreError("Invalid file reference.", 400);
    }
    let bytes;
    try {
      bytes = fs.readFileSync(path.join(this.root, hash));
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new ObjectStoreError("Repository file not found.", 404);
      }
      throw error;
    }
    if (sha256(bytes) !== hash) {
      throw new ObjectStoreError("Repository file integrity check failed. Restore a verified backup.");
    }
    return bytes;
  }
}
