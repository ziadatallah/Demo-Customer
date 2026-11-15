import {requireUuid} from "../persistence/postgres.js";

export class PostgresMembershipStore {
  constructor(metadata) {
    if (typeof metadata?.withTenant !== "function") throw new TypeError("Membership storage requires tenant transactions.");
    this.metadata = metadata;
  }

  async resolve(organizationId, subject) {
    requireUuid(organizationId, "Organization ID");
    subject = String(subject || "").trim();
    if (!subject) return null;
    return this.metadata.withTenant(organizationId, async client => {
      const result = await client.query(
        `SELECT u.id, u.subject, u.email, u.display_name AS "displayName", m.role
           FROM users u
           JOIN organization_memberships m ON m.user_id = u.id
          WHERE m.organization_id = $1 AND u.subject = $2
            AND u.status = 'active' AND m.status = 'active'`,
        [organizationId, subject],
      );
      return result.rows[0] || null;
    });
  }

  async list(organizationId) {
    requireUuid(organizationId, "Organization ID");
    return this.metadata.withTenant(organizationId, async client => {
      const result = await client.query(
        `SELECT u.id, u.subject, u.email, u.display_name AS "displayName", u.status,
                m.role, m.status, m.created_at AS "joinedAt", m.updated_at AS "updatedAt"
           FROM users u
           JOIN organization_memberships m ON m.user_id = u.id
          WHERE m.organization_id = $1
          ORDER BY lower(coalesce(u.display_name, u.email, u.subject))`,
        [organizationId],
      );
      return result.rows;
    });
  }

  async save(organizationId, input = {}) {
    requireUuid(organizationId, "Organization ID");
    const subject = String(input.subject || "").trim();
    const email = String(input.email || "").trim().toLowerCase();
    const displayName = String(input.displayName || "").trim();
    const role = String(input.role || "").trim();
    const allowed = new Set(["organization_admin", "program_manager", "contributor", "reviewer", "approver", "read_only", "service_account"]);
    if (!subject) throw Object.assign(new Error("Identity subject is required."), {status: 400});
    if (!email || !email.includes("@")) throw Object.assign(new Error("A valid email address is required."), {status: 400});
    if (!displayName) throw Object.assign(new Error("Display name is required."), {status: 400});
    if (!allowed.has(role)) throw Object.assign(new Error("Select a valid role."), {status: 400});
    return this.metadata.withTenant(organizationId, async client => {
      const user = await client.query(
        `INSERT INTO users (subject, email, display_name, status)
         VALUES ($1, NULLIF($2,''), NULLIF($3,''), 'active')
         ON CONFLICT (subject) DO UPDATE
           SET email=coalesce(NULLIF(EXCLUDED.email,''), users.email),
               display_name=coalesce(NULLIF(EXCLUDED.display_name,''), users.display_name),
               status='active', updated_at=now()
         RETURNING id, subject, email, display_name AS "displayName", status`,
        [subject, email, displayName],
      );
      await client.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role)
         VALUES ($1,$2,$3)
         ON CONFLICT (organization_id,user_id) DO UPDATE SET role=EXCLUDED.role, status='active', updated_at=now()`,
        [organizationId, user.rows[0].id, role],
      );
      return {...user.rows[0], role};
    });
  }

  async deactivate(organizationId, userId) {
    requireUuid(organizationId, "Organization ID");
    requireUuid(userId, "User ID");
    return this.metadata.withTenant(organizationId, async client => {
      const admins = await client.query(
        `SELECT count(*)::int AS count FROM organization_memberships m
          JOIN users u ON u.id=m.user_id
         WHERE m.organization_id=$1 AND m.role='organization_admin' AND u.status='active' AND m.status='active'`,
        [organizationId],
      );
      const selected = await client.query(
        `SELECT m.role FROM organization_memberships m WHERE m.organization_id=$1 AND m.user_id=$2`,
        [organizationId, userId],
      );
      if (!selected.rows[0]) throw Object.assign(new Error("Team member was not found."), {status: 404});
      if (selected.rows[0].role === "organization_admin" && admins.rows[0].count <= 1) {
        throw Object.assign(new Error("The last organization administrator cannot be deactivated."), {status: 409});
      }
      await client.query("UPDATE organization_memberships SET status='inactive', updated_at=now() WHERE organization_id=$1 AND user_id=$2", [organizationId,userId]);
      return {id: userId, status: "inactive"};
    });
  }
}
