export const ROLE_PERMISSIONS = Object.freeze({
  organization_admin: ["*"],
  program_manager: [
    "repository.read", "program.create", "configuration.write", "certification.edit", "certification.snapshot",
    "program.control", "document.import", "document.edit", "document.checkout", "document.checkin",
    "document.review", "document.release", "baseline.create", "build.run", "intake.write",
    "integration.manage", "operations.view",
  ],
  contributor: [
    "repository.read", "configuration.write", "document.import", "document.edit", "document.checkout",
    "document.checkin", "build.run", "intake.write",
  ],
  reviewer: ["repository.read", "certification.edit", "document.checkout", "document.checkin", "document.review"],
  approver: ["repository.read", "certification.edit", "certification.snapshot", "document.review", "document.release", "baseline.create"],
  read_only: ["repository.read"],
  service_account: ["*"],
});

export function hasPermission(role, permission) {
  const permissions = ROLE_PERMISSIONS[String(role || "")] || [];
  return permissions.includes("*") || permissions.includes(permission);
}

export function requestActor(req, fallback = "") {
  if (req?.auth?.mode === "oidc") return String(req.auth.displayName || req.auth.email || req.auth.subject || "").trim();
  return String(fallback || "").trim();
}
