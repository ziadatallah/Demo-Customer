export const CONNECTOR_PROFILES = Object.freeze({
  doors_next: {label:"IBM Engineering DOORS Next",category:"requirements",discoveryPath:"/rootservices",auth:"oauth-or-bearer",contentTypes:["application/rdf+xml","application/json"],capabilities:["requirements","traceability","change-sets"]},
  jama_connect: {label:"Jama Connect",category:"requirements",discoveryPath:"/rest/latest/projects",auth:"oauth-or-basic",contentTypes:["application/json"],capabilities:["requirements","relationships","reviews"]},
  polarion: {label:"Siemens Polarion ALM",category:"requirements",discoveryPath:"/polarion/rest/v1/projects",auth:"bearer-or-personal-token",contentTypes:["application/json"],capabilities:["work-items","relationships","baselines"]},
  github_enterprise: {label:"GitHub Enterprise",category:"source-control",discoveryPath:"/api/v3/user/repos",auth:"bearer",contentTypes:["application/vnd.github+json"],capabilities:["repositories","commits","pull-requests","workflow-evidence"]},
  gitlab: {label:"GitLab",category:"source-control",discoveryPath:"/api/v4/projects?membership=true",auth:"private-token-or-bearer",contentTypes:["application/json"],capabilities:["projects","commits","merge-requests","pipeline-evidence"]},
  azure_devops: {label:"Azure DevOps",category:"source-control",discoveryPath:"/_apis/projects?api-version=7.1",auth:"bearer-or-pat",contentTypes:["application/json"],capabilities:["projects","repositories","work-items","pipeline-evidence"]},
  generic_plm: {label:"Configurable PLM adapter",category:"plm",discoveryPath:"/api/projects",auth:"bearer-or-basic",contentTypes:["application/json"],capabilities:["parts","documents","revisions","change-control"]},
});

export function connectorProfile(type) {
  const profile=CONNECTOR_PROFILES[String(type||"")];
  if(!profile)throw Object.assign(new Error(`Unsupported connector type: ${type}`),{status:400});
  return {type,...profile};
}
