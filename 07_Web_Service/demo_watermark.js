// Shared by the build engine (Demo edition) and the web service (optional DEMO
// watermark on exported documents). Operates on a PizZip DOCX instance.
// Add the diagonal Word watermark using the exact geometry and theme color from the
// approved Demo reference. Word dims header artwork outside header-editing mode.
// on every page (including first-page and odd/even variants), so this also
// covers multi-section documents without altering their body layout.
export function watermarkText(value){
  const text=String(value??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,40);
  return text||'DEMO';
}
export function addDemoWatermark(zip,text='DEMO'){
  const label=watermarkText(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const idPrefix='ISAF_DEMO_WATERMARK';
  for(const name of Object.keys(zip.files).filter(n=>/^word\/header\d+\.xml$/.test(n))){
    let xml=zip.file(name).asText();
    const referenceStyle=xml.includes('width:503.2pt;height:207.2pt;rotation:315')&&xml.includes('fillcolor="#1f497d [3215]"')&&xml.includes('PowerPlusWaterMarkObject')&&xml.includes('o:spid="_x0000_s')&&xml.includes('w14:anchorId=');
    if(referenceStyle&&!xml.includes(idPrefix))continue; // a watermark already designed into the master
    if(xml.includes(idPrefix))xml=xml.replace(/<w:p(?=[\s>])[^>]*>(?:(?!<w:p(?=[\s>]))[\s\S])*?<\/w:p>/g,p=>p.includes(idPrefix)?'':p);
    const root=xml.match(/<w:hdr\b[^>]*>/);
    if(!root)continue;
    let opening=root[0];
    for(const [prefix,uri] of Object.entries({
      v:'urn:schemas-microsoft-com:vml',
      o:'urn:schemas-microsoft-com:office:office',
      w10:'urn:schemas-microsoft-com:office:word',
      w14:'http://schemas.microsoft.com/office/word/2010/wordml',
    }))if(!new RegExp(`xmlns:${prefix}\\s*=`).test(opening))opening=opening.slice(0,-1)+` xmlns:${prefix}="${uri}">`;
    xml=xml.replace(root[0],opening);
    const index=Number((name.match(/header(\d+)/)||[])[1]||1);
    const maxSpid=[...xml.matchAll(/o:spid="_x0000_s(\d+)"/g)].reduce((max,match)=>Math.max(max,Number(match[1])),1024);
    const spid=maxSpid+1;
    const anchorId=`D3E0${String(index).padStart(4,'0')}`;
    const shapeId=900000000+index;
    const watermark=`<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:pict w14:anchorId="${anchorId}"><v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype><v:shape id="PowerPlusWaterMarkObject${shapeId}" o:spid="_x0000_s${spid}" type="#_x0000_t136" alt="${idPrefix}" style="position:absolute;margin-left:0;margin-top:0;width:503.2pt;height:207.2pt;rotation:315;z-index:-251640832;mso-wrap-edited:f;mso-width-percent:0;mso-height-percent:0;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin;mso-width-percent:0;mso-height-percent:0" o:allowincell="f" fillcolor="#1f497d [3215]" stroked="f"><v:textpath style="font-family:&quot;Cambria&quot;;font-size:1pt;font-weight:bold" string="${label}"/></v:shape></w:pict></w:r></w:p>`;
    xml=xml.replace('</w:hdr>',watermark+'</w:hdr>');
    zip.file(name,xml);
  }
}
