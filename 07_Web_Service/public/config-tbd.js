function openDecisionList(){return configData?._openDecisions||[];}
function commitOpenDecisions(list){configData._openDecisions=list;configDraftMods._openDecisions=JSON.parse(JSON.stringify(list));}
function decisionFor(path){return openDecisionList().find(d=>d.path===path);}
function itemIdFor(path){const m=/^(\w+)\[(\d+)\]/.exec(path);return m?String(configData[m[1]]?.[Number(m[2])]?.id||''):'';}
function decisionEntry(input,previousValue){return {path:input.dataset.path,item_id:itemIdFor(input.dataset.path),owner:'',target_date:'',previous_value:String(previousValue??'')};}
function enhanceTBDFields(){
 for(const input of document.querySelectorAll('#configTabContent [data-path]')){
  if(input.dataset.derived==='approval-path')continue;
  const path=input.dataset.path,isSelect=input.tagName==='SELECT';
  // Prefix is optional and blank is a complete value, so it must not be
  // tracked as an unresolved TBD decision.
  if(path==='program.doc_prefix')continue;
  const box=document.createElement('span');box.style.cssText='display:flex;align-items:center;gap:.3rem;min-width:0;width:100%';
  input.before(box);box.appendChild(input);input.style.flex='1 1 auto';input.style.minWidth='0';
  const button=document.createElement('button');button.type='button';button.className='secondary';button.style.cssText='padding:.15rem .35rem;font-size:.7rem;line-height:1.25;flex:0 0 auto;white-space:nowrap';
  const label=configLabel(path.split('.').at(-1),path);
  const decision=decisionFor(path);
  box.appendChild(button);
  const applyStyle=()=>{
   const decision=decisionFor(path),pending=!!decision,required=configRequired(path);
   input.classList.toggle('config-tbd-value',pending);
   input.classList.toggle('config-tbd-required',pending&&required);
   if(pending&&required)input.setAttribute('aria-invalid','true');else input.removeAttribute('aria-invalid');
   const undoToTbd=input.dataset.undoToTbd==='true';
   button.hidden=!pending&&!undoToTbd;
   button.textContent=undoToTbd?'Undo edit':'Undo TBD';
   button.title=undoToTbd?'Undo this replacement and return the field to TBD.':'Restore the value saved before this field was marked TBD.';
   button.setAttribute('aria-label',undoToTbd?`Undo edit and return ${label} to TBD`:`Undo TBD for ${label}`);
  };
  if(isSelect){
   const update=()=>{
    const current=decisionFor(path);
    if(input.value===CONFIG_TBD_OPTION){
     if(!current){const previous=input.dataset.previousValue??input.dataset.originalValue??'';commitOpenDecisions([...openDecisionList(),decisionEntry(input,previous)]);}
    }else{
     if(current){commitOpenDecisions(openDecisionList().filter(d=>d.path!==path));input.dataset.undoToTbd='true';}
     input.dataset.previousValue=input.value;
    }
    applyStyle();
   };
   input.addEventListener('input',update);
   input.addEventListener('change',update);
   button.addEventListener('click',()=>{
    const current=decisionFor(path);
    if(!current&&input.dataset.undoToTbd==='true'){commitOpenDecisions([...openDecisionList(),decisionEntry(input,input.value)]);input.value=CONFIG_TBD_OPTION;delete input.dataset.undoToTbd;applyStyle();input.focus();return;}
    if(!current)return;
    const previous=String(current.previous_value??input.dataset.originalValue??'');
    commitOpenDecisions(openDecisionList().filter(d=>d.path!==path));
    input.value=previous;input.dataset.previousValue=previous;delete input.dataset.undoToTbd;
    applyStyle();input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.focus();
   });
   if(decision)input.dataset.previousValue=String(decision.previous_value??input.dataset.originalValue??'');
   else input.dataset.previousValue=input.value===CONFIG_TBD_OPTION?String(input.dataset.originalValue??''):input.value;
   applyStyle();
   continue;
  }
  // For text fields, the value itself becomes the red TBD marker. Replacing it
  // with real text resolves the decision; no extra status text expands the row.
  const onTextEdit=()=>{
   const current=decisionFor(path);
   if(current&&input.value.trim()!=='TBD'){
    commitOpenDecisions(openDecisionList().filter(d=>d.path!==path));
    input.dataset.previousValue=input.value;input.dataset.undoToTbd='true';
    applyStyle();
   }
  };
  input.addEventListener('input',onTextEdit);
  input.addEventListener('change',onTextEdit);
  button.addEventListener('click',()=>{
   const current=decisionFor(path);
   if(!current&&input.dataset.undoToTbd==='true'){
    commitOpenDecisions([...openDecisionList(),decisionEntry(input,input.value)]);input.value='TBD';delete input.dataset.undoToTbd;applyStyle();input.focus();input.select();return;
   }
   if(current){
    const previous=String(current.previous_value??'');
    commitOpenDecisions(openDecisionList().filter(d=>d.path!==path));
    input.value=previous;input.dataset.previousValue=previous;delete input.dataset.undoToTbd;
    applyStyle();input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();
   }else{
    delete input.dataset.undoToTbd;
    commitOpenDecisions([...openDecisionList(),decisionEntry(input,input.value)]);
    input.value='TBD';
    applyStyle();input.focus();input.select();
   }
  });
  if(decisionFor(path))input.value='TBD';
  applyStyle();
 }
}
