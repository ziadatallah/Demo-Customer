export function createEnvironmentSecretResolver(environment=process.env){
  return async reference=>{
    const ref=String(reference||"").trim();
    if(!/^env:[A-Z][A-Z0-9_]*$/.test(ref))throw Object.assign(new Error("Connector secret references must use env:VARIABLE_NAME."),{status:400});
    const value=environment[ref.slice(4)];
    if(!value)throw Object.assign(new Error(`Connector credential ${ref} is unavailable.`),{status:503});
    return value;
  };
}

export function authorizationHeaders(configuration,secret){
  const mode=String(configuration.authMode||"bearer").toLowerCase();
  if(mode==="private-token")return {"PRIVATE-TOKEN":secret};
  if(mode==="basic")return {Authorization:`Basic ${Buffer.from(secret).toString("base64")}`};
  return {Authorization:`Bearer ${secret}`};
}
