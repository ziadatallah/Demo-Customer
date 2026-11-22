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

// The name recorded with a register action. A verified identity wins over the name the browser sends:
// single sign-on, an Admin app account (v6.0.0), or the named user whose personal access key made the request. Otherwise (installed
// app with no key, or a company-wide key) the browser's User Information name is used.
export function requestActor(req, fallback = "") {
  if (req?.auth?.mode === "oidc") return String(req.auth.displayName || req.auth.email || req.auth.subject || "").trim();
  if (req?.auth?.mode === "account") return String(req.auth.displayName || "").trim();
  const keyUser = req?.auth?.mode === "api-key" ? String(req.auth.user?.name || "").trim() : "";
  if (keyUser) return keyUser;
  return String(fallback || "").trim();
}
