/**
 * Requirements tool connections (v5.3.29) — one place for every tool ISAF can read requirements from.
 *
 * Each tool (Jama Connect, Siemens Polarion today; DOORS Next later) supplies a client module; this module
 * holds what they share: the list of tools and the sign-in fields each one needs, where a connection is kept,
 * and the rule that a secret entered by a customer is never sent back to a browser.
 *
 * Connections live outside the app folder (<admin data>/ISAF_Tool_Connections.json, readable by its owner only)
 * so replacing the app on an update does not lose them, and environment variables override the file, which is
 * what a hosted site should use since its disk is temporary.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createJamaClient, normalizeBaseUrl as jamaUrl } from "./jama.js";
import { createPolarionClient, normalizeBaseUrl as polarionUrl } from "./polarion.js";

const text = (v, max = 400) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

/**
 * The tools a customer can connect. `fields` is what the person has to enter; `secret: true` means it is kept
 * by the server and never shown again. `environment` names the variables a server may set instead.
 */
export const TOOLS = {
  jama: {
    id: "jama", label: "Jama Connect", vendor: "Jama Software",
    addressExample: "https://yourcompany.jamacloud.com/rest/v1",
    addressHelp: "Jama Cloud uses https://<company>.jamacloud.com/rest/v1. A Jama you host yourself often uses https://<host>/contour/rest/v1.",
    modes: [
      { id: "oauth", label: "API client ID and secret (recommended)", fields: [
        { key: "clientId", label: "Client ID" },
        { key: "clientSecret", label: "Client secret", secret: true, help: "Jama shows it once, when the API client is created." },
      ] },
      { id: "basic", label: "User name and password", help: "Jama refuses these on sites with single sign-on.", fields: [
        { key: "username", label: "User name" },
        { key: "password", label: "Password", secret: true },
      ] },
    ],
    environment: ["ISAF_JAMA_URL", "ISAF_JAMA_CLIENT_ID", "ISAF_JAMA_CLIENT_SECRET", "ISAF_JAMA_USERNAME", "ISAF_JAMA_PASSWORD"],
    normalizeUrl: jamaUrl, make: createJamaClient,
    groupLabel: "Item type", groupHelp: "Choose the Jama item types that hold requirements or verification cases. Folders and sets can be left out.",
  },
  polarion: {
    id: "polarion", label: "Polarion", vendor: "Siemens",
    addressExample: "https://polarion.yourcompany.com/polarion/rest/v1",
    addressHelp: "Polarion is usually hosted by the customer: the address is the Polarion site followed by /polarion/rest/v1.",
    modes: [
      { id: "token", label: "Personal access token", fields: [
        { key: "token", label: "Personal access token", secret: true, help: "Created in Polarion under My Account → Personal Access Tokens. It expires, so note the renewal date." },
      ] },
    ],
    environment: ["ISAF_POLARION_URL", "ISAF_POLARION_TOKEN"],
    normalizeUrl: polarionUrl, make: createPolarionClient,
    groupLabel: "Work item type", groupHelp: "Choose the Polarion work item types that hold requirements or test cases. ISAF finds the types by reading a sample of the project.",
  },
};

export const toolOrFail = id => {
  const tool = TOOLS[String(id || "").toLowerCase()];
  if (!tool) throw Object.assign(new Error("ISAF has no connector for that tool yet."), { status: 404 });
  return tool;
};

/** What a browser may see: everything except the secrets. */
const safe = c => ({
  id: c.id, tool: c.tool, name: c.name, baseUrl: c.baseUrl, mode: c.mode,
  values: Object.fromEntries(Object.entries(c.values || {}).filter(([k]) => !isSecret(c, k))),
  hasSecret: Object.entries(c.values || {}).some(([k, v]) => isSecret(c, k) && v),
  savedAt: c.savedAt, lastTest: c.lastTest || null, fromEnvironment: c.fromEnvironment === true,
});
const modeOf = (tool, id) => tool.modes.find(m => m.id === id) || tool.modes[0];
const isSecret = (c, key) => {
  const tool = TOOLS[c.tool]; if (!tool) return true;           // unknown tool: treat everything as a secret
  return modeOf(tool, c.mode).fields.some(f => f.key === key && f.secret);
};

export function createConnectionStore(file, { environment = process.env } = {}) {
  const read = () => { try { const raw = JSON.parse(fs.readFileSync(file, "utf8")); return Array.isArray(raw.connections) ? raw.connections : []; } catch { return []; } };
  const write = list => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ connections: list }, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
    return list;
  };

  /** A connection a server supplies through environment variables, which beats anything in the file. */
  const fromEnvironment = toolId => {
    const tool = TOOLS[toolId];
    const baseUrl = environment[`ISAF_${toolId.toUpperCase()}_URL`];
    if (!tool || !baseUrl) return null;
    const read = key => environment[`ISAF_${toolId.toUpperCase()}_${key.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`] || "";
    const mode = tool.modes.find(m => m.fields.every(f => read(f.key))) || tool.modes[0];
    return {
      id: `${toolId}-environment`, tool: toolId, name: `${tool.label} (set on the server)`, baseUrl, mode: mode.id,
      values: Object.fromEntries(mode.fields.map(f => [f.key, read(f.key)])),
      savedAt: "", fromEnvironment: true,
    };
  };

  return {
    file,
    tools: () => Object.values(TOOLS).map(t => ({
      id: t.id, label: t.label, vendor: t.vendor, addressExample: t.addressExample, addressHelp: t.addressHelp,
      groupLabel: t.groupLabel, groupHelp: t.groupHelp, environment: t.environment,
      modes: t.modes.map(m => ({ id: m.id, label: m.label, help: m.help || "", fields: m.fields.map(f => ({ key: f.key, label: f.label, secret: f.secret === true, help: f.help || "" })) })),
    })),
    list(toolId) {
      const all = [...Object.keys(TOOLS).map(fromEnvironment).filter(Boolean), ...read()];
      return all.filter(c => !toolId || c.tool === toolId).map(safe);
    },
    get(id) {
      const environmentConnection = Object.keys(TOOLS).map(fromEnvironment).filter(Boolean).find(c => c.id === id);
      if (environmentConnection) return environmentConnection;
      const found = read().find(c => c.id === id);
      if (!found) throw Object.assign(new Error("That connection is not set up on this server."), { status: 404 });
      return found;
    },
    save(input = {}) {
      const tool = toolOrFail(input.tool);
      const list = read();
      const id = /^[a-z0-9][a-z0-9._-]{1,63}$/i.test(String(input.id || "")) ? String(input.id) : `${tool.id}-${crypto.randomUUID().slice(0, 8)}`;
      const previous = list.find(c => c.id === id) || {};
      const mode = modeOf(tool, input.mode);
      // http is accepted only for a service on this computer (a developer's test service); the address decides.
      const allowHttp = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(String(input.baseUrl ?? "").trim());
      const given = input.values && typeof input.values === "object" ? input.values : {};
      const values = {};
      for (const field of mode.fields) {
        const sent = String(given[field.key] ?? "");
        // An empty secret means "keep the one already stored", so a person can edit a connection without
        // having to paste the secret again — Jama and Polarion both show it only once.
        values[field.key] = field.secret ? (sent || (previous.mode === mode.id ? previous.values?.[field.key] || "" : "")) : text(sent, 300);
      }
      const entry = {
        id, tool: tool.id, name: text(input.name, 120) || tool.label,
        baseUrl: tool.normalizeUrl(input.baseUrl, { allowHttp }), allowHttp, mode: mode.id, values,
        savedAt: new Date().toISOString(), lastTest: previous.lastTest || null,
      };
      write([...list.filter(c => c.id !== id), entry]);
      return safe(entry);
    },
    remove(id) {
      const list = read();
      if (!list.some(c => c.id === id)) throw Object.assign(new Error("That connection is not set up on this server."), { status: 404 });
      write(list.filter(c => c.id !== id));
      return { id, removed: true };
    },
    recordTest(id, result) {
      const list = read(); const entry = list.find(c => c.id === id);
      if (!entry) return result;
      entry.lastTest = { at: new Date().toISOString(), ok: result?.ok === true, projects: result?.projects ?? null };
      write(list);
      return result;
    },
    /** A ready client for one connection. */
    client(id, extras = {}) {
      const c = this.get(id);
      const tool = toolOrFail(c.tool);
      return tool.make({ baseUrl: c.baseUrl, allowHttp: c.allowHttp === true, auth: { mode: c.mode, ...c.values }, ...extras });
    },
  };
}
