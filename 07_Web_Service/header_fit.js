/**
 * Keep text in the fixed-height running-header identification cells on one line.
 *
 * The approved header uses exact row heights, so a value that wraps is clipped
 * (for example "ENGINEERING STANDARD", a long document number or program name).
 * This reduces the font size of an overflowing cell paragraph until it fits the
 * cell width (minimum 6 pt). Widths are Arial metrics (via Liberation Sans),
 * in 1/1000 em. Shared by the build engine and the web service revision stamp.
 */
const REG={" ":278,"!":278,"\"":355,"#":556,"$":556,"%":889,"&":667,"'":191,"(":333,")":333,"*":389,"+":584,",":278,"-":333,".":278,"/":278,"0":556,"1":556,"2":556,"3":556,"4":556,"5":556,"6":556,"7":556,"8":556,"9":556,":":278,";":278,"<":584,"=":584,">":584,"?":556,"@":1015,"A":667,"B":667,"C":722,"D":722,"E":667,"F":611,"G":778,"H":722,"I":278,"J":500,"K":667,"L":556,"M":833,"N":722,"O":778,"P":667,"Q":778,"R":722,"S":667,"T":611,"U":722,"V":667,"W":944,"X":667,"Y":667,"Z":611,"[":278,"\\":278,"]":278,"^":469,"_":556,"`":333,"a":556,"b":556,"c":500,"d":556,"e":556,"f":278,"g":556,"h":556,"i":222,"j":222,"k":500,"l":222,"m":833,"n":556,"o":556,"p":556,"q":556,"r":333,"s":500,"t":278,"u":556,"v":500,"w":722,"x":500,"y":500,"z":500,"{":334,"|":260,"}":334,"~":584};
const BOLD={" ":278,"!":333,"\"":474,"#":556,"$":556,"%":889,"&":722,"'":238,"(":333,")":333,"*":389,"+":584,",":278,"-":333,".":278,"/":278,"0":556,"1":556,"2":556,"3":556,"4":556,"5":556,"6":556,"7":556,"8":556,"9":556,":":333,";":333,"<":584,"=":584,">":584,"?":611,"@":975,"A":722,"B":722,"C":722,"D":722,"E":667,"F":611,"G":778,"H":722,"I":278,"J":556,"K":722,"L":611,"M":833,"N":722,"O":778,"P":667,"Q":778,"R":722,"S":667,"T":611,"U":722,"V":667,"W":944,"X":667,"Y":667,"Z":611,"[":333,"\\":278,"]":333,"^":584,"_":556,"`":333,"a":556,"b":611,"c":556,"d":611,"e":556,"f":333,"g":611,"h":611,"i":278,"j":278,"k":556,"l":278,"m":889,"n":611,"o":611,"p":611,"q":611,"r":389,"s":556,"t":333,"u":611,"v":556,"w":778,"x":556,"y":556,"z":500,"{":389,"|":280,"}":389,"~":584};
const MIN_HALF_POINTS=12;
const textWidth=(s,bold,halfPoints)=>{const t=bold?BOLD:REG;let w=0;for(const ch of s)w+=t[ch]??(bold?611:556);return w*halfPoints/2/1000*20;};  // twips
const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
export function fitHeaderCells(xml){
 const margins=/<w:tblCellMar>[\s\S]*?<\/w:tblCellMar>/.exec(xml)?.[0]||'';
 const side=n=>Number(new RegExp(`<w:(?:${n})\\b[^>]*w:w="(\\d+)"`).exec(margins)?.[1]||108);
 const pad=side('start|left')+side('end|right');
 return xml.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g,row=>{
  if(!/<w:trHeight\b[^>]*w:hRule="exact"/.test(row))return row;
  return row.replace(/<w:tc>[\s\S]*?<\/w:tc>/g,cell=>{
   if(/<w:drawing\b|<w:pict\b/.test(cell))return cell;
   const width=Number(/<w:tcW w:w="(\d+)"/.exec(cell)?.[1]||0)-pad-30;
   if(width<=0)return cell;
   return cell.replace(/<w:p\b[\s\S]*?<\/w:p>/g,p=>{
    const runs=[...p.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)];
    if(!runs.length)return p;
    // a paragraph may hold several lines separated by <w:br/>; fit the longest
    const lines=[[]];
    for(const r of runs){const parts=r[1].split(/<w:br\/>/);parts.forEach((part,i)=>{if(i)lines.push([]);const t=[...part.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(m=>decode(m[1])).join('');if(t)lines[lines.length-1].push({t,bold:/<w:b\/>|<w:b w:val="(?:true|1)"\/>/.test(r[1])});});}
    const size=Number(/<w:sz w:val="(\d+)"/.exec(p)?.[1]||18);
    const need=hp=>Math.max(...lines.map(l=>l.reduce((a,seg)=>a+textWidth(seg.t,seg.bold,hp),0)));
    if(need(size)<=width)return p;
    let hp=size;while(hp>MIN_HALF_POINTS&&need(hp)>width)hp--;
    return p.replace(/<w:sz w:val="\d+"\/>/g,`<w:sz w:val="${hp}"/>`).replace(/<w:szCs w:val="\d+"\/>/g,`<w:szCs w:val="${hp}"/>`);
   });
  });
 });
}
