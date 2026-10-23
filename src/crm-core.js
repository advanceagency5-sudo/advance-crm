(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CrmCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const stages = new Set(['new_lead', 'discovery', 'proposal', 'negotiation', 'won', 'lost']);
  const statuses = new Set(['todo', 'in_progress', 'review', 'done']);
  const services = new Set(['growth_strategy','content_management','branding','video_production','digital_ads','seo','influencer','web_dev','automation_crm','company_profile']);
  function moneyTotals(records) {
    const totals={};
    for(const record of records){const currency=record.currency||'ج.م';totals[currency]=(totals[currency]||0)+Number(record.dealValue||0)}
    return totals;
  }
  function csvCell(value) {
    let text=String(value ?? '');
    if (typeof value !== 'number' && /^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  }
  function distributeContentQuantity(quantity) {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 200) throw new Error('الكمية يجب أن تكون عددًا صحيحًا من 0 إلى 200.');
    return Array.from({length:4}, (_, index) => Math.floor(quantity / 4) + (index < quantity % 4 ? 1 : 0));
  }
  function contentWeek(date, month) {
    let value = String(date || '').slice(0,10);
    if (String(date || '').includes('T')) {
      const parsed = new Date(date); if (!Number.isFinite(parsed.getTime())) return null;
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(parsed);
      value=['year','month','day'].map(type=>parts.find(part=>part.type===type).value).join('-');
    }
    if (!value.startsWith(month + '-')) return null;
    const day = Number(value.slice(8,10));
    return day >= 1 && day <= 31 ? Math.min(4, Math.ceil(day / 7)) : null;
  }
  function validateContentPlans(deal) {
    if (deal.contentPlans !== undefined && !Array.isArray(deal.contentPlans)) throw new Error('خطة المحتوى غير صالحة.');
    const plans=deal.contentPlans || [], ids=new Set(), months=new Set();
    for (const plan of plans) {
      if (!plan || typeof plan.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(plan.id) || ids.has(plan.id) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(plan.month) || months.has(plan.month)) throw new Error('خطة مكررة أو شهر غير صالح.');
      ids.add(plan.id); months.add(plan.month);
      for (const kind of ['reel','image']) {
        const target=plan.targets?.[kind], weekly=plan.weekly?.[kind];
        distributeContentQuantity(target);
        if (!Array.isArray(weekly) || weekly.length!==4 || weekly.some(n=>!Number.isInteger(n)||n<0) || weekly.reduce((a,b)=>a+b,0)!==target) throw new Error('مجموع الأسابيع يجب أن يطابق الكمية الشهرية.');
        const tasks=(deal.tasks||[]).filter(task=>task.contentPlanId===plan.id && task.contentKind===kind);
        if(tasks.length!==target || weekly.some((count,index)=>tasks.filter(t=>t.contentWeek===index+1).length!==count)) throw new Error('عناصر التسليم لا تطابق الخطة؛ لا تحذفها كمهام منفردة.');
      }
      if (!plan.targets.reel && !plan.targets.image) throw new Error('اختر مخرجًا واحدًا على الأقل.');
    }
    for (const task of deal.tasks || []) {
      if (!task.contentPlanId) continue;
      const plan=plans.find(p=>p.id===task.contentPlanId);
      if (!plan || !['reel','image'].includes(task.contentKind) || !Number.isInteger(task.contentWeek) || task.contentWeek<1 || task.contentWeek>4 || task.done!==(task.status==='done')) throw new Error('عنصر خطة غير صالح.');
      if (typeof task.assigneeUserId!=='string' || !task.assigneeUserId || !/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) || !task.dueDate.startsWith(plan.month+'-') || new Date(task.dueDate+'T12:00:00Z').toISOString().slice(0,10)!==task.dueDate || contentWeek(task.dueDate,plan.month)!==task.contentWeek) throw new Error('موعد التسليم يجب أن يكون ضمن أسبوعه وشهره، والمسؤول مطلوب.');
      if (task.deliverableUrl) { let url; try {url=new URL(task.deliverableUrl)} catch {throw new Error('رابط المخرج غير صالح.')} if(!['https:','http:'].includes(url.protocol))throw new Error('رابط المخرج يجب أن يبدأ بـ https أو http.'); }
      if (['review','done'].includes(task.status) && !task.deliverableUrl) throw new Error('أضف رابط المخرج قبل إرساله للمراجعة أو اعتماده.');
    }
  }
  function createContentPlan(deal, config, idFactory) {
    const candidate=clone(deal);
    const plan={id:idFactory(),month:config.month,targets:clone(config.targets),weekly:clone(config.weekly),createdAt:config.now || new Date().toISOString()};
    if (!candidate.contentPlans) candidate.contentPlans=[];
    if (candidate.contentPlans.some(p=>p.month===plan.month)) throw new Error('توجد خطة لهذا الشهر بالفعل.');
    if(!candidate.tasks)candidate.tasks=[];
    candidate.contentPlans.push(plan);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(plan.month)) throw new Error('اختر شهرًا صالحًا.');
    const [year,month]=plan.month.split('-').map(Number), lastDay=new Date(Date.UTC(year,month,0)).getUTCDate();
    for(const kind of ['reel','image']) {
      distributeContentQuantity(plan.targets?.[kind]);
      const weeks=plan.weekly?.[kind];
      if(!Array.isArray(weeks)||weeks.length!==4||weeks.some(n=>!Number.isInteger(n)||n<0)||weeks.reduce((a,b)=>a+b,0)!==plan.targets[kind])throw new Error('مجموع الأسابيع لا يساوي المطلوب الشهري.');
      const assignee=config.assignees?.[kind];
      if(plan.targets[kind] && (!assignee || !assignee.id || !assignee.name))throw new Error('حدد مسؤولًا لكل نوع مخرج.');
      let ordinal=0;
      weeks.forEach((quantity,index)=>{for(let number=0;number<quantity;number++) {
        const title=(kind==='reel'?'ريل ':'صورة ')+(++ordinal)+' — '+plan.month;
        candidate.tasks.push({id:idFactory(),title,text:title,assigneeUserId:assignee.id,assignee:assignee.name,contentPlanId:plan.id,contentKind:kind,contentWeek:index+1,dueDate:plan.month+'-'+String(index===3?lastDay:(index+1)*7).padStart(2,'0'),status:'todo',done:false,deliverableUrl:'',priority:'متوسطة',tool:'',readyAt:null,approvedAt:null});
      }});
    }
    validateContentPlans(candidate);
    return {deal:candidate,plan};
  }
  function contentPlanMetrics(deal, plan) {
    const result={};
    for (const kind of ['reel','image']) {
      const tasks=(deal.tasks||[]).filter(task=>task.contentPlanId===plan.id&&task.contentKind===kind),target=plan.targets[kind];
      const approved=tasks.filter(t=>t.status==='done').length,ready=tasks.filter(t=>['review','done'].includes(t.status)).length;
      result[kind]={target,approved,ready,approvedPercent:target?Math.round(approved/target*1000)/10:0,readyPercent:target?Math.round(ready/target*1000)/10:0,weeks:plan.weekly[kind].map((scheduled,index)=>({week:index+1,target:scheduled,approved:tasks.filter(t=>t.status==='done'&&contentWeek(t.approvedAt,plan.month)===index+1).length}))};
    }
    return result;
  }
  function validateDeals(value) {
    if (!Array.isArray(value)) throw new Error('بيانات الصفقات يجب أن تكون قائمة.');
    const ids = new Set();
    for (const deal of value) {
      if (!deal || typeof deal !== 'object' || typeof deal.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(deal.id) || ids.has(deal.id)) throw new Error('معرّف صفقة مفقود أو مكرر.');
      ids.add(deal.id);
      for (const field of ['companyName', 'contactPerson', 'contactPhone', 'primaryService', 'contractType', 'market', 'currency', 'date']) {
        if (typeof deal[field] !== 'string' || !deal[field].trim()) throw new Error('حقل صفقة غير صالح: ' + field);
      }
      if (!stages.has(deal.stage) || !['retainer', 'project'].includes(deal.contractType) || !['egypt', 'gulf'].includes(deal.market)) throw new Error('مرحلة أو نوع تعاقد أو سوق غير صالح.');
      if (!['ج.م', 'ر.س', 'د.إ', '$'].includes(deal.currency) || typeof deal.dealValue !== 'number' || !Number.isFinite(deal.dealValue) || deal.dealValue < 0) throw new Error('قيمة أو عملة غير صالحة.');
      if (!services.has(deal.primaryService) || (deal.services !== undefined && (!Array.isArray(deal.services) || !deal.services.length || deal.services.some(s => !services.has(s)) || !deal.services.includes(deal.primaryService)))) throw new Error('قائمة الخدمات غير صالحة.');
      for (const field of ['tasks', 'activities']) if (deal[field] !== undefined && !Array.isArray(deal[field])) throw new Error('قائمة غير صالحة: ' + field);
      const taskIds = new Set();
      for (const task of deal.tasks || []) {
        if (!task || typeof task.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(task.id) || taskIds.has(task.id) || typeof (task.title || task.text) !== 'string' || !(task.title || task.text).trim()) throw new Error('مهمة غير صالحة أو مكررة.');
        taskIds.add(task.id);
        if (task.status !== undefined && !statuses.has(task.status)) throw new Error('حالة مهمة غير صالحة.');
        if (task.done !== undefined && typeof task.done !== 'boolean') throw new Error('قيمة إنجاز مهمة غير صالحة.');
      }
      for (const activity of deal.activities || []) if (!activity || typeof activity.text !== 'string' || typeof activity.date !== 'string') throw new Error('نشاط غير صالح.');
      validateContentPlans(deal);
    }
    return true;
  }
  function validateUsers(value) {
    if (!Array.isArray(value) || !value.length) throw new Error('قائمة المستخدمين غير صالحة.');
    const ids = new Set();
    for (const user of value) {
      if (!user || typeof user.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(user.id) || ids.has(user.id) || typeof user.name !== 'string' || typeof user.username !== 'string' || typeof user.password !== 'string' || !['admin', 'member'].includes(user.role)) throw new Error('بيانات مستخدم غير صالحة.');
      ids.add(user.id);
    }
    return true;
  }
  class StorageError extends Error {
    constructor(message, code, cause) { super(message); this.name = 'CrmStorageError'; this.code = code; this.cause = cause; }
  }
  function createStore(storage, key, validate) {
    let observed = null, committed = null, blocked = false;
    function load(defaultFactory) {
      try {
        observed = storage.getItem(key);
        const candidate = observed === null ? defaultFactory() : JSON.parse(observed);
        validate(candidate); committed = clone(candidate); blocked = false;
        return clone(committed);
      } catch (cause) {
        blocked = true;
        throw new StorageError('تعذر قراءة البيانات. لم يتم استبدالها ببيانات تجريبية. صدّر البيانات الخام ثم راجعها.', 'LOAD_FAILED', cause);
      }
    }
    function save(candidate) {
      if (blocked || committed === null) throw new StorageError('الحفظ متوقف لحماية البيانات. راجع التنبيه ثم أعد تحميل الصفحة.', 'BLOCKED');
      try { validate(candidate); }
      catch (cause) { throw new StorageError(cause.message || 'البيانات غير صالحة.', 'INVALID_DATA', cause); }
      try {
        if (storage.getItem(key) !== observed) {
          blocked = true;
          throw new StorageError('تغيرت البيانات في نافذة أخرى. لم يُحفظ تعديلك. احتفظ بالمدخلات وأعد تحميل الصفحة قبل المتابعة.', 'CONFLICT');
        }
        const serialized = JSON.stringify(candidate);
        storage.setItem(key, serialized);
        observed = serialized; committed = clone(candidate);
        return true;
      } catch (cause) {
        if (cause instanceof StorageError) throw cause;
        throw new StorageError('لم يتم حفظ التعديل. احتُفظ بالمدخلات؛ تحقق من مساحة التخزين وأعد المحاولة.', 'SAVE_FAILED', cause);
      }
    }
    function backup(reason) {
      if (blocked || committed === null) throw new StorageError('لا يمكن إنشاء نسخة آمنة قبل حل مشكلة البيانات.', 'BLOCKED');
      try {
        const backupKey = key + '_recovery';
        const raw = storage.getItem(backupKey);
        const points = raw === null ? [] : JSON.parse(raw);
        if (!Array.isArray(points)) throw new Error('Invalid recovery archive');
        points.unshift({ schemaVersion: 1, createdAt: new Date().toISOString(), reason, deals: clone(committed) });
        storage.setItem(backupKey, JSON.stringify(points.slice(0, 5)));
      } catch (cause) { throw new StorageError('لم تُنفذ العملية: تعذر إنشاء نسخة الاسترجاع قبلها. صدّر نسخة وتحقق من مساحة التخزين.', 'BACKUP_FAILED', cause); }
    }
    function recover(candidate) {
      validate(candidate);
      try {
        const currentRaw = storage.getItem(key);
        if (currentRaw !== observed) throw new StorageError('تغيرت البيانات في نافذة أخرى؛ أعد تحميل الصفحة قبل الاسترجاع.', 'CONFLICT');
        // Preserve the exact previous bytes, even when invalid, before an explicit restore.
        storage.setItem(key + '_before_restore', JSON.stringify({ createdAt: new Date().toISOString(), raw: currentRaw }));
        if (!blocked && committed !== null) backup('before-restore');
        const raw = JSON.stringify(candidate);
        storage.setItem(key, raw);
        observed = raw; committed = clone(candidate); blocked = false;
      } catch (cause) {
        if (cause instanceof StorageError) throw cause;
        throw new StorageError('فشل الاسترجاع؛ لم يتم تأكيد حفظ البيانات الجديدة.', 'RESTORE_FAILED', cause);
      }
    }
    return { load, save, backup, recover, snapshot: () => clone(committed), isBlocked: () => blocked };
  }
  function addServiceTasks(deals, templates, idFactory, now = new Date()) {
    let added = 0;
    for (const deal of deals) {
      if (!deal.tasks) deal.tasks = [];
      for (const service of deal.services?.length ? deal.services : [deal.primaryService]) {
        (templates[service] || []).forEach((template, index) => {
          const templateKey = service + ':' + index;
          if (deal.tasks.some(task => task.templateKey === templateKey || ((task.title || task.text) === template.title && task.assignee === template.assignee))) return;
          const due = new Date(now); due.setDate(due.getDate() + (template.days || 3));
          deal.tasks.push({ id: idFactory(), templateKey, service, title: template.title, text: template.title, assignee: template.assignee || '', tool: template.tool || '', priority: template.priority || 'متوسطة', status: 'todo', done: false, dueDate: due.toISOString().slice(0, 10), deliverableUrl: '' });
          added++;
        });
      }
    }
    return added;
  }
  return { clone, validateDeals, validateUsers, createStore, StorageError, addServiceTasks, distributeContentQuantity, createContentPlan, contentPlanMetrics, validateContentPlans, contentWeek, moneyTotals, csvCell };
});
