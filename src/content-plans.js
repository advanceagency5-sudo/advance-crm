(function () {
  'use strict';
  const labels={reel:'الريلز',image:'الصور'};
  const stateLabels={todo:'قيد الانتظار',in_progress:'قيد التنفيذ',review:'جاهز للمراجعة',done:'معتمد'};
  let activeMonth='',activeWeek='all',activeKind='all',activeStatus='all',identity=null;
  const returnFocus=new Map();
  const el=id=>document.getElementById(id);
  const isAdmin=()=>getCurrentUser()?.role==='admin';
  function openOverlay(id){returnFocus.set(id,document.activeElement);el(id).hidden=false;el('detailsDialog').inert=true;}
  function closeOverlay(id){if(el(id).hidden)return;el(id).hidden=true;el('detailsDialog').inert=false;const previous=returnFocus.get(id);if(previous?.isConnected)previous.focus();}
  const currentDeal=()=>deals.find(deal=>deal.id===currentActiveDealId);
  const today=()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(type=>parts.find(part=>part.type===type).value).join('-');};
  function fail(node,error){node.textContent=error.message||String(error);}
  function refresh(){
    renderKanban();renderProjectsView();renderTeamTasksView();
    if(currentDeal()){openDetailsModal(currentActiveDealId);el('contentPlansSection').scrollIntoView({block:'start'});}
  }
  function summarize(metrics,kind){
    const data=metrics[kind];
    const outside=data.approved-data.weeks.reduce((sum,week)=>sum+week.approved,0);
    return `<article class="content-summary"><h5>${labels[kind]}</h5><strong>${data.approved} <small>من ${data.target} معتمد</small><span>${data.approvedPercent}%</span></strong><div class="content-progress" aria-label="المعتمد ${data.approvedPercent}%"><i style="width:${data.approvedPercent}%"></i></div><p>جاهز داخليًا: ${data.ready} من ${data.target} (${data.readyPercent}%) <span>يشمل المعتمد</span>${outside?'<span>'+outside+' اعتماد خارج شهر الخطة أو دون تاريخ؛ ضمن الإجمالي الشهري وليس توزيع الأسابيع.</span>':''}</p></article>`;
  }
  function renderContentPlans(deal){
    const plans=deal.contentPlans||[],root=el('contentPlansBody');
    el('contentPlansSection').style.scrollMarginTop=(el('detailsIdentityHeader').offsetHeight+12)+'px';
    el('createContentPlanBtn').hidden=!isAdmin();
    el('contentPlanMonth').replaceChildren();
    if(!plans.some(plan=>plan.month===activeMonth))activeMonth=[...plans].sort((a,b)=>b.month.localeCompare(a.month))[0]?.month||'';
    for(const plan of [...plans].sort((a,b)=>b.month.localeCompare(a.month))){const option=document.createElement('option');option.value=plan.month;option.textContent=plan.month;el('contentPlanMonth').appendChild(option)}
    el('contentPlanMonth').value=activeMonth;el('contentPlanMonth').hidden=!plans.length;
    if(!plans.length){root.innerHTML='<p class="content-empty">لا توجد خطة شهرية لهذا العميل بعد.'+(isAdmin()?' أضف كميات الريلز والصور وتوزيع الأسابيع.':'')+'</p>';return}
    const plan=plans.find(item=>item.month===activeMonth),metrics=CrmCore.contentPlanMetrics(deal,plan);
    const visible=(deal.tasks||[]).filter(task=>task.contentPlanId===plan.id&&canViewTask(task));
    const filtered=visible.filter(task=>(activeWeek==='all'||task.contentWeek===Number(activeWeek))&&(activeKind==='all'||task.contentKind===activeKind)&&(activeStatus==='all'||task.status===activeStatus));
    const weeks=[1,2,3,4].map(week=>{
      const lines=['reel','image'].filter(kind=>metrics[kind].target).map(kind=>{const w=metrics[kind].weeks[week-1],extra=w.approved>w.target?' · تجاوز بـ '+(w.approved-w.target):'';return `<p>${labels[kind]}: ${w.approved} معتمد / ${w.target} مستهدف${extra}</p>`}).join('');
      return `<article class="content-week"><h6>الأسبوع ${week}<small>${week===4?'22–نهاية الشهر':(week-1)*7+1+'–'+week*7}</small></h6>${lines}</article>`;
    }).join('');
    const rows=filtered.map(task=>`<article class="content-item" data-content-task="${task.id}"><div class="content-item-main"><span class="content-kind">${labels[task.contentKind]} · الأسبوع ${task.contentWeek}</span><h6>${escapeHtml(task.title||task.text)}</h6><p>${escapeHtml(task.assignee)} · <time dir="ltr">${escapeHtml(task.dueDate)}</time></p></div><div class="content-item-controls"><span class="content-state content-state-${task.status}">${stateLabels[task.status]}</span><button type="button" data-edit-content="${task.id}">${isAdmin()||task.status!=='done'?'تفاصيل وتحديث':'عرض المخرج'}</button>${task.deliverableUrl?`<a href="${escapeHtml(safeDeliverableUrl(task.deliverableUrl))}" target="_blank" rel="noopener noreferrer">فتح الملف ↗</a>`:''}</div></article>`).join('');
    root.innerHTML=`<div class="content-summary-grid">${['reel','image'].filter(kind=>metrics[kind].target).map(kind=>summarize(metrics,kind)).join('')}</div><p class="content-explanation">الجاهز داخليًا منفصل عن الاعتماد النهائي. النسب لكل نوع؛ لا نساوي الصورة بالريل في نسبة مجمعة.</p><div class="content-week-grid">${weeks}</div><p class="content-explanation">الأسابيع تعرض الاعتمادات الفعلية بتاريخها، حتى عند تسليم مخرج من أسبوع لاحق مبكرًا. النسبة الشهرية تخص كل مخرجات الخطة.</p><div class="content-filters"><label>الأسبوع<select id="contentWeekFilter"><option value="all">كل الأسابيع</option>${[1,2,3,4].map(w=>`<option value="${w}">الأسبوع ${w}</option>`).join('')}</select></label><label>المخرج<select id="contentKindFilter"><option value="all">كل المخرجات</option><option value="reel">الريلز</option><option value="image">الصور</option></select></label><label>الحالة<select id="contentStatusFilter"><option value="all">كل الحالات</option>${Object.entries(stateLabels).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label></div><p class="content-explanation">${isAdmin()?'كل عناصر التسليم ظاهرة للمدير.':'تفاصيل المخرجات المكلف بها حسابك فقط؛ النسب أعلاه إجمالية للخطة.'} عرض ${filtered.length} من ${visible.length} عنصر.</p><div class="content-items">${rows||'<p class="content-empty">لا توجد مخرجات تخصك مطابقة للفلاتر.</p>'}</div>`;
    for(const [id,value,setter]of [['contentWeekFilter',activeWeek,v=>activeWeek=v],['contentKindFilter',activeKind,v=>activeKind=v],['contentStatusFilter',activeStatus,v=>activeStatus=v]]){el(id).value=value;el(id).addEventListener('change',event=>{setter(event.target.value);renderContentPlans(deal)})}
    root.querySelectorAll('[data-edit-content]').forEach(button=>button.addEventListener('click',()=>openItemEditor(button.dataset.editContent)));
  }
  function openPlanEditor(){
    if(!isAdmin()||!currentDeal())return;
    el('contentPlanForm').reset();el('planMonthInput').value=today().slice(0,7);el('planReelTarget').value=8;el('planImageTarget').value=12;el('contentPlanError').textContent='';
    for(const kind of ['reel','image']){const select=el('plan'+(kind==='reel'?'Reel':'Image')+'Assignee');select.replaceChildren();for(const user of teamUsers){const option=document.createElement('option');option.value=user.id;option.textContent=user.name;select.appendChild(option)}select.value=teamUsers.find(user=>user.id==='youssef')?.id||getCurrentUser().id;redistribute(kind)}
    openOverlay('contentPlanModal');el('planMonthInput').focus();
  }
  function redistribute(kind){
    try{const target=Number(el(kind==='reel'?'planReelTarget':'planImageTarget').value);CrmCore.distributeContentQuantity(target).forEach((quantity,index)=>el('planWeek_'+kind+'_'+index).value=quantity);el('contentPlanError').textContent=''}catch(error){fail(el('contentPlanError'),error)}
  }
  function savePlan(event){
    event.preventDefault();if(!isAdmin()||!currentDeal())return;
    try{
      const config={month:el('planMonthInput').value,targets:{reel:Number(el('planReelTarget').value),image:Number(el('planImageTarget').value)},weekly:{},assignees:{}};
      for(const kind of ['reel','image']){config.weekly[kind]=[0,1,2,3].map(i=>Number(el('planWeek_'+kind+'_'+i).value));config.assignees[kind]=teamUsers.find(user=>user.id===el(kind==='reel'?'planReelAssignee':'planImageAssignee').value)}
      const result=CrmCore.createContentPlan(currentDeal(),config,newRecordId);
      CrmCore.validateDeals([result.deal]);
      deals=deals.map(deal=>deal.id===result.deal.id?result.deal:deal);saveDeals();activeMonth=config.month;activeWeek=activeKind=activeStatus='all';closeOverlay('contentPlanModal');refresh();showToast('تم إنشاء الخطة ومهام التسليم، كلها قيد الانتظار.');
    }catch(error){fail(el('contentPlanError'),error)}
  }
  function openItemEditor(taskId){
    const task=currentDeal()?.tasks.find(task=>task.id===taskId&&canViewTask(task));if(!task)return;
    const locked=!isAdmin()&&task.status==='done';el('contentItemForm').reset();el('contentItemId').value=task.id;el('contentItemTitle').value=task.title||task.text;el('contentItemUrl').value=task.deliverableUrl||'';el('contentItemDue').value=task.dueDate;el('contentItemError').textContent='';
    el('contentItemStatus').replaceChildren();for(const [key,label]of Object.entries(stateLabels)){const option=document.createElement('option');option.value=key;option.textContent=label;option.disabled=key==='done'&&!isAdmin();el('contentItemStatus').appendChild(option)}el('contentItemStatus').value=task.status;
    el('contentItemAssignee').replaceChildren();for(const user of teamUsers){const option=document.createElement('option');option.value=user.id;option.textContent=user.name;el('contentItemAssignee').appendChild(option)}el('contentItemAssignee').value=task.assigneeUserId;
    for(const id of ['contentItemTitle','contentItemUrl','contentItemStatus'])el(id).disabled=locked;
    el('contentItemDue').disabled=!isAdmin();el('contentItemAssignee').disabled=!isAdmin();el('saveContentItemBtn').hidden=locked;
    el('contentItemHint').textContent=locked?'هذا المخرج معتمد. المدير فقط يمكنه إعادة فتحه.':'أضف رابط الملف قبل إرسال المخرج للمراجعة. الاعتماد النهائي للمدير فقط.';
    openOverlay('contentItemModal');(locked?el('contentItemModal').querySelector('[data-close-content]'):el('contentItemTitle')).focus();
  }
  function saveItem(event){
    event.preventDefault();const deal=currentDeal(),task=deal?.tasks.find(task=>task.id===el('contentItemId').value);if(!task||!canViewTask(task))return;
    try{
      if(!isAdmin()&&(task.status==='done'||el('contentItemStatus').value==='done'))throw new Error('المدير فقط يعتمد المخرج أو يعيد فتحه.');
      const candidate=CrmCore.clone(deal),item=candidate.tasks.find(t=>t.id===task.id),title=el('contentItemTitle').value.trim();if(!title)throw new Error('عنوان المخرج مطلوب.');
      item.title=item.text=title;item.deliverableUrl=el('contentItemUrl').value.trim();item.status=el('contentItemStatus').value;item.done=item.status==='done';
      if(isAdmin()){const assignee=teamUsers.find(user=>user.id===el('contentItemAssignee').value);if(!assignee)throw new Error('اختر مسؤولًا صالحًا.');item.assigneeUserId=assignee.id;item.assignee=assignee.name;item.dueDate=el('contentItemDue').value}
      CrmCore.validateDeals([candidate]);
      deals=deals.map(d=>d.id===candidate.id?candidate:d);saveDeals();closeOverlay('contentItemModal');refresh();showToast('تم حفظ المخرج وتحديث نسب الخطة.');
    }catch(error){fail(el('contentItemError'),error)}
  }
  function prepareContentChanges(previous,next){
    const user=getCurrentUser();
    for(const deal of next){
      const oldDeal=previous.find(d=>d.id===deal.id);
      if(!isAdmin()&&JSON.stringify(deal.contentPlans||[])!==JSON.stringify(oldDeal?.contentPlans||[]))throw new CrmCore.StorageError('إدارة الخطة الشهرية للمدير فقط.','CONTENT_PERMISSION');
      for(const task of deal.tasks||[]){if(!task.contentPlanId)continue;const before=oldDeal?.tasks.find(t=>t.id===task.id);
        if(before&&JSON.stringify(before)===JSON.stringify(task))continue;
        if(!isAdmin()&&(!before||!canViewTask(before)||before.status==='done'||task.status==='done'||before.assigneeUserId!==task.assigneeUserId||before.dueDate!==task.dueDate||before.contentPlanId!==task.contentPlanId||before.contentKind!==task.contentKind||before.contentWeek!==task.contentWeek))throw new CrmCore.StorageError('غير مسموح بتعديل مخرج آخر أو اعتماده.','CONTENT_PERMISSION');
        if(before){task.readyAt=before.readyAt||null;task.approvedAt=before.approvedAt||null;task.contentHistory=CrmCore.clone(before.contentHistory||[])}
        if(before?.status!==task.status){const now=new Date().toISOString();task.readyAt=['review','done'].includes(task.status)?(task.readyAt||now):null;task.approvedAt=task.status==='done'?now:null;task.contentHistory=task.contentHistory||[];task.contentHistory.push({from:before?.status||null,to:task.status,actorId:user.id,at:now})}
      }
    }
  }
  function syncTaskControls(){
    if(isAdmin())return;
    document.querySelectorAll('[data-deal][data-idx]').forEach(control=>{const task=deals.find(d=>d.id===control.dataset.deal)?.tasks[control.dataset.idx];if(!task?.contentPlanId)return;if(control.tagName==='SELECT'){const option=control.querySelector('option[value="done"]');if(option)option.disabled=true;if(task.status==='done')control.disabled=true}else if(control.type==='checkbox'||control.tagName==='BUTTON')control.disabled=true;});
  }
  function setupContentPlans(){
    el('createContentPlanBtn').addEventListener('click',openPlanEditor);el('contentPlanMonth').addEventListener('change',event=>{activeMonth=event.target.value;activeWeek=activeKind=activeStatus='all';renderContentPlans(currentDeal())});
    el('contentPlanForm').addEventListener('submit',savePlan);el('contentItemForm').addEventListener('submit',saveItem);
    el('planReelTarget').addEventListener('input',()=>redistribute('reel'));el('planImageTarget').addEventListener('input',()=>redistribute('image'));
    for(const id of ['contentPlanModal','contentItemModal'])el(id).querySelectorAll('[data-close-content]').forEach(button=>button.addEventListener('click',()=>closeOverlay(id)));
    document.addEventListener('keydown',event=>{
      const id=['contentItemModal','contentPlanModal'].find(id=>!el(id).hidden);if(!id)return;
      if(event.key==='Escape'){event.preventDefault();closeOverlay(id);return}
      if(event.key==='Tab'){const focusable=[...el(id).querySelectorAll('button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),a[href]')].filter(node=>!node.hidden);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
    });
    const observer=new MutationObserver(syncTaskControls);
    for(const id of ['masterTasksTableBody','masterTasksMobileList','memberTasksTableBody','memberTasksMobileList'])observer.observe(el(id),{childList:true,subtree:true});
  }
  function resetIdentity(){const id=getCurrentUser()?.id;if(id===identity)return;identity=id;activeMonth='';activeWeek=activeKind=activeStatus='all';for(const id of ['contentPlanModal','contentItemModal'])if(el(id))closeOverlay(id);if(el('contentPlansBody'))el('contentPlansBody').replaceChildren()}
  window.ContentPlans={setup:setupContentPlans,render:renderContentPlans,prepareChanges:prepareContentChanges,syncTaskControls,resetIdentity};
})();
