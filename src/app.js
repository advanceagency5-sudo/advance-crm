    function financialTotalsText(records, monthly = false) {
      if (!getCurrentUserPermissions().canViewFinancials) return 'غير متاحة لهذا الحساب';
      const totals=CrmCore.moneyTotals(records);
      return Object.entries(totals).map(([currency,amount])=>getFinancialText(amount,currency,monthly?' / شهر':'')).join(' · ') || '0';
    }
    function canManageTeam() {
      const user = getCurrentUser();
      if (!user || user.role !== 'admin' || user.canManageRoles !== true || user.isReadOnly) return false;
      try { return window.sessionStorage.getItem('advance_crm_repair_session_v1') === user.id; }
      catch { return false; }
    }
    function requireTeamManager() {
      if (canManageTeam()) return true;
      showToast('إضافة أعضاء الفريق وإدارة صلاحياتهم متاحة للمدير فقط.', 'error');
      return false;
    }
    function canViewTask(task) {
      const user = getCurrentUser();
      if (!user || !task) return false;
      if (user.role === 'admin') return true;
      if (task.assigneeUserId || task.assigneeId) return (task.assigneeUserId || task.assigneeId) === user.id;
      const normalize = value => String(value || '').trim().replace(/\s+/g, ' ');
      return normalize(task.assignee) === normalize(user.name) || normalize(task.assignee) === normalize(user.id);
    }
    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
    }
    function safeDeliverableUrl(value) {
      try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : '#'; }
      catch { return '#'; }
    }
    // Phase 1: isolated local persistence; this is not server-side authentication.
    const localStorageAdapter = {
      getItem: key => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value)
    };
    const dealStore = CrmCore.createStore(localStorageAdapter, 'advance_crm_repair_deals_v1', CrmCore.validateDeals);
    const userStore = CrmCore.createStore(localStorageAdapter, 'advance_crm_repair_users_v1', CrmCore.validateUsers);
    function newRecordId() { return 'rec_' + window.crypto.randomUUID(); }
    function setStorageHealth(message) {
      const banner = document.getElementById('storageHealthBanner');
      if (banner) banner.textContent = message;
    }
    function reportPersistenceError(error) {
      setStorageHealth(error.message || 'تعذر حفظ البيانات.');
      showToast(error.message || 'تعذر حفظ البيانات.', 'error');
    }
    window.addEventListener('error', event => {
      if (event.error?.name !== 'CrmStorageError') return;
      event.preventDefault();
      // Rebuild closures against the committed state, preserving any open form input.
      if (Array.isArray(deals) && teamUsers.length) {
        renderKanban(); renderContactsTable(); renderProjectsView(); renderTeamTasksView();
        const details = document.getElementById('detailsModal');
        if (details && !details.classList.contains('hidden')) {
          if (deals.some(deal => deal.id === currentActiveDealId)) openDetailsModal(currentActiveDealId);
          else details.classList.add('hidden');
        }
        renderRolesDashboard();
      }
    });
    function allowMutation(permission) {
      const user = getCurrentUser();
      if (!user || !window.sessionStorage.getItem('advance_crm_repair_session_v1') || !user[permission] || user.isReadOnly) {
        showToast('هذا الإجراء غير مسموح للحساب الحالي.', 'error');
        return false;
      }
      return true;
    }
    function prepareTaskDeletion(deal, taskId) {
      if (!allowMutation('canEditDeals')) return false;
      const index = deal.tasks.findIndex(task => task.id === taskId && canViewTask(task));
      if (index >= 0 && deal.tasks[index].contentPlanId) { showToast('هذا مخرج ضمن خطة شهرية؛ حدّثه من تفاصيل خطة المحتوى بدل حذفه منفردًا.', 'error'); return false; }
      if (index < 0 || !window.confirm('حذف هذه المهمة؟ ستُحفظ نسخة استرجاع قبل الحذف.')) return false;
      dealStore.backup('before-delete-task');
      deal.tasks.splice(index, 1);
      return true;
    }
    function clearDealFilters() {
      for (const suffix of ['', 'Mobile']) {
        for (const id of ['filterContract', 'filterService', 'filterMarket']) {
          const input = document.getElementById(id + suffix); if (input) input.value = 'all';
        }
        const sort = document.getElementById('sortDeals' + suffix); if (sort) sort.value = 'date_desc';
      }
      document.getElementById('globalSearch').value = '';
      const mobileSearch = document.getElementById('mobileSearchInput'); if (mobileSearch) mobileSearch.value = '';
      activeMobileStage = 'all'; renderKanban();
    }
    function downloadJson(value, filename) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = filename;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function restoreDealRecords(records) {
      if (!allowMutation('canDeleteDeals')) return false;
      const candidate = CrmCore.clone(records); CrmCore.validateDeals(candidate);
      if (!window.confirm('استبدال الصفقات الحالية بـ ' + candidate.length + ' صفقة من النسخة؟ ستُحفظ البيانات السابقة أولًا.')) return false;
      dealStore.recover(candidate);
      deals = dealStore.snapshot(); currentActiveDealId = null;
      document.getElementById('detailsModal').classList.add('hidden');
      renderKanban(); renderContactsTable(); renderProjectsView(); renderTeamTasksView();
      setStorageHealth('تم استرجاع البيانات وحفظها محليًا.');
      showToast('تم الاسترجاع بنجاح.'); return true;
    }
    function setupRecoveryActions() {
      document.getElementById('backupDealsBtn').addEventListener('click', () => {
        if (getCurrentUser()?.role !== 'admin') return;
        if (!allowMutation('canExportCsv')) return;
        CrmCore.validateDeals(deals);
        downloadJson({ format: 'advance-crm-deals', schemaVersion: 1, createdAt: new Date().toISOString(), deals: dealStore.snapshot() }, 'advance-crm-deals-backup.json');
        showToast('تم تجهيز نسخة الصفقات بكل المهام والأنشطة. لا تشمل كلمات مرور المستخدمين.');
      });
      document.getElementById('exportRawBtn').addEventListener('click', () => {
        if (getCurrentUser()?.role !== 'admin' || !window.sessionStorage.getItem('advance_crm_repair_session_v1')) return;
        try {
          downloadJson({ format: 'advance-crm-raw-review', createdAt: new Date().toISOString(), current: localStorageAdapter.getItem('advance_crm_repair_deals_v1'), legacy: localStorageAdapter.getItem('advance_crm_deals_v2') }, 'advance-crm-raw-review.json');
        } catch (error) { reportPersistenceError(error); }
      });
      document.getElementById('restoreDealsBtn').addEventListener('click', () => {
        if (allowMutation('canDeleteDeals')) document.getElementById('restoreDealsInput').click();
      });
      document.getElementById('restoreDealsInput').addEventListener('change', async event => {
        const file = event.target.files[0]; if (!file) return;
        try {
          if (file.size > 20 * 1024 * 1024) throw new Error('الملف أكبر من الحد المحلي المسموح (20MB).');
          const payload = JSON.parse(await file.text());
          if (!Array.isArray(payload) && (payload.format !== 'advance-crm-deals' || payload.schemaVersion !== 1)) throw new Error('صيغة أو إصدار نسخة غير مدعوم.');
          restoreDealRecords(Array.isArray(payload) ? payload : payload.deals);
        } catch (error) { reportPersistenceError(error); }
        finally { event.target.value = ''; }
      });
      document.getElementById('restoreRecoveryBtn').addEventListener('click', () => {
        if (!allowMutation('canDeleteDeals')) return;
        try {
          const points = JSON.parse(localStorageAdapter.getItem('advance_crm_repair_deals_v1_recovery') || '[]');
          if (!Array.isArray(points) || !points.length) throw new Error('لا توجد نسخة استرجاع محفوظة بعد.');
          restoreDealRecords(points[0].deals);
        } catch (error) { reportPersistenceError(error); }
      });
    }


    // --- STAGES CONFIGURATION ---
    const STAGES = [
      { id: 'new_lead', name: 'عميل جديد', color: 'border-sky-500', badgeBg: 'bg-sky-50 text-sky-700' },
      { id: 'discovery', name: 'الاكتشاف والتأهيل', color: 'border-blue-500', badgeBg: 'bg-blue-50 text-blue-700' },
      { id: 'proposal', name: 'إعداد العرض', color: 'border-purple-500', badgeBg: 'bg-purple-50 text-purple-700' },
      { id: 'negotiation', name: 'التفاوض والمراجعة', color: 'border-amber-500', badgeBg: 'bg-amber-50 text-amber-700' },
      { id: 'won', name: 'تم التعاقد (Won)', color: 'border-emerald-500', badgeBg: 'bg-emerald-50 text-emerald-700' },
      { id: 'lost', name: 'مؤجل / غير نشط', color: 'border-slate-400', badgeBg: 'bg-slate-100 text-slate-600' }
    ];

    // --- SERVICES MAPPING & DELIVERABLES (From AdVance Profile) ---
    const SERVICES = {
      growth_strategy: '01 استراتيجية النمو والتسويق',
      content_management: '02 المحتوى وإدارة المنصات',
      branding: '03 الهوية البصرية والتصميم',
      video_production: '04 التصوير وإنتاج الفيديو',
      digital_ads: '05 الإعلانات الرقمية',
      seo: '06 تحسين محركات البحث SEO',
      influencer: '07 التسويق عبر المؤثرين',
      web_dev: '08 المواقع والمتاجر الإلكترونية',
      automation_crm: '09 الأتمتة وCRM',
      company_profile: '10 الملفات المؤسسية وعروض الأعمال'
    };

    const SERVICE_DELIVERABLES = {
      growth_strategy: [
        'مراجعة النشاط التجاري والسوق والمنافسين ونقاط القوة والفرص.',
        'مراجعة وتطوير رحلة العميل ومسار البيع ومعالجة نقاط الهدر.',
        'تحديد الجمهور المستهدف والرسائل الترويجية والتموضع في السوق.',
        'خطة القنوات البيعية والأولويات ومؤشرات الأداء (KPIs) المرتبطة بالنمو.'
      ],
      content_management: [
        'استراتيجية ومحاور واضحة للمحتوى تدعم قرار الشراء.',
        'تقويم نشر شهري منظم للمنصات المتفق عليها.',
        'كتابة المنشورات والسكريبتات والتوجيهات البصرية الاحترافية.',
        'متابعة مستمرة للأداء وتطوير دوري للمحتوى بناءً على النتائج والبيانات.'
      ],
      branding: [
        'بناء نظام الشعار وتطبيقاته الأساسية والفرعية.',
        'لوحة الألوان والخطوط الرسمية وأسلوب الصور المعتمد.',
        'دليل استخدام الهوية البصرية الكامل (Brand Guidelines).',
        'قوالب المنصات والمواد المؤسسية مثل الكروت والأوراق الرسمية والعروض.'
      ],
      video_production: [
        'أفكار وسكريبتات وخطة واضحة للمحتوى المرئي.',
        'تخطيط المشاهد واللقطات قبل التصوير وفق طبيعة المشروع.',
        'تصوير احترافي للصور والفيديو بأعلى جودة.',
        'مونتاج وإيقاع بصري مناسب لكل منصة (ريلز وفيديوهات قصيرة جاهزة للنشر).'
      ],
      digital_ads: [
        'تحديد أهداف الحملات والجمهور المناسب وبناء هيكل الحملات الإعلانية.',
        'تطوير الرسائل والنسخ والزوايا الإعلانية للاختبار.',
        'إعداد التتبع والقياس (Pixel & Conversion API) بدقة.',
        'إدارة الحملات واختبار وتحسين الجمهور والعروض بشكل مستمر مع تقارير دورية.'
      ],
      seo: [
        'مراجعة فنية شاملة ومراجعة محتوى الموقع الحالي.',
        'بحث الكلمات المفتاحية وفرص الظهور في محركات البحث.',
        'تحسين هيكل وعناوين ووصف الصفحات بما يدعم نية البحث العضوي.',
        'متابعة مستمرة لترتيب الظهور ونمو الزيارات العضوية المجانية.'
      ],
      influencer: [
        'تحديد نوع المؤثرين الأنسب للحملة وفق طبيعة الجمهور والهدف.',
        'ترشيح مؤثرين معتمدين وإعداد موجز واضح للمحتوى والرسالة.',
        'التنسيق ومراجعة المحتوى قبل النشر لضمان الالتزام بالمعايير.',
        'متابعة التعاون وقياس المؤشرات المتاحة وتلخيص النتائج.'
      ],
      web_dev: [
        'تخطيط هيكل الصفحات وتجربة المستخدم (UI/UX) المصممة للتحويل.',
        'تصميم وتطوير الموقع أو المتجر الإلكتروني بأحدث المعايير.',
        'كتابة المحتوى الأساسي للصفحات ونماذج التواصل وطلبات الخدمة.',
        'ربط أدوات التتبع والقياس وتهيئة الصفحات لخدمة الحملات الإعلانية.'
      ],
      automation_crm: [
        'تحديد العمليات المناسبة للأتمتة في رحلة العميل.',
        'تصميم سيناريوهات الرد التلقائي والمتابعة عبر WhatsApp وCRM.',
        'تنظيم رحلة العملاء المحتملين ومراحل المبيعات لتقليل الهدر.',
        'توثيق آلية التشغيل وتسليم مسار العمل مع مراجعة وتحسين مستمر.'
      ],
      company_profile: [
        'هيكل الملف المؤسسي وصياغة الرسالة والرؤية وقيم الشركة.',
        'كتابة وصياغة المحتوى المؤسسي بأسلوب احترافي مقنع.',
        'تصميم الملف التعريفي وعروض المبيعات والشراكات بجودة طباعة وعرض رقمي.',
        'توفير نسخ عربية وإنجليزية عالية الدقة أمام صناع القرار.'
      ]
    };


    const SERVICE_TASK_TEMPLATES = {
      growth_strategy: [
        { title: 'جلسة استكشاف وفهم نموذج العمل والمنافسين', assignee: 'مؤمن النوساني', tool: 'كلود (Claude)', priority: 'عالية', status: 'done', days: 2 },
        { title: 'تحليل رحلة العميل ومسار المبيعات ومعالجة الهدر', assignee: 'يوسف الخولي', tool: 'شات جي بي تي (ChatGPT)', priority: 'عالية', status: 'in_progress', days: 5 },
        { title: 'اعتماد وثيقة استراتيجية التموضع وخطة الـ KPIs', assignee: 'العميل', tool: 'تواصل مع العميل', priority: 'عالية', status: 'todo', days: 8 }
      ],
      content_management: [
        { title: 'إعداد خطة ومحاور المحتوى الشهري الموجه للتحويل', assignee: 'مؤمن النوساني', tool: 'كلود (Claude)', priority: 'عالية', status: 'done', days: 3 },
        { title: 'كتابة وتصميم المنشورات والسكريبتات وجدولتها', assignee: 'يوسف الخولي', tool: 'شات جي بي تي (ChatGPT)', priority: 'متوسطة', status: 'in_progress', days: 6 },
        { title: 'اعتماد تقويم النشر الأسبوعي ومراجعة الريلز', assignee: 'العميل', tool: 'تواصل مع العميل', priority: 'متوسطة', status: 'todo', days: 8 }
      ],
      branding: [
        { title: 'إعداد لوحة المزاج والاتجاه البصري والرموز', assignee: 'مؤمن النوساني', tool: 'جيمناي (Gemini)', priority: 'عالية', status: 'done', days: 3 },
        { title: 'تصميم مقترحات الشعار وتطبيقات الهوية ودليل العلامة', assignee: 'يوسف الخولي', tool: 'كانفا / أدوبي (Canva / Adobe)', priority: 'عالية', status: 'in_progress', days: 7 },
        { title: 'اختيار المفهوم النهائي واعتماد تطبيقات الهوية الرسمية', assignee: 'العميل', tool: 'تواصل مع العميل', priority: 'عالية', status: 'todo', days: 10 }
      ],
      video_production: [
        { title: 'كتابة سيناريو الفيديو والقصة المصورة وتخطيط اللقطات', assignee: 'مؤمن النوساني', tool: 'كلود (Claude)', priority: 'عالية', status: 'done', days: 3 },
        { title: 'التصوير الميداني والمونتاج والمؤثرات البصرية والريلز', assignee: 'يوسف الخولي', tool: 'كانفا / أدوبي (Canva / Adobe)', priority: 'عالية', status: 'in_progress', days: 6 },
        { title: 'توفير موقع التصوير والمنتجات ومراجعة المسودة النهائية', assignee: 'العميل', tool: 'تواصل مع العميل', priority: 'عالية', status: 'review', days: 9 }
      ],
      digital_ads: [
        { title: 'مراجعة وتثبيت بيكسل التتبع وCAPI في الموقع', assignee: 'يوسف الخولي', tool: 'انتي جرافتي (Antigravity)', priority: 'عالية', status: 'done', days: 2 },
        { title: 'صياغة زوايا النسخ الإعلانية للاختبار (Ad Copies)', assignee: 'مؤمن النوساني', tool: 'كلود (Claude)', priority: 'عالية', status: 'done', days: 4 },
        { title: 'إطلاق الحملات على منصات Meta وGoogle ومتابعة CPL', assignee: 'يوسف الخولي', tool: 'ميتا (Meta Ads)', priority: 'عالية', status: 'in_progress', days: 6 },
        { title: 'مراجعة واعتماد الميزانية الإعلانية الشهرية', assignee: 'العميل', tool: 'تواصل مع العميل', priority: 'عالية', status: 'todo', days: 7 }
      ],
      seo: [
        { title: 'فحص الكلمات المفتاحية ومراجعة بنية الموقع العضوي', assignee: 'مؤمن النوساني', tool: 'كلود (Claude)', priority: 'متوسطة', status: 'done', days: 4 },
        { title: 'تحسين العناوين ووصف الصفحات وسرعة التصفح', assignee: 'يوسف الخولي', tool: 'شات جي بي تي (ChatGPT)', priority: 'عالية', status: 'in_progress', days: 8 },
        { title: 'ربط Google Search Console ومراجعة تقرير نمو الزيارات', assignee: 'العميل', tool: 'تواصل مع العميل', priority: 'عادية', status: 'todo', days: 14 }
      ],
      influencer: [
        { title: 'ترشيح المؤثرين الأنسب وإعداد موجز الرسالة', assignee: 'مؤمن النوساني', tool: 'كلود (Claude)', priority: 'عالية', status: 'done', days: 3 },
        { title: 'التنسيق والاتفاق ومتابعة مراجعة المحتوى قبل النشر', assignee: 'يوسف الخولي', tool: 'شات جي بي تي (ChatGPT)', priority: 'عالية', status: 'in_progress', days: 7 },
        { title: 'إرسال عينات المنتجات واعتماد مخرجات المؤثرين', assignee: 'العميل', tool: 'تواصل مع العميل', priority: 'عالية', status: 'todo', days: 8 }
      ],
      web_dev: [
        { title: 'هيكلة تجربة المستخدم UI/UX وتوزيع الصفحات المصممة للتحويل', assignee: 'مؤمن النوساني', tool: 'كلود (Claude)', priority: 'عالية', status: 'done', days: 4 },
        { title: 'برمجة وتطوير الموقع والمتاجر وتجاوب الشاشات ونماذج الطلب', assignee: 'يوسف الخولي', tool: 'انتي جرافتي (Antigravity)', priority: 'عالية', status: 'in_progress', days: 10 },
        { title: 'تزويد صور المنتجات والبيانات المؤسسية واعتماد الإطلاق', assignee: 'العميل', tool: 'تواصل مع العميل', priority: 'عالية', status: 'todo', days: 14 }
      ],
      automation_crm: [
        { title: 'رسم خريطة رحلة العميل وسيناريوهات الرد التلقائي', assignee: 'مؤمن النوساني', tool: 'كلود (Claude)', priority: 'عالية', status: 'done', days: 3 },
        { title: 'ربط بوابة WhatsApp وWebhooks وأتمتة مسار المبيعات', assignee: 'يوسف الخولي', tool: 'انتي جرافتي (Antigravity)', priority: 'عالية', status: 'in_progress', days: 7 },
        { title: 'تدريب فريق المبيعات واختبار استقبال الصفقات الحية', assignee: 'العميل', tool: 'تواصل مع العميل', priority: 'متوسطة', status: 'todo', days: 10 }
      ],
      company_profile: [
        { title: 'صياغة المحتوى المؤسسي ورسالة ورؤية وقيم الشركة', assignee: 'مؤمن النوساني', tool: 'كلود (Claude)', priority: 'عالية', status: 'done', days: 3 },
        { title: 'تصميم وإخراج ملف الشركة بالعربية والإنجليزية للطباعة والعرض', assignee: 'يوسف الخولي', tool: 'كانفا / أدوبي (Canva / Adobe)', priority: 'عالية', status: 'in_progress', days: 7 },
        { title: 'مراجعة أرقام الإنجاز وسابقة الأعمال والاعتماد النهائي', assignee: 'العميل', tool: 'تواصل مع العميل', priority: 'عالية', status: 'todo', days: 10 }
      ]
    };

    // --- SEED SAMPLE DATA (Reflecting AdVance clients from PDF) ---
    const INITIAL_DEALS = [
  {
    "id": "deal_1",
    "companyName": "شركة تجريبية 1",
    "contactPerson": "جهة اتصال تجريبية 1",
    "contactPhone": "0000000000",
    "contactEmail": "client1@example.com",
    "contractType": "retainer",
    "primaryService": "digital_ads",
    "services": [
      "digital_ads",
      "growth_strategy"
    ],
    "dealValue": 65000,
    "currency": "ر.س",
    "stage": "negotiation",
    "market": "gulf",
    "source": "referral",
    "date": "2026-10-18",
    "notes": "بيانات اصطناعية لعرض وظائف النظام فقط.",
    "tasks": [
      {
        "id": "t1",
        "title": "دراسة تحليلية لتكلفة النقرة والتحويل",
        "text": "دراسة تحليلية لتكلفة النقرة والتحويل",
        "assignee": "مؤمن النوساني",
        "tool": "كلود (Claude)",
        "dueDate": "2026-10-25",
        "priority": "عالية",
        "status": "done",
        "done": true
      },
      {
        "id": "t2",
        "title": "تجهيز هيكل حملات Google Search وميزانية الشهر الأول",
        "text": "تجهيز هيكل حملات Google Search وميزانية الشهر الأول",
        "assignee": "يوسف الخولي",
        "tool": "ميتا (Meta Ads)",
        "dueDate": "2026-10-27",
        "priority": "عالية",
        "status": "in_progress",
        "done": false
      },
      {
        "id": "t3",
        "title": "اعتماد الميزانية الإعلانية وتفويض الحساب",
        "text": "اعتماد الميزانية الإعلانية وتفويض الحساب",
        "assignee": "العميل",
        "tool": "تواصل مع العميل",
        "dueDate": "2026-10-29",
        "priority": "متوسطة",
        "status": "todo",
        "done": false
      }
    ],
    "activities": [
      {
        "type": "meeting",
        "date": "2026-10-20 14:00",
        "text": "نشاط تجريبي لعرض سجل المتابعة."
      },
      {
        "type": "call",
        "date": "2026-10-18 11:30",
        "text": "نشاط تجريبي لعرض سجل المتابعة."
      }
    ]
  },
  {
    "id": "deal_2",
    "companyName": "شركة تجريبية 2",
    "contactPerson": "جهة اتصال تجريبية 2",
    "contactPhone": "0000000000",
    "contactEmail": "client2@example.com",
    "contractType": "retainer",
    "primaryService": "content_management",
    "services": [
      "content_management",
      "digital_ads",
      "video_production"
    ],
    "dealValue": 35000,
    "currency": "ج.م",
    "stage": "won",
    "market": "egypt",
    "source": "meta_ads",
    "date": "2026-10-12",
    "notes": "بيانات اصطناعية لعرض وظائف النظام فقط.",
    "tasks": [
      {
        "id": "t4",
        "title": "جلسة تصوير المحتوى الشهري مع أطباء الفرع",
        "text": "جلسة تصوير المحتوى الشهري مع أطباء الفرع",
        "assignee": "يوسف الخولي",
        "tool": "كانفا / أدوبي (Canva / Adobe)",
        "dueDate": "2026-10-16",
        "priority": "عالية",
        "status": "done",
        "done": true
      },
      {
        "id": "t5",
        "title": "صياغة زوايا إعلانات حجوزات تبييض الأسنان",
        "text": "صياغة زوايا إعلانات حجوزات تبييض الأسنان",
        "assignee": "مؤمن النوساني",
        "tool": "كلود (Claude)",
        "dueDate": "2026-10-17",
        "priority": "عالية",
        "status": "done",
        "done": true
      },
      {
        "id": "t6",
        "title": "إرسال جدول المواعيد المتاحة للأطباء",
        "text": "إرسال جدول المواعيد المتاحة للأطباء",
        "assignee": "العميل",
        "tool": "تواصل مع العميل",
        "dueDate": "2026-10-18",
        "priority": "عادية",
        "status": "done",
        "done": true
      }
    ],
    "activities": [
      {
        "type": "meeting",
        "date": "2026-10-17 15:00",
        "text": "نشاط تجريبي لعرض سجل المتابعة."
      }
    ]
  },
  {
    "id": "deal_3",
    "companyName": "شركة تجريبية 3",
    "contactPerson": "جهة اتصال تجريبية 3",
    "contactPhone": "0000000000",
    "contactEmail": "client3@example.com",
    "contractType": "project",
    "primaryService": "company_profile",
    "services": [
      "company_profile",
      "branding"
    ],
    "dealValue": 28000,
    "currency": "ج.م",
    "stage": "proposal",
    "market": "egypt",
    "source": "website",
    "date": "2026-10-21",
    "notes": "بيانات اصطناعية لعرض وظائف النظام فقط.",
    "tasks": [
      {
        "id": "t7",
        "title": "صياغة المحتوى المؤسسي ورسالة المصنع",
        "text": "صياغة المحتوى المؤسسي ورسالة المصنع",
        "assignee": "مؤمن النوساني",
        "tool": "كلود (Claude)",
        "dueDate": "2026-10-26",
        "priority": "عالية",
        "status": "done",
        "done": true
      },
      {
        "id": "t8",
        "title": "تصميم قوالب البروفايل بالهوية الجديدة",
        "text": "تصميم قوالب البروفايل بالهوية الجديدة",
        "assignee": "يوسف الخولي",
        "tool": "كانفا / أدوبي (Canva / Adobe)",
        "dueDate": "2026-10-28",
        "priority": "عالية",
        "status": "in_progress",
        "done": false
      },
      {
        "id": "t9",
        "title": "تزويد صور خطوط الإنتاج والشهادات الصناعية",
        "text": "تزويد صور خطوط الإنتاج والشهادات الصناعية",
        "assignee": "العميل",
        "tool": "تواصل مع العميل",
        "dueDate": "2026-10-29",
        "priority": "عالية",
        "status": "todo",
        "done": false
      }
    ],
    "activities": [
      {
        "type": "proposal",
        "date": "2026-10-22 13:00",
        "text": "نشاط تجريبي لعرض سجل المتابعة."
      }
    ]
  },
  {
    "id": "deal_4",
    "companyName": "شركة تجريبية 4",
    "contactPerson": "جهة اتصال تجريبية 4",
    "contactPhone": "0000000000",
    "contactEmail": "client4@example.com",
    "contractType": "project",
    "primaryService": "web_dev",
    "services": [
      "web_dev",
      "automation_crm"
    ],
    "dealValue": 55000,
    "currency": "ر.س",
    "stage": "discovery",
    "market": "gulf",
    "source": "whatsapp",
    "date": "2026-10-22",
    "notes": "بيانات اصطناعية لعرض وظائف النظام فقط.",
    "tasks": [
      {
        "id": "t10",
        "title": "هيكلة تدفق تجربة المستخدم وحاسبة الأسعار",
        "text": "هيكلة تدفق تجربة المستخدم وحاسبة الأسعار",
        "assignee": "مؤمن النوساني",
        "tool": "شات جي بي تي (ChatGPT)",
        "dueDate": "2026-10-27",
        "priority": "عالية",
        "status": "in_progress",
        "done": false
      },
      {
        "id": "t11",
        "title": "برمجة واجهة حاسبة الشحن وربط الـ API",
        "text": "برمجة واجهة حاسبة الشحن وربط الـ API",
        "assignee": "يوسف الخولي",
        "tool": "انتي جرافتي (Antigravity)",
        "dueDate": "2026-10-31",
        "priority": "عالية",
        "status": "todo",
        "done": false
      }
    ],
    "activities": [
      {
        "type": "whatsapp",
        "date": "2026-10-22 16:40",
        "text": "نشاط تجريبي لعرض سجل المتابعة."
      }
    ]
  },
  {
    "id": "deal_5",
    "companyName": "شركة تجريبية 5",
    "contactPerson": "جهة اتصال تجريبية 5",
    "contactPhone": "0000000000",
    "contactEmail": "client5@example.com",
    "contractType": "retainer",
    "primaryService": "automation_crm",
    "services": [
      "automation_crm",
      "growth_strategy"
    ],
    "dealValue": 40000,
    "currency": "ج.م",
    "stage": "new_lead",
    "market": "egypt",
    "source": "google_ads",
    "date": "2026-10-23",
    "notes": "بيانات اصطناعية لعرض وظائف النظام فقط.",
    "tasks": [
      {
        "id": "t12",
        "title": "الاتصال لفهم مسار استقبال العملاء والتحديات",
        "text": "الاتصال لفهم مسار استقبال العملاء والتحديات",
        "assignee": "مؤمن النوساني",
        "tool": "كلود (Claude)",
        "dueDate": "2026-10-24",
        "priority": "عالية",
        "status": "todo",
        "done": false
      },
      {
        "id": "t13",
        "title": "تجهيز مسار الرد التلقائي وحساب الـ Webhook",
        "text": "تجهيز مسار الرد التلقائي وحساب الـ Webhook",
        "assignee": "يوسف الخولي",
        "tool": "انتي جرافتي (Antigravity)",
        "dueDate": "2026-10-28",
        "priority": "متوسطة",
        "status": "todo",
        "done": false
      }
    ],
    "activities": [
      {
        "type": "note",
        "date": "2026-10-23 08:30",
        "text": "نشاط تجريبي لعرض سجل المتابعة."
      }
    ]
  },
  {
    "id": "deal_6",
    "companyName": "شركة تجريبية 6",
    "contactPerson": "جهة اتصال تجريبية 6",
    "contactPhone": "0000000000",
    "contactEmail": "client6@example.com",
    "contractType": "project",
    "primaryService": "branding",
    "services": [
      "branding",
      "company_profile"
    ],
    "dealValue": 32000,
    "currency": "ج.م",
    "stage": "won",
    "market": "egypt",
    "source": "referral",
    "date": "2026-10-05",
    "notes": "بيانات اصطناعية لعرض وظائف النظام فقط.",
    "tasks": [
      {
        "id": "t14",
        "title": "تسليم الدليل الإرشادي الكامل للهوية البصرية",
        "text": "تسليم الدليل الإرشادي الكامل للهوية البصرية",
        "assignee": "يوسف الخولي",
        "tool": "كانفا / أدوبي (Canva / Adobe)",
        "dueDate": "2026-10-20",
        "priority": "عالية",
        "status": "done",
        "done": true
      },
      {
        "id": "t15",
        "title": "اعتماد المطبوعات والتوقيع على محضر التسليم",
        "text": "اعتماد المطبوعات والتوقيع على محضر التسليم",
        "assignee": "العميل",
        "tool": "تواصل مع العميل",
        "dueDate": "2026-10-21",
        "priority": "متوسطة",
        "status": "done",
        "done": true
      }
    ],
    "activities": [
      {
        "type": "meeting",
        "date": "2026-10-05 11:00",
        "text": "نشاط تجريبي لعرض سجل المتابعة."
      }
    ]
  },
  {
    "id": "deal_7",
    "companyName": "شركة تجريبية 7",
    "contactPerson": "جهة اتصال تجريبية 7",
    "contactPhone": "0000000000",
    "contactEmail": "client7@example.com",
    "contractType": "retainer",
    "primaryService": "growth_strategy",
    "services": [
      "growth_strategy",
      "web_dev"
    ],
    "dealValue": 70000,
    "currency": "ج.م",
    "stage": "discovery",
    "market": "egypt",
    "source": "referral",
    "date": "2026-10-19",
    "notes": "بيانات اصطناعية لعرض وظائف النظام فقط.",
    "tasks": [
      {
        "id": "t16",
        "title": "إعداد تقرير دراسة المنافسين وسلاسل التوريد",
        "text": "إعداد تقرير دراسة المنافسين وسلاسل التوريد",
        "assignee": "مؤمن النوساني",
        "tool": "كلود (Claude)",
        "dueDate": "2026-10-26",
        "priority": "عالية",
        "status": "in_progress",
        "done": false
      },
      {
        "id": "t17",
        "title": "تجهيز مسودة هيكل الموقع الجديد",
        "text": "تجهيز مسودة هيكل الموقع الجديد",
        "assignee": "يوسف الخولي",
        "tool": "انتي جرافتي (Antigravity)",
        "dueDate": "2026-10-29",
        "priority": "متوسطة",
        "status": "todo",
        "done": false
      }
    ],
    "activities": [
      {
        "type": "meeting",
        "date": "2026-10-19 14:00",
        "text": "نشاط تجريبي لعرض سجل المتابعة."
      }
    ]
  }
];

    // --- APPLICATION STATE ---
    // --- DEFAULT TEAM USERS & PERMISSIONS ARCHITECTURE ---
    const DEFAULT_TEAM_USERS = [
      {
        id: 'moamen',
        username: 'moamen',
        password: 'demo-admin-only',
        name: 'مؤمن النوساني',
        role: 'admin',
        roleLabel: 'المدير العام والمسؤول التنفيذي (Super Admin)',
        avatar: '👑',
        canViewFinancials: true,
        isReadOnly: false,
        canCreateDeals: true,
        canEditDeals: true,
        canDeleteDeals: true,
        canCreateProposals: true,
        canExportCsv: true,
        canAccessIntegrations: true,
        canManageRoles: true
      },
      {
        id: 'youssef',
        username: 'youssef',
        password: 'demo-member-only',
        name: 'يوسف الخولي',
        role: 'member',
        roleLabel: 'مسؤول النمو والتنفيذ الرقمي (Team Specialist)',
        avatar: '🚀',
        canViewFinancials: false, // Default: Hidden financial figures for team members
        isReadOnly: false,
        canCreateDeals: true,
        canEditDeals: true,
        canDeleteDeals: false,
        canCreateProposals: true,
        canExportCsv: false,
        canAccessIntegrations: false,
        canManageRoles: false
      }
    ];

    let teamUsers = [];
    let currentUserId = 'moamen';

    function loadUsers() {
      try { teamUsers = userStore.load(() => CrmCore.clone(DEFAULT_TEAM_USERS)); return true; }
      catch (error) { teamUsers = []; reportPersistenceError(error); return false; }
    }

    function saveUsers() {
      try {
        if (!canManageTeam()) throw new CrmCore.StorageError('غير مسموح لهذا الحساب بتغيير مستخدمي الفريق.', 'TEAM_PERMISSION');
        userStore.save(teamUsers);
      }
      catch (error) { teamUsers = userStore.snapshot() || []; reportPersistenceError(error); throw error; }
    }

    function getCurrentUser() {
      return teamUsers.find(u => u.id === currentUserId) || teamUsers[0] || DEFAULT_TEAM_USERS[0];
    }

    function getCurrentUserPermissions() {
      const u = getCurrentUser();
      return u || DEFAULT_TEAM_USERS[0];
    }

    // Helper functions for financial formatting & masking
    function formatFinancialValue(value, currency = 'ج.م', isRetainer = false) {
      const perms = getCurrentUserPermissions();
      if (!perms.canViewFinancials) {
        return '<span class="font-mono text-slate-400 font-semibold text-[11px]" title="المعلومات المالية مخفية حسب صلاحياتك الحالية">•••••• (مخفي)</span>';
      }
      const formatted = Number(value || 0).toLocaleString('ar-EG');
      return `${formatted} ${currency}${isRetainer ? ' / شهرياً' : ''}`;
    }

    function getFinancialText(value, currency = 'ج.م', suffix = '') {
      const perms = getCurrentUserPermissions();
      if (!perms.canViewFinancials) {
        return '•••••• (مخفي)';
      }
      return `${Number(value || 0).toLocaleString('ar-EG')} ${currency}${suffix}`;
    }

    function getTeamMembers() {
      return [...teamUsers.map(user=>({id:user.id,name:user.name,role:user.roleLabel||'عضو الفريق',icon:user.avatar||'👤'})),{id:'client',name:'العميل',role:'مراجعات واعتمادات العميل',icon:'🏢'},{id:'unassigned',name:'غير مسندة',role:'مهام تحتاج مسؤولًا',icon:'📌'},{id:'all',name:'جميع المكلفين',role:'نسبة الإنجاز الإجمالية',icon:'👥'}];
    }
    function taskOwnerId(task) {
      if(task.assigneeUserId || task.assigneeId) return teamUsers.some(user=>user.id===(task.assigneeUserId||task.assigneeId)) ? (task.assigneeUserId||task.assigneeId) : 'unassigned';
      if(task.assignee==='العميل')return 'client';
      return teamUsers.find(user=>user.name===(task.assignee||'').trim()||user.id===task.assignee)?.id || 'unassigned';
    }
    function populateAssigneeSelects() {
      for(const id of ['filterTaskAssignee','taskAssigneeSelect']){
        const select=document.getElementById(id);if(!select)continue;const previous=select.value;select.replaceChildren();
        for(const member of getTeamMembers().filter(member=>id==='filterTaskAssignee'||member.id!=='all')){const option=document.createElement('option');option.value=member.id;option.textContent=member.name;select.appendChild(option)}
        select.value=[...select.options].some(option=>option.value===previous)?previous:(id==='filterTaskAssignee'?'all':getCurrentUser().id);
      }
    }
    let activeTeamMember = 'moamen';
    let selectedDealServices = ['growth_strategy'];
    let deals = [];
    let currentActiveDealId = null;
    let stageChartInstance = null;
    let contractChartInstance = null;
    let servicesChartInstance = null;

    // --- STORAGE HELPERS ---
    function loadDeals() {
      try { deals = dealStore.load(() => CrmCore.clone(INITIAL_DEALS)); return true; }
      catch (error) { deals = []; reportPersistenceError(error); return false; }
    }

    function saveDeals() {
      try { ContentPlans.prepareChanges(dealStore.snapshot() || [], deals); dealStore.save(deals); setStorageHealth('تم حفظ التعديل محليًا.'); }
      catch (error) { deals = dealStore.snapshot() || []; reportPersistenceError(error); throw error; }
    }

    function showToast(message, type = 'success') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      const isSuccess = type === 'success';
      toast.className = `pointer-events-auto transform transition-all duration-300 ease-out flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl text-xs font-bold text-white ${isSuccess ? 'bg-slate-900 border border-slate-700' : 'bg-rose-600'}`;
      
      const iconSvg = isSuccess 
        ? `<svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>`
        : `<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;

      toast.innerHTML = iconSvg;
      const messageSpan = document.createElement('span');
      messageSpan.textContent = message;
      toast.appendChild(messageSpan);
      container.appendChild(toast);

      setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }

    // --- UI NAVIGATION ---
    
    // --- PERMISSIONS ENFORCEMENT & UI LOCKS ---
    function updateUIForCurrentPermissions() {
      const perms = getCurrentUserPermissions();
      const user = getCurrentUser();
      ContentPlans.resetIdentity();
      populateAssigneeSelects();
      for (const id of ['backupDealsBtn','restoreDealsBtn','restoreRecoveryBtn','exportRawBtn','autoGenerateTasksBtn']) {
        const button = document.getElementById(id); if (button) button.hidden = user.role !== 'admin';
      }
      const assigneeFilter = document.getElementById('filterTaskAssignee');
      if (assigneeFilter) { assigneeFilter.disabled = user.role !== 'admin'; assigneeFilter.value = user.role === 'admin' ? 'all' : user.id; }

      // 1. Update Header User Switcher UI (Desktop & Mobile)
      const iconEl = document.getElementById('activeUserBadgeIcon');
      if (iconEl) iconEl.textContent = user.avatar || '👤';
      const nameEl = document.getElementById('activeUserDisplayName');
      if (nameEl) nameEl.textContent = `${user.name} (${user.role === 'admin' ? 'المدير العام' : 'عضو فريق'})`;
      const selectEl = document.getElementById('activeUserSelector');
      if (selectEl && selectEl.value !== user.id) selectEl.value = user.id;

      // Mobile Top Bar User Chip
      const mobAvatar = document.getElementById('mobileUserAvatarSpan');
      if (mobAvatar) mobAvatar.textContent = user.avatar || '👤';
      const mobName = document.getElementById('mobileUserNameSpan');
      if (mobName) mobName.textContent = user.name.split(' ')[0] || user.name;

      // Mobile User Modal Elements
      const mModalIcon = document.getElementById('mobileModalUserIcon');
      if (mModalIcon) mModalIcon.textContent = user.avatar || '👤';
      const mModalName = document.getElementById('mobileModalUserName');
      if (mModalName) mModalName.textContent = user.name;
      const mModalRole = document.getElementById('mobileModalUserRole');
      if (mModalRole) mModalRole.textContent = user.role === 'admin' ? 'المدير العام (Admin) - كامل الصلاحيات' : 'عضو فريق (Member)';

      // Active Indicators in Mobile User Switcher
      const indMoamen = document.querySelector('.active-indicator-moamen');
      const indYoussef = document.querySelector('.active-indicator-youssef');
      if (indMoamen && indYoussef) {
        if (user.id === 'moamen') {
          indMoamen.classList.remove('hidden');
          indYoussef.classList.add('hidden');
        } else {
          indMoamen.classList.add('hidden');
          indYoussef.classList.remove('hidden');
        }
      }

      // 2. Add Deal Button Lock
      const addDealBtn = document.getElementById('openAddDealModalBtn');
      if (addDealBtn) {
        if (!perms.canCreateDeals || perms.isReadOnly) {
          addDealBtn.classList.add('opacity-40', 'cursor-not-allowed');
          addDealBtn.title = 'حسابك في وضع القراءة فقط أو غير مصرح بإنشاء صفقات';
        } else {
          addDealBtn.classList.remove('opacity-40', 'cursor-not-allowed');
          addDealBtn.title = 'إضافة صفقة جديدة';
        }
      }

      // 3. Export CSV Button Lock
      const exportBtn = document.getElementById('exportCsvBtn');
      if (exportBtn) {
        if (!perms.canExportCsv || perms.isReadOnly) {
          exportBtn.classList.add('opacity-40', 'cursor-not-allowed');
          exportBtn.title = 'تصدير البيانات مقيد بصلاحية المدير العام مؤمن النوساني';
        } else {
          exportBtn.classList.remove('opacity-40', 'cursor-not-allowed');
          exportBtn.title = 'تصدير إلى CSV';
        }
      }

      // 4. Details Modal Buttons (Edit / Delete)
      const detailEdit = document.getElementById('detailEditBtn');
      if (detailEdit) {
        if (!perms.canEditDeals || perms.isReadOnly) {
          detailEdit.classList.add('opacity-40', 'cursor-not-allowed');
          detailEdit.title = 'تعديل البيانات مقفل حسب صلاحياتك';
        } else {
          detailEdit.classList.remove('opacity-40', 'cursor-not-allowed');
          detailEdit.title = 'تعديل البيانات';
        }
      }

      const detailDel = document.getElementById('detailDeleteBtn');
      if (detailDel) {
        if (!perms.canDeleteDeals || perms.isReadOnly) {
          detailDel.classList.add('opacity-40', 'cursor-not-allowed');
          detailDel.title = 'حذف الصفقات متاح للمدير العام مؤمن النوساني فقط';
        } else {
          detailDel.classList.remove('opacity-40', 'cursor-not-allowed');
          detailDel.title = 'حذف الصفقة';
        }
      }

      // 5. Hide Roles Tab & User Switcher from non-admin users (Youssef and others)
      const rolesTabBtn = document.getElementById('navRolesTabBtn');
      if (rolesTabBtn) {
        if (user.role !== 'admin') {
          rolesTabBtn.classList.add('hidden');
        } else {
          rolesTabBtn.classList.remove('hidden');
        }
      }

      const userSelector = document.getElementById('activeUserSelector');
      if (userSelector) {
        if (user.role !== 'admin') {
          userSelector.classList.add('hidden');
        } else {
          userSelector.classList.remove('hidden');
        }
      }
      const manager = canManageTeam();
      for (const control of document.querySelectorAll('#openAddUserModalBtn, #navRolesTabBtn, [data-sheet-tab="roles"]')) {
        control.setAttribute('data-admin-only', '');
        control.hidden = !manager;
        control.disabled = !manager;
      }
      document.querySelectorAll('option[value="roles"]').forEach(option => { option.hidden = !manager; option.disabled = !manager; });
      if (!manager) {
        const roles = document.getElementById('rolesView');
        const wasOpen = roles && !roles.classList.contains('hidden');
        if (roles) roles.classList.add('hidden');
        document.getElementById('usersRolesListContainer').replaceChildren();
        document.getElementById('addUserModal').classList.add('hidden');
        document.getElementById('changePasswordModal').classList.add('hidden');
        document.getElementById('addUserForm').reset();
        if (wasOpen) activateTab('teamTasks');
      }
    }

    
    // --- RENDER ROLES & PERMISSIONS DASHBOARD ---
    function renderRolesDashboard() {
      const container = document.getElementById('usersRolesListContainer');
      if (!container) return;
      container.innerHTML = '';
      if (!canManageTeam()) return;

      teamUsers.forEach(user => {
        const isAdmin = user.role === 'admin';
        const card = document.createElement('div');
        card.className = `bg-white rounded-2xl border p-5 transition shadow-sm ${
          isAdmin ? 'border-purple-300 ring-1 ring-purple-200' : 'border-slate-200'
        }`;

        card.innerHTML = `
          <div class="flex flex-wrap items-center justify-between pb-4 border-b border-slate-100 gap-3">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${
                isAdmin ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
              }">
                ${escapeHtml(user.avatar || '👤')}
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="font-extrabold text-sm text-slate-900">${escapeHtml(user.name)}</h3>
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    isAdmin ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-blue-100 text-blue-700 border border-blue-200'
                  }">
                    ${isAdmin ? 'المدير العام (Super Admin)' : 'عضو فريق (Team Member)'}
                  </span>
                </div>
                <p class="text-xs text-slate-500 mt-0.5">${escapeHtml(user.roleLabel || 'فريق عمل AdVance')}</p>
                <div class="mt-2 flex flex-wrap items-center gap-3 text-xs bg-slate-50 p-2 rounded-lg border border-slate-200">
                  <div class="flex items-center gap-1.5">
                    <span class="text-slate-500 font-semibold text-[11px]">اسم المستخدم:</span>
                    <code class="font-mono font-bold text-blue-700 bg-white px-2 py-0.5 rounded border border-blue-200 text-xs">${escapeHtml(user.username || user.id)}</code>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <span class="text-slate-500 font-semibold text-[11px]">كلمة المرور:</span>
                    <span class="font-mono font-bold text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200 text-xs pwd-val-span" id="pwdDisplay_${user.id}">••••••••</span>
                    <button type="button" class="text-[10px] text-blue-600 hover:text-blue-800 font-bold toggle-show-pwd-btn mr-1" data-user="${user.id}">👁️ كشف</button>
                    <button type="button" class="text-[10px] text-slate-600 hover:text-slate-900 font-bold change-pwd-btn mr-1" data-user="${user.id}">✏️ تغيير</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <button class="test-user-view-btn text-xs font-bold px-3 py-1.5 rounded-lg border transition flex items-center gap-1.5 ${
                currentUserId === user.id ? 'bg-blue-600 text-white border-blue-600 shadow' : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
              }" data-user-id="${user.id}">
                ${currentUserId === user.id ? '✓ الحساب النشط الآن' : '👁️ تجربة النظام بصلاحياته'}
              </button>
            </div>
          </div>

          <!-- Permissions Switches Matrix -->
          <div class="mt-4">
            <h4 class="text-xs font-bold text-slate-700 mb-3 flex items-center justify-between">
              <span>الصلاحيات والتحكم في الوصول:</span>
              ${isAdmin ? '<span class="text-[11px] font-bold text-purple-700">كامل الصلاحيات مفعلة تلقائياً للمدير العام</span>' : '<span class="text-[11px] text-slate-400">يمكنك تعديل أي صلاحية وستطبق فوراً</span>'}
            </h4>

            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <!-- Perm 1: Financials -->
              <div class="p-3 rounded-xl border ${user.canViewFinancials ? 'bg-emerald-50/50 border-emerald-200' : 'bg-slate-50 border-slate-200'} flex items-center justify-between">
                <div>
                  <span class="font-bold text-slate-800 block">👁️ البيانات المالية</span>
                  <span class="text-[10px] text-slate-500">${user.canViewFinancials ? 'مبالغ الصفقات ظاهرة' : 'المبالغ مخفية ••••••'}</span>
                </div>
                <label class="relative inline-flex items-center ${isAdmin ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}">
                  <input type="checkbox" ${user.canViewFinancials ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} class="sr-only peer role-perm-toggle" data-user="${user.id}" data-perm="canViewFinancials">
                  <div class="w-8 h-4 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              <!-- Perm 2: Read Only -->
              <div class="p-3 rounded-xl border ${user.isReadOnly ? 'bg-amber-50/50 border-amber-200' : 'bg-slate-50 border-slate-200'} flex items-center justify-between">
                <div>
                  <span class="font-bold text-slate-800 block">🔒 وضع القراءة فقط</span>
                  <span class="text-[10px] text-slate-500">${user.isReadOnly ? 'قراءة ومتابعة فقط' : 'تفاعل وتعديل كامل'}</span>
                </div>
                <label class="relative inline-flex items-center ${isAdmin ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}">
                  <input type="checkbox" ${user.isReadOnly ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} class="sr-only peer role-perm-toggle" data-user="${user.id}" data-perm="isReadOnly">
                  <div class="w-8 h-4 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-600"></div>
                </label>
              </div>

              <!-- Perm 3: Create Deals -->
              <div class="p-3 rounded-xl border ${user.canCreateDeals ? 'bg-blue-50/50 border-blue-200' : 'bg-slate-50 border-slate-200'} flex items-center justify-between">
                <div>
                  <span class="font-bold text-slate-800 block">➕ إضافة صفقات</span>
                  <span class="text-[10px] text-slate-500">${user.canCreateDeals ? 'مسموح بإضافة عملاء' : 'غير مصرح'}</span>
                </div>
                <label class="relative inline-flex items-center ${isAdmin ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}">
                  <input type="checkbox" ${user.canCreateDeals ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} class="sr-only peer role-perm-toggle" data-user="${user.id}" data-perm="canCreateDeals">
                  <div class="w-8 h-4 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <!-- Perm 4: Edit Deals -->
              <div class="p-3 rounded-xl border ${user.canEditDeals ? 'bg-blue-50/50 border-blue-200' : 'bg-slate-50 border-slate-200'} flex items-center justify-between">
                <div>
                  <span class="font-bold text-slate-800 block">✏️ تعديل الصفقات</span>
                  <span class="text-[10px] text-slate-500">${user.canEditDeals ? 'تعديل البيانات' : 'قراءة فقط'}</span>
                </div>
                <label class="relative inline-flex items-center ${isAdmin ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}">
                  <input type="checkbox" ${user.canEditDeals ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} class="sr-only peer role-perm-toggle" data-user="${user.id}" data-perm="canEditDeals">
                  <div class="w-8 h-4 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <!-- Perm 5: Delete Deals -->
              <div class="p-3 rounded-xl border ${user.canDeleteDeals ? 'bg-rose-50/50 border-rose-200' : 'bg-slate-50 border-slate-200'} flex items-center justify-between">
                <div>
                  <span class="font-bold text-slate-800 block">🗑️ حذف الصفقات</span>
                  <span class="text-[10px] text-slate-500">${user.canDeleteDeals ? 'صلاحية الحذف مفعلة' : 'الحذف ممنوع'}</span>
                </div>
                <label class="relative inline-flex items-center ${isAdmin ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}">
                  <input type="checkbox" ${user.canDeleteDeals ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} class="sr-only peer role-perm-toggle" data-user="${user.id}" data-perm="canDeleteDeals">
                  <div class="w-8 h-4 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-rose-600"></div>
                </label>
              </div>

              <!-- Perm 6: Proposals -->
              <div class="p-3 rounded-xl border ${user.canCreateProposals ? 'bg-purple-50/50 border-purple-200' : 'bg-slate-50 border-slate-200'} flex items-center justify-between">
                <div>
                  <span class="font-bold text-slate-800 block">📄 عروض الأسعار</span>
                  <span class="text-[10px] text-slate-500">${user.canCreateProposals ? 'توليد وطباعة العروض' : 'ممنوع'}</span>
                </div>
                <label class="relative inline-flex items-center ${isAdmin ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}">
                  <input type="checkbox" ${user.canCreateProposals ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} class="sr-only peer role-perm-toggle" data-user="${user.id}" data-perm="canCreateProposals">
                  <div class="w-8 h-4 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>

              <!-- Perm 7: Export CSV -->
              <div class="p-3 rounded-xl border ${user.canExportCsv ? 'bg-slate-100 border-slate-300' : 'bg-slate-50 border-slate-200'} flex items-center justify-between">
                <div>
                  <span class="font-bold text-slate-800 block">📥 تصدير CSV</span>
                  <span class="text-[10px] text-slate-500">${user.canExportCsv ? 'تحميل القواعد مسموح' : 'التصدير محظور'}</span>
                </div>
                <label class="relative inline-flex items-center ${isAdmin ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}">
                  <input type="checkbox" ${user.canExportCsv ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} class="sr-only peer role-perm-toggle" data-user="${user.id}" data-perm="canExportCsv">
                  <div class="w-8 h-4 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-slate-800"></div>
                </label>
              </div>

              <!-- Perm 8: Integrations -->
              <div class="p-3 rounded-xl border ${user.canAccessIntegrations ? 'bg-sky-50/50 border-sky-200' : 'bg-slate-50 border-slate-200'} flex items-center justify-between">
                <div>
                  <span class="font-bold text-slate-800 block">🔌 الربط وهستنجر</span>
                  <span class="text-[10px] text-slate-500">${user.canAccessIntegrations ? 'الوصول للـ API' : 'محظور'}</span>
                </div>
                <label class="relative inline-flex items-center ${isAdmin ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}">
                  <input type="checkbox" ${user.canAccessIntegrations ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} class="sr-only peer role-perm-toggle" data-user="${user.id}" data-perm="canAccessIntegrations">
                  <div class="w-8 h-4 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-sky-600"></div>
                </label>
              </div>
            </div>
          </div>
        `;

        container.appendChild(card);
      });

      // Attach Toggle Listeners
      container.querySelectorAll('.role-perm-toggle').forEach(chk => {
        chk.addEventListener('change', (e) => {
          if (!requireTeamManager()) return;
          const userId = e.target.dataset.user;
          const permName = e.target.dataset.perm;
          const targetUser = teamUsers.find(u => u.id === userId);
          if (targetUser && targetUser.role !== 'admin') {
            targetUser[permName] = e.target.checked;
            saveUsers();
            updateUIForCurrentPermissions();
            renderRolesDashboard();
            renderKanban();
            renderContactsTable();
            renderDashboard();
            showToast(`تم تحديث صلاحية "${permName}" لـ ${targetUser.name}`);
          }
        });
      });

      // Attach Switch View Listeners
      container.querySelectorAll('.test-user-view-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const userId = btn.dataset.userId;
          switchActiveUser(userId);
        });
      });

      // Password reveal toggle
      container.querySelectorAll('.toggle-show-pwd-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!requireTeamManager()) return;
          const uid = btn.dataset.user;
          const user = teamUsers.find(u => u.id === uid);
          const displayEl = document.getElementById(`pwdDisplay_${uid}`);
          if (displayEl && user) {
            if (displayEl.textContent === '••••••••') {
              displayEl.textContent = user.password || 'demo-admin-only';
              btn.textContent = '🔒 إخفاء';
            } else {
              displayEl.textContent = '••••••••';
              btn.textContent = '👁️ كشف';
            }
          }
        });
      });

      // Change password
      container.querySelectorAll('.change-pwd-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!requireTeamManager()) return;
          const uid = btn.dataset.user;
          const user = teamUsers.find(u => u.id === uid);
          if (!user) return;
          const currentPerms = getCurrentUserPermissions();
          if (currentPerms.role !== 'admin' && currentPerms.id !== user.id) {
            showToast('تغيير كلمة المرور متاح للمدير العام مؤمن النوساني فقط');
            return;
          }
          document.getElementById('changePasswordUserId').value = user.id;
          document.getElementById('changePasswordModalTitle').textContent = `تغيير كلمة المرور لـ: ${user.name}`;
          document.getElementById('newPasswordInput').value = '';
          document.getElementById('changePasswordModal').classList.remove('hidden');
        });
      });
    }

    function switchActiveUser(userId) {
      const currentU = getCurrentUser();
      if (currentU.role !== 'admin' && userId !== currentU.id) {
        showToast('غير مصرح لك بالتبديل إلى حساب المدير العام مؤمن النوساني', 'error');
        return;
      }
      const targetUser = teamUsers.find(u => u.id === userId);
      if (!targetUser) return;
      document.getElementById('detailsModal').classList.add('hidden');
      document.getElementById('dealTasksList').textContent = '';
      for (const id of ['memberTasksTableBody','memberTasksMobileList','masterTasksTableBody','masterTasksMobileList']) document.getElementById(id).textContent = '';
      currentUserId = userId;
      try { window.sessionStorage.setItem('advance_crm_repair_session_v1', userId); }
      catch { showToast('تم تبديل العرض لهذه الصفحة؛ تعذر حفظ الحساب لإعادة التحميل.', 'error'); }
      updateUIForCurrentPermissions();
      renderRolesDashboard();
      renderKanban();
      renderContactsTable();
      renderDashboard();
      renderProjectsView();
      if (document.getElementById('teamTasksView') && !document.getElementById('teamTasksView').classList.contains('hidden')) {
        renderTeamTasksView();
      }
      showToast(`تم التبديل بنجاح إلى حساب: ${targetUser.name} (${targetUser.role === 'admin' ? 'كامل الصلاحيات' : 'صلاحيات محددة'})`);
    }

    function populateUserSwitcherSelect() {
      const sel = document.getElementById('activeUserSelector');
      if (!sel) return;
      sel.innerHTML = '';
      teamUsers.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = `${u.avatar || '👤'} ${u.name} (${u.role === 'admin' ? 'المدير العام' : 'عضو فريق'})`;
        sel.appendChild(opt);
      });
      sel.value = currentUserId;
    }

    function activateTab(tabName) {
      const user = getCurrentUser();
      if ((tabName === 'roles' && !canManageTeam()) || (tabName === 'integrations' && !user?.canAccessIntegrations)) {
        showToast('هذا القسم غير مسموح للحساب الحالي.', 'error'); return;
      }
      const tabs = document.querySelectorAll('.nav-tab');
      const mobileTabs = document.querySelectorAll('.mobile-nav-tab');
      const contents = document.querySelectorAll('.tab-content');

      tabs.forEach(t => {
        if (t.dataset.tab === tabName) {
          t.classList.add('active-tab', 'bg-blue-600', 'text-white');
          t.classList.remove('text-slate-300', 'hover:bg-slate-800');
        } else {
          t.classList.remove('active-tab', 'bg-blue-600', 'text-white');
          t.classList.add('text-slate-300', 'hover:text-white', 'hover:bg-slate-800');
        }
      });

      mobileTabs.forEach(mt => {
        if (mt.dataset.tab === tabName) {
          mt.classList.add('text-sky-400', 'font-bold');
          mt.classList.remove('text-slate-400');
        } else {
          mt.classList.remove('text-sky-400', 'font-bold');
          mt.classList.add('text-slate-400');
        }
      });

      // Sync Dropdown Selectors (Desktop & Mobile)
      const mainNavSel = document.getElementById('mainNavSelectDropdown');
      if (mainNavSel) mainNavSel.value = tabName;
      const mobNavSel = document.getElementById('mobileNavSelectDropdown');
      if (mobNavSel) mobNavSel.value = tabName;

      // Update Desktop Dropdown Trigger Button Info
      const tabInfo = {
        kanban: { icon: '💼', title: 'مسار الصفقات (Pipeline)', badge: `${deals.length} صفقات` },
        projects: { icon: '🚀', title: 'إدارة المشروعات والمهام', badge: 'نشط' },
        teamTasks: { icon: '🎯', title: 'لوحة مهام الفريق', badge: 'مؤمن/يوسف' },
        dashboard: { icon: '📈', title: 'لوحة المؤشرات والتحليلات', badge: 'إحصائيات' },
        contacts: { icon: '🏢', title: 'دليل الشركات والعملاء', badge: `${deals.length} جهات` },
        automations: { icon: '⚡', title: 'الأتمتة وWhatsApp CRM', badge: 'مُفعل' },
        integrations: { icon: '🔌', title: 'مركز التكامل والربط', badge: 'API' },
        roles: { icon: '🛡️', title: 'إدارة الصلاحيات (Admin)', badge: 'آدمن' }
      };

      const curInfo = tabInfo[tabName] || tabInfo.kanban;
      const actIcon = document.getElementById('desktopActiveNavIcon');
      if (actIcon) actIcon.textContent = curInfo.icon;
      const actTitle = document.getElementById('desktopActiveNavTitle');
      if (actTitle) actTitle.textContent = curInfo.title;
      const actBadge = document.getElementById('desktopActiveNavBadge');
      if (actBadge) actBadge.textContent = curInfo.badge;

      // Highlight active item in desktop dropdown menu
      document.querySelectorAll('.nav-dropdown-item').forEach(item => {
        if (item.dataset.tab === tabName) {
          item.classList.add('bg-blue-600', 'text-white');
          item.classList.remove('text-slate-200');
        } else {
          item.classList.remove('bg-blue-600', 'text-white');
          item.classList.add('text-slate-200');
        }
      });

      const targetId = tabName + 'View';
      contents.forEach(content => {
        if (content.id === targetId) {
          content.classList.remove('hidden');
        } else {
          content.classList.add('hidden');
        }
      });

      if (tabName === 'dashboard') {
        renderDashboard();
      } else if (tabName === 'contacts') {
        renderContactsTable();
      } else if (tabName === 'kanban') {
        renderKanban();
      } else if (tabName === 'projects') {
        renderProjectsView();
      } else if (tabName === 'teamTasks') {
        renderTeamTasksView();
      } else if (tabName === 'roles') {
        renderRolesDashboard();
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function setupTabs() {
      // Desktop dropdown menu toggle
      const dropdownBtn = document.getElementById('desktopNavDropdownBtn');
      const dropdownMenu = document.getElementById('desktopNavDropdownMenu');
      const dropdownChevron = document.getElementById('desktopNavChevron');

      if (dropdownBtn && dropdownMenu) {
        dropdownBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const isHidden = dropdownMenu.classList.contains('hidden');
          if (isHidden) {
            dropdownMenu.classList.remove('hidden');
            dropdownBtn.setAttribute('aria-expanded', 'true');
            if (dropdownChevron) dropdownChevron.classList.add('rotate-180');
          } else {
            dropdownMenu.classList.add('hidden');
            dropdownBtn.setAttribute('aria-expanded', 'false');
            if (dropdownChevron) dropdownChevron.classList.remove('rotate-180');
          }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
          if (!dropdownMenu.contains(e.target) && !dropdownBtn.contains(e.target)) {
            dropdownMenu.classList.add('hidden');
            dropdownBtn.setAttribute('aria-expanded', 'false');
            if (dropdownChevron) dropdownChevron.classList.remove('rotate-180');
          }
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape' && !dropdownMenu.classList.contains('hidden')) {
            dropdownMenu.classList.add('hidden');
            dropdownBtn.setAttribute('aria-expanded', 'false');
            if (dropdownChevron) dropdownChevron.classList.remove('rotate-180');
            dropdownBtn.focus();
          }
        });
      }

      // Nav dropdown items click listener
      document.querySelectorAll('.nav-dropdown-item').forEach(btn => {
        btn.addEventListener('click', () => {
          if (dropdownMenu) dropdownMenu.classList.add('hidden');
          if (dropdownBtn) dropdownBtn.setAttribute('aria-expanded', 'false');
          if (dropdownChevron) dropdownChevron.classList.remove('rotate-180');
          activateTab(btn.dataset.tab);
        });
      });

      // Dropdown selects change listener (Desktop & Mobile)
      const mainNavSel = document.getElementById('mainNavSelectDropdown');
      if (mainNavSel) {
        mainNavSel.addEventListener('change', (e) => activateTab(e.target.value));
      }

      const mobNavSel = document.getElementById('mobileNavSelectDropdown');
      if (mobNavSel) {
        mobNavSel.addEventListener('change', (e) => activateTab(e.target.value));
      }

      // Mobile quick add deal button
      const mobAddDeal = document.getElementById('mobileQuickAddDealBtn');
      if (mobAddDeal) {
        mobAddDeal.addEventListener('click', () => openAddDealModal());
      }

      // Legacy tabs support if any exist
      document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => activateTab(tab.dataset.tab));
      });

      document.querySelectorAll('.mobile-sheet-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const moreModal = document.getElementById('mobileMoreModal');
          if (moreModal) moreModal.classList.add('hidden');
          activateTab(btn.dataset.sheetTab);
        });
      });
    }

    let activeMobileStage = 'all';

    function renderKanban() {
      const board = document.getElementById('kanbanBoard');
      if (board) board.innerHTML = '';
      const mobileFeed = document.getElementById('mobileDealsFeed');
      if (mobileFeed) mobileFeed.innerHTML = '';

      const contractFilter = document.getElementById('filterContract').value;
      const serviceFilter = document.getElementById('filterService').value;
      const marketFilter = document.getElementById('filterMarket').value;
      const sortVal = document.getElementById('sortDeals').value;
      const searchVal = (document.getElementById('globalSearch').value || '').trim().toLowerCase();

      // Sync mobile search input value
      const mobSearch = document.getElementById('mobileSearchInput');
      if (mobSearch && document.activeElement !== mobSearch && mobSearch.value !== document.getElementById('globalSearch').value) {
        mobSearch.value = document.getElementById('globalSearch').value;
      }

      // Filter
      let filteredDeals = deals.filter(deal => {
        if (contractFilter !== 'all' && deal.contractType !== contractFilter) return false;
        if (serviceFilter !== 'all' && !(deal.services?.length?deal.services:[deal.primaryService]).includes(serviceFilter)) return false;
        if (marketFilter !== 'all' && deal.market !== marketFilter) return false;
        if (searchVal) {
          const matchName = deal.companyName.toLowerCase().includes(searchVal);
          const matchPerson = deal.contactPerson.toLowerCase().includes(searchVal);
          const matchPhone = deal.contactPhone.toLowerCase().includes(searchVal);
          if (!matchName && !matchPerson && !matchPhone) return false;
        }
        return true;
      });

      // Sort
      if (sortVal === 'value_desc') {
        filteredDeals.sort((a, b) => Number(b.dealValue) - Number(a.dealValue));
      } else if (sortVal === 'value_asc') {
        filteredDeals.sort((a, b) => Number(a.dealValue) - Number(b.dealValue));
      } else if (sortVal === 'name_asc') {
        filteredDeals.sort((a, b) => a.companyName.localeCompare(b.companyName, 'ar'));
      } else {
        filteredDeals.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      }

      // Counters & Totals
      const pipelineDeals = filteredDeals.filter(deal => !['won','lost'].includes(deal.stage));
      const retainerDeals = filteredDeals.filter(deal => deal.contractType === 'retainer' && deal.stage === 'won');
      const navCount = document.getElementById('navDealsCount');
      if (navCount) navCount.textContent = deals.length;
      document.getElementById('kanbanTotalSummary').textContent = `الفرص المفتوحة: ${financialTotalsText(pipelineDeals)}`;

      // Update Mobile KPI Hub
      const mobBadge = document.getElementById('mobileDealsCountBadge');
      if (mobBadge) mobBadge.textContent = `${filteredDeals.length} صفقات معروضة`;
      const mobPipeVal = document.getElementById('mobileTotalPipelineValue');
      if (mobPipeVal) mobPipeVal.textContent = financialTotalsText(pipelineDeals);
      const mobMrrVal = document.getElementById('mobileMrrValue');
      if (mobMrrVal) mobMrrVal.textContent = financialTotalsText(retainerDeals, true);

      // Active Filter Dot indicator
      const filterDot = document.getElementById('mobileFilterBadgeDot');
      if (filterDot) {
        if (contractFilter !== 'all' || serviceFilter !== 'all' || marketFilter !== 'all' || sortVal !== 'date_desc') {
          filterDot.classList.remove('hidden');
        } else {
          filterDot.classList.add('hidden');
        }
      }

      // Dynamically Render Mobile Stage Filter Pills
      const mobileStageFilter = document.getElementById('kanbanMobileStageFilter');
      if (mobileStageFilter) {
        mobileStageFilter.innerHTML = '';

        // "All" pill
        const allBtn = document.createElement('button');
        allBtn.type = 'button';
        allBtn.className = `stage-pill px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition active:scale-95 ${
          activeMobileStage === 'all'
            ? 'active-stage bg-blue-600 text-white shadow-md'
            : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
        }`;
        allBtn.dataset.stage = 'all';
        allBtn.innerHTML = `الكل (${filteredDeals.length})`;
        allBtn.addEventListener('click', () => {
          activeMobileStage = 'all';
          renderKanban();
        });
        mobileStageFilter.appendChild(allBtn);

        // Individual stage pills
        STAGES.forEach(stage => {
          const count = filteredDeals.filter(d => d.stage === stage.id).length;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `stage-pill px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition active:scale-95 flex items-center gap-1.5 ${
            activeMobileStage === stage.id
              ? 'active-stage bg-blue-600 text-white shadow-md'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`;
          btn.dataset.stage = stage.id;
          const dotColor = stage.color.replace('border-', 'bg-');
          btn.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${activeMobileStage === stage.id ? 'bg-white' : dotColor}"></span><span>${stage.name} (${count})</span>`;
          btn.addEventListener('click', () => {
            activeMobileStage = stage.id;
            renderKanban();
          });
          mobileStageFilter.appendChild(btn);
        });
      }

      // 1. Build Desktop Kanban Columns (hidden on mobile)
      if (board) {
        STAGES.forEach(stage => {
          const stageDeals = filteredDeals.filter(d => d.stage === stage.id);
          const stageValue = stageDeals.reduce((sum, d) => sum + Number(d.dealValue || 0), 0);

          const col = document.createElement('div');
          col.className = 'bg-slate-200/60 rounded-xl p-2.5 flex flex-col kanban-col min-w-[240px] border border-slate-200';
          col.dataset.stageId = stage.id;

          col.innerHTML = `
            <div class="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-300">
              <div class="flex items-center gap-1.5">
                <span class="w-2.5 h-2.5 rounded-full ${stage.color.replace('border-', 'bg-')}"></span>
                <h4 class="font-bold text-xs text-slate-800">${stage.name}</h4>
                <span class="text-[11px] font-bold px-1.5 py-0.2 rounded-full ${stage.badgeBg}">${stageDeals.length}</span>
              </div>
            </div>
            <div class="text-[10px] text-slate-500 font-semibold mb-2.5 flex items-center justify-between">
              <span>القيمة:</span>
              <span class="font-bold text-slate-700">${financialTotalsText(stageDeals)}</span>
            </div>
            <div class="cards-container flex-1 space-y-2.5 overflow-y-auto" data-stage="${stage.id}"></div>
          `;

          const cardsContainer = col.querySelector('.cards-container');

          cardsContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            cardsContainer.classList.add('bg-slate-300/40', 'rounded-lg');
          });
          cardsContainer.addEventListener('dragleave', () => {
            cardsContainer.classList.remove('bg-slate-300/40', 'rounded-lg');
          });
          cardsContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            cardsContainer.classList.remove('bg-slate-300/40', 'rounded-lg');
            const dealId = e.dataTransfer.getData('text/plain');
            moveDealToStage(dealId, stage.id);
          });

          stageDeals.forEach(deal => {
            const card = createKanbanCard(deal, stage);
            cardsContainer.appendChild(card);
          });

          board.appendChild(col);
        });
      }

      // 2. Build Mobile Dedicated Deals Feed (Touch-Optimized)
      if (mobileFeed) {
        if (filteredDeals.length === 0) {
          mobileFeed.innerHTML = `
            <div class="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-2 shadow-sm">
              <span class="text-3xl block">🔍</span>
              <h4 class="font-bold text-sm text-slate-800">لا توجد صفقات مطابقة للفلاتر</h4>
              <p class="text-xs text-slate-500">جرب تغيير كلمات البحث أو إعادة تعيين الفلاتر لعرض كل الصفقات.</p>
              <button type="button" onclick="clearDealFilters()" class="mt-2 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200">
                مسح فلاتر البحث
              </button>
            </div>
          `;
        } else if (activeMobileStage === 'all') {
          // Render grouped by stage cleanly without nested grey containers
          STAGES.forEach(stage => {
            const stageDeals = filteredDeals.filter(d => d.stage === stage.id);
            if (stageDeals.length > 0) {
              const stageVal = stageDeals.reduce((sum, d) => sum + Number(d.dealValue || 0), 0);
              const grpHeader = document.createElement('div');
              grpHeader.className = 'flex items-center justify-between pt-3 pb-1.5 px-1 border-b border-slate-200/80';
              grpHeader.innerHTML = `
                <div class="flex items-center gap-2">
                  <span class="w-2.5 h-2.5 rounded-full ${stage.color.replace('border-', 'bg-')}"></span>
                  <span class="font-extrabold text-xs text-slate-900">${stage.name}</span>
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${stage.badgeBg}">${stageDeals.length} صفقات</span>
                </div>
                <span class="text-[11px] font-bold text-slate-600">${financialTotalsText(stageDeals)}</span>
              `;
              mobileFeed.appendChild(grpHeader);

              stageDeals.forEach(deal => {
                const card = createMobileDealCard(deal, stage);
                mobileFeed.appendChild(card);
              });
            }
          });
        } else {
          // Filtered to a specific stage
          const curStage = STAGES.find(s => s.id === activeMobileStage);
          const stageDeals = filteredDeals.filter(d => d.stage === activeMobileStage);
          if (stageDeals.length === 0) {
            mobileFeed.innerHTML = `
              <div class="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-2 shadow-sm">
                <span class="text-3xl block">📋</span>
                <h4 class="font-bold text-sm text-slate-800">لا توجد صفقات في مرحلة "${curStage?.name || activeMobileStage}"</h4>
                <p class="text-xs text-slate-500">يمكنك نقل صفقات إلى هذه المرحلة أو إضافة صفقة جديدة.</p>
                <button type="button" onclick="activeMobileStage='all'; renderKanban();" class="mt-2 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200">
                  عرض كل الصفقات
                </button>
              </div>
            `;
          } else {
            stageDeals.forEach(deal => {
              const card = createMobileDealCard(deal, curStage);
              mobileFeed.appendChild(card);
            });
          }
        }

        // Attach Quick Stage Select Listeners on Mobile Cards
        mobileFeed.querySelectorAll('.mobile-card-stage-sel').forEach(sel => {
          sel.addEventListener('change', (e) => {
            const dealId = e.target.dataset.deal;
            const newStage = e.target.value;
            moveDealToStage(dealId, newStage);
          });
        });
      }
    }

    function createKanbanCard(deal, stage) {
      const card = document.createElement('div');
      card.className = 'bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md cursor-grab active:cursor-grabbing transition space-y-2 deal-card';
      card.setAttribute('draggable', 'true');
      card.dataset.dealId = deal.id;

      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', deal.id);
        card.classList.add('opacity-50');
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('opacity-50');
      });

      const tasks = deal.tasks || [];
      const doneTasks = tasks.filter(t => t.done || t.status === 'done').length;
      const cleanPhone = (deal.contactPhone || '').replace(/[^0-9+]/g, '');
      const waMsg = encodeURIComponent(`أهلاً بك أستاذ ${deal.contactPerson}، معك فريق AdVance بخصوص مشروع ${deal.companyName}.`);

      card.innerHTML = `
        <div class="flex items-start justify-between gap-1.5">
          <h5 class="font-extrabold text-xs text-slate-800 line-clamp-1 hover:text-blue-600 transition" onclick="openDetailsModal('${deal.id}')">${escapeHtml(deal.companyName)}</h5>
          <span class="text-[9px] font-bold px-1.5 py-0.5 rounded ${deal.contractType === 'retainer' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}">
            ${deal.contractType === 'retainer' ? 'شهري' : 'مشروع'}
          </span>
        </div>
        <div class="flex flex-wrap gap-1 my-1">
          ${((deal.services && deal.services.length > 0) ? deal.services : [deal.primaryService]).map(s => `
            <span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200">
              ${(SERVICES[s] || s).split(' ')[1] || (SERVICES[s] || s)}
            </span>
          `).join('')}
        </div>
        <div class="flex items-center justify-between text-[11px] font-bold text-slate-700 pt-1 border-t border-slate-100">
          <span>${formatFinancialValue(deal.dealValue, deal.currency)}</span>
          <span class="text-[10px] text-slate-500 font-normal">${escapeHtml(deal.contactPerson)}</span>
        </div>
        <div class="flex items-center justify-between pt-1 text-[10px] text-slate-400">
          <span class="flex items-center gap-1 font-semibold ${doneTasks === tasks.length && tasks.length > 0 ? 'text-emerald-600' : 'text-slate-600'}">
            <span>✓</span> ${doneTasks}/${tasks.length} مهام
          </span>
          <div class="flex items-center gap-1">
            <a href="https://wa.me/${cleanPhone}?text=${waMsg}" target="_blank" rel="noopener noreferrer" class="p-1 text-emerald-600 hover:bg-emerald-50 rounded" title="مراسلة واتساب" onclick="event.stopPropagation()">
              <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.664-.698c.974.53 2.062.812 3.194.814h.005c3.179 0 5.767-2.587 5.768-5.766 0-3.18-2.588-5.767-5.771-5.767zm7.531 5.766c0 4.155-3.376 7.533-7.533 7.533-1.309 0-2.548-.337-3.633-.925l-4.041 1.059 1.078-3.938c-.687-1.156-1.07-2.502-1.07-3.937 0-4.156 3.377-7.534 7.534-7.534 4.156 0 7.533 3.378 7.533 7.534z"/></svg>
            </a>
            <button class="p-1 text-blue-600 hover:bg-blue-50 rounded font-bold text-[10px]" onclick="openDetailsModal('${deal.id}')" title="عرض التفاصيل">
              تفاصيل
            </button>
          </div>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (!e.target.closest('a') && !e.target.closest('button')) {
          openDetailsModal(deal.id);
        }
      });

      return card;
    }

    function createMobileDealCard(deal, stage) {
      const card = document.createElement('div');
      card.className = 'bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition space-y-3';

      const tasks = deal.tasks || [];
      const doneTasks = tasks.filter(t => t.done || t.status === 'done').length;
      const taskPercent = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0;
      const cleanPhone = (deal.contactPhone || '').replace(/[^0-9+]/g, '');
      const waMsg = encodeURIComponent(`أهلاً بك أستاذ ${deal.contactPerson}، معك فريق AdVance بخصوص مشروع ${deal.companyName}.`);

      const stageColors = {
        new_lead: { bg: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500' },
        discovery: { bg: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
        proposal: { bg: 'bg-purple-50 text-purple-700 border-purple-200', dot: 'bg-purple-500' },
        negotiation: { bg: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
        won: { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
        lost: { bg: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400' }
      };
      const sc = stageColors[deal.stage] || stageColors.new_lead;
      const stageName = stage ? stage.name : (STAGES.find(s => s.id === deal.stage)?.name || deal.stage);

      card.innerHTML = `
        <!-- Card Header: Company & Badges -->
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 cursor-pointer" onclick="openDetailsModal('${deal.id}')">
            <h4 class="font-black text-sm text-slate-900 leading-snug hover:text-blue-600 transition">
              ${escapeHtml(deal.companyName)}
            </h4>
            <div class="text-[11px] text-slate-500 font-medium mt-0.5 flex items-center gap-1.5">
              <span>👤 ${escapeHtml(deal.contactPerson)}</span>
              <span>&bull;</span>
              <span class="text-slate-400">${deal.market === 'gulf' ? '🇸🇦 الخليج' : '🇪🇬 مصر'}</span>
            </div>
          </div>

          <div class="flex flex-col items-end gap-1">
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${sc.bg}">
              <span class="w-1.5 h-1.5 rounded-full ${sc.dot}"></span>
              <span>${stageName}</span>
            </span>
            <span class="text-[9px] font-bold px-2 py-0.5 rounded-md ${deal.contractType === 'retainer' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}">
              ${deal.contractType === 'retainer' ? '🌿 شراكة شهرية' : '📦 مشروع محدد'}
            </span>
          </div>
        </div>

        <!-- Service Badges -->
        <div class="flex flex-wrap gap-1">
          ${((deal.services && deal.services.length > 0) ? deal.services : [deal.primaryService]).map(s => `
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 border border-slate-200">
              ${SERVICES[s] || s}
            </span>
          `).join('')}
        </div>

        <!-- Financial Value & Task Progress Strip -->
        <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
          <div>
            <span class="text-[10px] text-slate-400 block leading-tight font-medium">قيمة التعاقد:</span>
            <div class="text-sm font-black text-slate-900">
              ${formatFinancialValue(deal.dealValue, deal.currency, deal.contractType === 'retainer')}
            </div>
          </div>

          <div class="text-left">
            <span class="text-[10px] font-bold text-slate-500 block leading-tight">
              المهام: <span class="${doneTasks === tasks.length && tasks.length > 0 ? 'text-emerald-600 font-extrabold' : 'text-blue-600'}">${doneTasks}/${tasks.length}</span>
            </span>
            <div class="w-20 bg-slate-200 h-1.5 rounded-full overflow-hidden mt-1">
              <div class="bg-blue-600 h-full rounded-full transition-all duration-300" style="width: ${taskPercent}%"></div>
            </div>
          </div>
        </div>

        <!-- Quick Actions & Stage Stepper Row -->
        <div class="flex items-center justify-between gap-1.5 pt-1 border-t border-slate-100">
          <!-- Quick Stage Selector -->
          <div class="flex-1">
            <select class="w-full text-xs font-bold bg-slate-100 hover:bg-slate-200/70 border border-slate-200 text-slate-700 rounded-xl px-2 py-2 focus:outline-none focus:border-blue-500 mobile-card-stage-sel cursor-pointer transition min-h-[38px]" data-deal="${deal.id}">
              <option value="new_lead" ${deal.stage === 'new_lead' ? 'selected' : ''}>01 عميل جديد</option>
              <option value="discovery" ${deal.stage === 'discovery' ? 'selected' : ''}>02 الاكتشاف والتأهيل</option>
              <option value="proposal" ${deal.stage === 'proposal' ? 'selected' : ''}>03 إعداد العرض</option>
              <option value="negotiation" ${deal.stage === 'negotiation' ? 'selected' : ''}>04 التفاوض والمراجعة</option>
              <option value="won" ${deal.stage === 'won' ? 'selected' : ''}>05 تم التعاقد (Won)</option>
              <option value="lost" ${deal.stage === 'lost' ? 'selected' : ''}>06 مؤجل / غير نشط</option>
            </select>
          </div>

          <!-- WhatsApp Direct -->
          <a href="https://wa.me/${cleanPhone}?text=${waMsg}" target="_blank" rel="noopener noreferrer" class="p-2 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200 transition active:scale-95 flex items-center justify-center shadow-sm min-w-[38px] min-h-[38px]" title="محادثة واتساب">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.664-.698c.974.53 2.062.812 3.194.814h.005c3.179 0 5.767-2.587 5.768-5.766 0-3.18-2.588-5.767-5.771-5.767zm7.531 5.766c0 4.155-3.376 7.533-7.533 7.533-1.309 0-2.548-.337-3.633-.925l-4.041 1.059 1.078-3.938c-.687-1.156-1.07-2.502-1.07-3.937 0-4.156 3.377-7.534 7.534-7.534 4.156 0 7.533 3.378 7.533 7.534z"/></svg>
          </a>

          <!-- Call Direct -->
          <a href="tel:${cleanPhone}" class="p-2 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 transition active:scale-95 flex items-center justify-center shadow-sm min-w-[38px] min-h-[38px]" title="اتصال هاتفي">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
          </a>

          <!-- Details Button -->
          <button type="button" class="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition active:scale-95 flex items-center gap-1 shadow-sm min-h-[38px]" onclick="openDetailsModal('${deal.id}')">
            <span>تفاصيل</span>
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
        </div>
      `;

      return card;
    }

    function moveDealToStage(dealId, newStage) {
      if (!allowMutation('canEditDeals')) return;
      if (!STAGES.some(stage => stage.id === newStage)) return;
      const deal = deals.find(d => d.id === dealId);
      if (deal && deal.stage !== newStage) {
        deal.stage = newStage;
        if (!deal.activities) deal.activities = [];
        const stageName = STAGES.find(s => s.id === newStage)?.name || newStage;
        deal.activities.unshift({
          type: 'note',
          date: new Date().toISOString().replace('T', ' ').substring(0, 16),
          text: `تم نقل الصفقة إلى مرحلة "${stageName}".`
        });
        saveDeals();
        renderKanban();
        showToast(`تم تحديث مرحلة ${deal.companyName} إلى: ${stageName}`);
      }
    }


    // --- MULTI-SERVICE SELECTION HELPERS ---
    function renderDealServicesPills() {
      const container = document.getElementById('dealServicesPillsContainer');
      if (!container) return;
      container.innerHTML = '';

      Object.keys(SERVICES).forEach(key => {
        const isSelected = selectedDealServices.includes(key);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `p-2 rounded-lg text-[10px] font-bold border text-right transition flex items-center justify-between ${
          isSelected 
            ? 'bg-blue-600 text-white border-blue-700 shadow-sm' 
            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
        }`;
        btn.innerHTML = `
          <span class="truncate">${SERVICES[key]}</span>
          <span class="text-xs mr-1">${isSelected ? '✓' : '+'}</span>
        `;
        btn.addEventListener('click', () => {
          if (isSelected) {
            if (selectedDealServices.length > 1) {
              selectedDealServices = selectedDealServices.filter(k => k !== key);
            } else {
              showToast('يجب اختيار خدمة واحدة على الأقل');
            }
          } else {
            selectedDealServices.push(key);
          }
          const primarySel = document.getElementById('primaryService');
          if (primarySel) primarySel.value = selectedDealServices[0] || 'growth_strategy';
          renderDealServicesPills();
        });
        container.appendChild(btn);
      });

      const badge = document.getElementById('dealMultiServiceBadge');
      if (badge) {
        badge.textContent = `${selectedDealServices.length} خدمات محددة`;
      }
    }

    // --- TEAM & MEMBER TASKS WORKSPACE (NEW) ---
    function renderTeamTasksView() {
      const viewer = getCurrentUser();
      const ownTasksOnly = viewer.role !== 'admin';
      const teamMembers = getTeamMembers();
      if (ownTasksOnly) activeTeamMember = viewer.id;
      if (!teamMembers.some(member=>member.id===activeTeamMember)) activeTeamMember = 'all';
      const memberContainer = document.getElementById('memberCardsGrid');
      if (!memberContainer) return;
      memberContainer.innerHTML = '';

      // Calculate stats per member across all deals
      const memberStats = {};
      teamMembers.forEach(m => {
        memberStats[m.id] = { total: 0, done: 0, in_progress: 0, pending: 0, tasks: [] };
      });

      deals.forEach(deal => {
        const tasks = deal.tasks || [];
        tasks.forEach((t, idx) => {
          const matchedMember = taskOwnerId(t);

          const isDone = t.status === 'done' || t.done === true;
          const isInProgress = t.status === 'in_progress';
          const isPending = t.status === 'todo' || t.status === 'review';

          const taskObj = {
            dealId: deal.id,
            companyName: deal.companyName,
            taskIndex: idx,
            task: t,
            matchedMember: matchedMember
          };

          if (memberStats[matchedMember]) {
            memberStats[matchedMember].total++;
            if (isDone) memberStats[matchedMember].done++;
            if (isInProgress) memberStats[matchedMember].in_progress++;
            if (isPending) memberStats[matchedMember].pending++;
            memberStats[matchedMember].tasks.push(taskObj);
          }

          memberStats['all'].total++;
          if (isDone) memberStats['all'].done++;
          if (isInProgress) memberStats['all'].in_progress++;
          if (isPending) memberStats['all'].pending++;
          memberStats['all'].tasks.push(taskObj);
        });
      });

      // Render cards
      teamMembers.forEach(m => {
        const stats = memberStats[m.id] || { total: 0, done: 0, in_progress: 0, pending: 0 };
        const percent = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
        const isSelected = activeTeamMember === m.id;

        const card = document.createElement('div');
        card.className = `p-4 rounded-xl border transition cursor-pointer bg-white hover:border-blue-400 hover:shadow-md ${
          isSelected ? 'ring-2 ring-blue-600 border-blue-600 bg-blue-50/20' : 'border-slate-200'
        }`;

        card.innerHTML = `
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <span class="text-xl">${escapeHtml(m.icon)}</span>
              <div>
                <h4 class="font-extrabold text-xs text-slate-800">${escapeHtml(m.name)}</h4>
                <p class="text-[10px] text-slate-500">${escapeHtml(m.role)}</p>
              </div>
            </div>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}">
              ${stats.done}/${stats.total}
            </span>
          </div>
          <div class="space-y-1 mt-2">
            <div class="flex items-center justify-between text-[10px] font-bold">
              <span class="text-slate-600">${percent}% إنجاز</span>
              <span class="text-blue-600 font-extrabold">${stats.in_progress} قيد التنفيذ</span>
            </div>
            <div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
              <div class="bg-blue-600 h-full rounded-full transition-all duration-300" style="width: ${percent}%"></div>
            </div>
          </div>
        `;

        card.addEventListener('click', () => {
          if (ownTasksOnly && m.id !== viewer.id) return;
          activeTeamMember = m.id;
          renderTeamTasksView();
        });

        memberContainer.appendChild(card);
      });

      if (ownTasksOnly) {
        [...memberContainer.children].forEach((card, index) => {
          const member = teamMembers[index];
          if (member.id === viewer.id) return;
          const stats = memberStats[member.id];
          const percent = stats.total ? Math.round(stats.done / stats.total * 100) : 0;
          card.className = 'p-4 rounded-xl border border-slate-200 bg-white';
          card.innerHTML = '<h4 class="font-bold text-xs">' + escapeHtml(member.name) + '</h4><p class="mt-2 text-lg font-bold text-blue-600">' + percent + '%</p><p class="text-xs text-slate-500">نسبة الإنجاز الإجمالية</p><div class="mt-2 h-1.5 rounded-full bg-slate-100"><div class="h-full rounded-full bg-blue-600" style="width:' + percent + '%"></div></div>';
          card.style.cursor = 'default';
        });
      }
      // Update KPI Cards
      const selectedMemberName = teamMembers.find(member=>member.id===activeTeamMember)?.name || 'غير مسندة';
      const currentStats = memberStats[activeTeamMember] || { total: 0, done: 0, in_progress: 0, pending: 0, tasks: [] };
      const currentPercent = currentStats.total > 0 ? Math.round((currentStats.done / currentStats.total) * 100) : 0;

      document.getElementById('teamMemberTotalTasks').textContent = currentStats.total;
      document.getElementById('teamMemberNameSubtitle').textContent = activeTeamMember === 'all' ? 'جميع مهام النظام' : `مهام ${selectedMemberName}`;
      document.getElementById('teamMemberDoneTasks').textContent = currentStats.done;
      document.getElementById('teamMemberDonePercent').textContent = `${currentPercent}% نسبة الإنجاز`;
      document.getElementById('teamMemberInProgressTasks').textContent = currentStats.in_progress;
      document.getElementById('teamMemberPendingTasks').textContent = currentStats.pending;
      document.getElementById('teamMemberTableTitle').textContent = `جدول مهام: ${activeTeamMember === 'all' ? 'جميع أعضاء الفريق والعميل' : selectedMemberName}`;

      // Filter tasks list
      const statusFilter = document.getElementById('filterMemberTaskStatus').value;
      const toolFilter = document.getElementById('filterMemberTaskTool').value;

      let memberTasksList = currentStats.tasks.filter(item => {
        if (!canViewTask(item.task)) return false;
        const t = item.task;
        const normStatus = t.status || (t.done ? 'done' : 'todo');
        if (statusFilter !== 'all' && normStatus !== statusFilter) return false;
        if (toolFilter !== 'all') {
          const tTool = t.tool || '';
          if (!tTool.includes(toolFilter)) return false;
        }
        return true;
      });

      document.getElementById('teamMemberTableCountBadge').textContent = `${memberTasksList.length} مهام`;

      // Render table rows
      const tbody = document.getElementById('memberTasksTableBody');
      tbody.innerHTML = '';

      if (memberTasksList.length === 0) {
        const mobile = document.getElementById('memberTasksMobileList');
        if (mobile) mobile.textContent = 'لا توجد مهام تطابق الفلاتر المحددة.';
        tbody.innerHTML = `
          <tr>
            <td colspan="9" class="text-center py-8 text-xs text-slate-400">
              لا توجد مهام تطابق الفلاتر المحددة لهذا العضو حالياً.
            </td>
          </tr>
        `;
        return;
      }

      const toolBadges = {
        'كلود': 'bg-purple-50 text-purple-700 border-purple-200',
        'شات جي بي تي': 'bg-emerald-50 text-emerald-700 border-emerald-200',
        'جيمناي': 'bg-blue-50 text-blue-700 border-blue-200',
        'انتي جرافتي': 'bg-indigo-50 text-indigo-700 border-indigo-200',
        'ميتا': 'bg-sky-50 text-sky-700 border-sky-200',
        'كانفا': 'bg-pink-50 text-pink-700 border-pink-200',
        'العميل': 'bg-amber-50 text-amber-700 border-amber-200'
      };

      memberTasksList.forEach((item, index) => {
        const t = item.task;
        const normStatus = t.status || (t.done ? 'done' : 'todo');
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition border-b border-slate-100';

        const priorityBadges = {
          'عالية': 'bg-rose-50 text-rose-700 border-rose-200',
          'متوسطة': 'bg-amber-50 text-amber-700 border-amber-200',
          'عادية': 'bg-slate-100 text-slate-700 border-slate-200'
        };

        let toolClass = 'bg-slate-100 text-slate-700 border-slate-200';
        for (const k in toolBadges) {
          if ((t.tool || '').includes(k)) {
            toolClass = toolBadges[k];
            break;
          }
        }

        const deliverableBtn = t.deliverableUrl
          ? `<a href="${escapeHtml(safeDeliverableUrl(t.deliverableUrl))}" target="_blank" rel="noopener noreferrer" class="text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded inline-flex items-center gap-1">معاينة</a>`
          : '<span class="text-slate-400 text-[10px]">-</span>';

        tr.innerHTML = `
          <td class="py-3 px-3 text-center font-bold text-slate-400 text-[11px]">${index + 1}</td>
          <td class="py-3 px-4 font-bold text-slate-800">
            <div class="flex items-center gap-2">
              <input type="checkbox" ${normStatus === 'done' ? 'checked' : ''} class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer member-task-check" data-deal="${item.dealId}" data-idx="${item.taskIndex}" title="إنجاز فوري">
              <span class="${normStatus === 'done' ? 'line-through text-slate-400' : 'text-slate-800 font-semibold'}">${escapeHtml(t.title || t.text)}</span>
            </div>
          </td>
          <td class="py-3 px-4 font-semibold text-slate-700">
            <button class="hover:text-blue-600 transition" onclick="openDetailsModal('${item.dealId}')">
              ${escapeHtml(item.companyName)}
            </button>
          </td>
          <td class="py-3 px-4">
            <span class="text-[10px] font-bold px-2 py-0.5 rounded border inline-flex items-center gap-1 ${toolClass}">
              <span>🛠️</span> ${escapeHtml(t.tool || 'ذكاء اصطناعي')}
            </span>
          </td>
          <td class="py-3 px-4 text-slate-600 font-mono text-[11px]" dir="ltr">
            ${escapeHtml(t.dueDate || 'بلا موعد')}
          </td>
          <td class="py-3 px-4">
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded border ${priorityBadges[t.priority] || priorityBadges['متوسطة']}">
              ${escapeHtml(t.priority || 'متوسطة')}
            </span>
          </td>
          <td class="py-3 px-4">
            <select class="text-[10px] font-bold rounded-lg border border-slate-300 p-1 bg-white focus:outline-none focus:border-blue-500 member-task-status-selector" data-deal="${item.dealId}" data-idx="${item.taskIndex}">
              <option value="todo" ${normStatus === 'todo' ? 'selected' : ''}>⏳ قيد الانتظار</option>
              <option value="in_progress" ${normStatus === 'in_progress' ? 'selected' : ''}>🚀 قيد التنفيذ</option>
              <option value="review" ${normStatus === 'review' ? 'selected' : ''}>🔍 مراجعة واعتماد</option>
              <option value="done" ${normStatus === 'done' ? 'selected' : ''}>✅ مكتملة ومسلّمة</option>
            </select>
          </td>
          <td class="py-3 px-4">${deliverableBtn}</td>
          <td class="py-3 px-4 text-center">
            <button class="text-rose-500 hover:text-rose-700 p-1 font-bold text-xs delete-member-task-btn" data-deal="${item.dealId}" data-idx="${item.taskIndex}" title="حذف المهمة">
              ✕
            </button>
          </td>
        `;

        tbody.appendChild(tr);
      });

      // Event listeners
      tbody.querySelectorAll('.member-task-status-selector').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const dealId = e.target.dataset.deal;
          const idx = e.target.dataset.idx;
          const deal = deals.find(d => d.id === dealId);
          if (deal && deal.tasks[idx] && canViewTask(deal.tasks[idx])) {
            deal.tasks[idx].status = e.target.value;
            deal.tasks[idx].done = (e.target.value === 'done');
            saveDeals();
            renderTeamTasksView();
            renderProjectsView();
            renderKanban();
            showToast(`تم تحديث حالة المهمة في ${deal.companyName}`);
          }
        });
      });

      tbody.querySelectorAll('.member-task-check').forEach(chk => {
        chk.addEventListener('change', (e) => {
          const dealId = e.target.dataset.deal;
          const idx = e.target.dataset.idx;
          const deal = deals.find(d => d.id === dealId);
          if (deal && deal.tasks[idx] && canViewTask(deal.tasks[idx])) {
            const isDone = e.target.checked;
            deal.tasks[idx].done = isDone;
            deal.tasks[idx].status = isDone ? 'done' : 'in_progress';
            saveDeals();
            renderTeamTasksView();
            renderProjectsView();
            renderKanban();
            showToast(isDone ? `تم إنجاز المهمة بنجاح في ${deal.companyName} ✅` : `تم إعادة فتح المهمة`);
          }
        });
      });

      tbody.querySelectorAll('.delete-member-task-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const dealId = e.target.dataset.deal;
          const idx = e.target.dataset.idx;
          const deal = deals.find(d => d.id === dealId);
          if (deal && deal.tasks[idx] && canViewTask(deal.tasks[idx])) {
            if (!prepareTaskDeletion(deal, deal.tasks[idx]?.id)) return;
            saveDeals();
            renderTeamTasksView();
            renderProjectsView();
            renderKanban();
            showToast('تم حذف المهمة');
          }
        });
      });

      // Render Mobile Cards for Team Tasks View
      const memberMobileList = document.getElementById('memberTasksMobileList');
      if (memberMobileList) {
        memberMobileList.innerHTML = '';
        if (memberTasksList.length === 0) {
          memberMobileList.innerHTML = `
            <div class="text-center py-6 text-xs text-slate-400 bg-white rounded-xl border border-slate-200">
              لا توجد مهام تطابق الفلاتر المحددة لهذا العضو حالياً.
            </div>
          `;
        } else {
          memberTasksList.forEach((item, index) => {
            const t = item.task;
            const normStatus = t.status || (t.done ? 'done' : 'todo');
            const card = document.createElement('div');
            card.className = 'bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm space-y-2.5';

            const priorityColors = {
              'عالية': 'bg-rose-50 text-rose-700 border-rose-200',
              'متوسطة': 'bg-amber-50 text-amber-700 border-amber-200',
              'عادية': 'bg-slate-100 text-slate-700 border-slate-200'
            };

            let toolClass = 'bg-slate-100 text-slate-700 border-slate-200';
            for (const k in toolBadges) {
              if ((t.tool || '').includes(k)) {
                toolClass = toolBadges[k];
                break;
              }
            }

            const deliverableBtn = t.deliverableUrl
              ? `<a href="${escapeHtml(safeDeliverableUrl(t.deliverableUrl))}" target="_blank" rel="noopener noreferrer" class="text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg inline-flex items-center gap-1 border border-blue-200">معاينة ↗</a>`
              : '';

            card.innerHTML = `
              <div class="flex items-start justify-between gap-2">
                <label class="flex items-start gap-2.5 cursor-pointer flex-1">
                  <input type="checkbox" ${normStatus === 'done' ? 'checked' : ''} class="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-5 h-5 cursor-pointer mobile-member-task-check" data-deal="${item.dealId}" data-idx="${item.taskIndex}">
                  <div>
                    <h5 class="text-xs font-bold ${normStatus === 'done' ? 'line-through text-slate-400' : 'text-slate-900'} leading-tight">${escapeHtml(t.title || t.text)}</h5>
                    <div class="text-[10px] text-blue-700 font-semibold mt-0.5">📁 ${escapeHtml(item.companyName)}</div>
                  </div>
                </label>
                <button type="button" class="text-rose-500 hover:text-rose-700 p-1 text-xs font-bold mobile-del-member-btn" data-deal="${item.dealId}" data-idx="${item.taskIndex}" title="حذف المهمة">✕</button>
              </div>

              <div class="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span class="font-bold px-2 py-0.5 rounded-md border inline-flex items-center gap-1 ${toolClass}">🛠️ ${escapeHtml(t.tool || 'ذكاء اصطناعي')}</span>
                <span class="font-bold px-1.5 py-0.5 rounded-md border ${priorityColors[t.priority] || priorityColors['متوسطة']}">⚡ ${escapeHtml(t.priority || 'متوسطة')}</span>
                <span class="text-slate-500 font-mono" dir="ltr">📅 ${escapeHtml(t.dueDate || 'بلا موعد')}</span>
              </div>

              <div class="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
                <div class="flex-1">
                  <select class="w-full text-xs font-bold rounded-xl border border-slate-300 p-2 bg-slate-50 focus:outline-none focus:border-blue-500 mobile-member-status-sel min-h-[40px]" data-deal="${item.dealId}" data-idx="${item.taskIndex}">
                    <option value="todo" ${normStatus === 'todo' ? 'selected' : ''}>⏳ قيد الانتظار</option>
                    <option value="in_progress" ${normStatus === 'in_progress' ? 'selected' : ''}>🚀 قيد التنفيذ</option>
                    <option value="review" ${normStatus === 'review' ? 'selected' : ''}>🔍 مراجعة واعتماد</option>
                    <option value="done" ${normStatus === 'done' ? 'selected' : ''}>✅ مكتملة ومسلّمة</option>
                  </select>
                </div>
                ${deliverableBtn}
              </div>
            `;
            memberMobileList.appendChild(card);
          });

          memberMobileList.querySelectorAll('.mobile-member-task-check').forEach(chk => {
            chk.addEventListener('change', (e) => {
              const dealId = e.target.dataset.deal;
              const idx = e.target.dataset.idx;
              const deal = deals.find(d => d.id === dealId);
              if (deal && deal.tasks[idx] && canViewTask(deal.tasks[idx])) {
                const isDone = e.target.checked;
                deal.tasks[idx].done = isDone;
                deal.tasks[idx].status = isDone ? 'done' : 'in_progress';
                saveDeals();
                renderTeamTasksView();
                renderProjectsView();
                renderKanban();
                showToast(isDone ? `تم إنجاز المهمة بنجاح ✅` : `تم إعادة فتح المهمة`);
              }
            });
          });

          memberMobileList.querySelectorAll('.mobile-member-status-sel').forEach(sel => {
            sel.addEventListener('change', (e) => {
              const dealId = e.target.dataset.deal;
              const idx = e.target.dataset.idx;
              const deal = deals.find(d => d.id === dealId);
              if (deal && deal.tasks[idx] && canViewTask(deal.tasks[idx])) {
                deal.tasks[idx].status = e.target.value;
                deal.tasks[idx].done = (e.target.value === 'done');
                saveDeals();
                renderTeamTasksView();
                renderProjectsView();
                renderKanban();
                showToast(`تم تحديث حالة المهمة في ${deal.companyName}`);
              }
            });
          });

          memberMobileList.querySelectorAll('.mobile-del-member-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
              const dealId = e.target.dataset.deal;
              const idx = e.target.dataset.idx;
              const deal = deals.find(d => d.id === dealId);
              if (deal && deal.tasks[idx] && canViewTask(deal.tasks[idx])) {
                if (!prepareTaskDeletion(deal, deal.tasks[idx]?.id)) return;
                saveDeals();
                renderTeamTasksView();
                renderProjectsView();
                renderKanban();
                showToast('تم حذف المهمة');
              }
            });
          });
        }
      }
    }


    // --- RENDER PROJECTS & TASKS DELIVERY VIEW ---
    function renderProjectsView() {
      let totalTasks = 0;
      let completedTasks = 0;
      let reviewTasks = 0;

      deals.forEach(d => {
        const tasks = d.tasks || [];
        totalTasks += tasks.length;
        completedTasks += tasks.filter(t => t.status === 'done' || t.done === true).length;
        reviewTasks += tasks.filter(t => t.status === 'review').length;
      });

      const overallProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      const activeProjectsCount = deals.filter(d => d.stage !== 'lost').length;

      document.getElementById('statActiveProjects').textContent = `${activeProjectsCount} مشروعات`;
      document.getElementById('statOverallProgress').textContent = `${overallProgress}%`;
      document.getElementById('statProgressBar').style.width = `${overallProgress}%`;
      document.getElementById('statTasksCount').textContent = `${completedTasks} / ${totalTasks}`;
      document.getElementById('statReviewTasks').textContent = `${reviewTasks} مهام`;

      // Populate Project Filter
      const projectSelect = document.getElementById('filterTaskProject');
      const currentSelectedProject = projectSelect.value || 'all';
      projectSelect.innerHTML = '<option value="all">جميع المشروعات</option>';
      deals.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = `${d.companyName} (${SERVICES[d.primaryService]?.split(' ')[1] || 'مشروع'})`;
        projectSelect.appendChild(opt);
      });
      projectSelect.value = currentSelectedProject;

      // Render Project Overview Cards
      const cardsContainer = document.getElementById('projectsCardsContainer');
      cardsContainer.innerHTML = '';

      deals.filter(d => d.stage !== 'lost').forEach(d => {
        const tasks = d.tasks || [];
        const done = tasks.filter(t => t.status === 'done' || t.done === true).length;
        const progress = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;

        const card = document.createElement('div');
        card.className = `p-4 rounded-xl border transition cursor-pointer bg-white hover:border-blue-400 hover:shadow-md ${projectSelect.value === d.id ? 'ring-2 ring-blue-500 border-blue-500 bg-blue-50/20' : 'border-slate-200'}`;
        
        card.innerHTML = `
          <div class="flex items-center justify-between mb-2">
            <h4 class="font-extrabold text-xs text-slate-800 truncate" title="${escapeHtml(d.companyName)}">${escapeHtml(d.companyName)}</h4>
            <span class="text-[9px] font-bold px-1.5 py-0.5 rounded ${d.contractType === 'retainer' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}">
              ${d.contractType === 'retainer' ? 'شهري' : 'مشروع'}
            </span>
          </div>
          <p class="text-[10px] text-slate-500 truncate mb-3">${SERVICES[d.primaryService] || d.primaryService}</p>
          <div class="space-y-1 mb-2.5">
            <div class="flex items-center justify-between text-[10px] font-bold">
              <span class="text-slate-600">الإنجاز: ${done}/${tasks.length} مهام</span>
              <span class="text-blue-600 font-extrabold">${progress}%</span>
            </div>
            <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div class="bg-blue-600 h-full rounded-full transition-all duration-300" style="width: ${progress}%"></div>
            </div>
          </div>
          <button type="button" class="w-full py-1 px-2 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition flex items-center justify-center gap-1 shadow-sm">
            <span>تعديل مهام المشروع بالجدول</span>
            <svg class="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
          </button>
        `;

        card.addEventListener('click', () => {
          projectSelect.value = d.id;
          renderMasterTasksTable();
          renderProjectsView();
          const targetSection = document.getElementById('tasksDeliveryToolbar');
          if (targetSection) {
            targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            targetSection.classList.add('ring-4', 'ring-blue-300');
            setTimeout(() => targetSection.classList.remove('ring-4', 'ring-blue-300'), 1500);
          }
        });

        cardsContainer.appendChild(card);
      });

      renderMasterTasksTable();
    }

    function renderMasterTasksTable() {
      const tbody = document.getElementById('masterTasksTableBody');
      tbody.innerHTML = '';

      const selectedProj = document.getElementById('filterTaskProject').value;
      const selectedAssignee = document.getElementById('filterTaskAssignee').value;
      const selectedStatus = document.getElementById('filterTaskStatus').value;

      let allTasksList = [];

      deals.forEach(d => {
        if (selectedProj !== 'all' && d.id !== selectedProj) return;
        const tasks = d.tasks || [];
        tasks.forEach((t, index) => {
          if (!canViewTask(t)) return;
          allTasksList.push({
            dealId: d.id,
            companyName: d.companyName,
            service: d.primaryService,
            taskIndex: index,
            task: t
          });
        });
      });

      const filteredTasks = allTasksList.filter(item => {
        const t = item.task;
        const normStatus = t.status || (t.done ? 'done' : 'todo');
        if (selectedAssignee !== 'all' && taskOwnerId(t) !== selectedAssignee) return false;
        if (selectedStatus !== 'all' && normStatus !== selectedStatus) return false;
        return true;
      });

      document.getElementById('tasksTableCountSummary').textContent = `عرض ${filteredTasks.length} مهمة تنفيذية`;

      if (filteredTasks.length === 0) {
        const mobile = document.getElementById('masterTasksMobileList');
        if (mobile) mobile.textContent = 'لا توجد مهام تطابق الفلاتر المحددة.';
        tbody.innerHTML = `
          <tr>
            <td colspan="9" class="text-center py-8 text-xs text-slate-400">
              لا توجد مهام مطابقة للفلاتر المحددة. اضغط "توليد مهام الخدمة الذكية" أو "إضافة مهمة جديدة".
            </td>
          </tr>
        `;
        return;
      }

      filteredTasks.forEach(item => {
        const t = item.task;
        const normStatus = t.status || (t.done ? 'done' : 'todo');
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition border-b border-slate-100';

        const priorityBadges = {
          'عالية': 'bg-rose-50 text-rose-700 border-rose-200',
          'متوسطة': 'bg-amber-50 text-amber-700 border-amber-200',
          'عادية': 'bg-slate-100 text-slate-700 border-slate-200'
        };

        const deliverableButton = t.deliverableUrl 
          ? `<a href="${escapeHtml(safeDeliverableUrl(t.deliverableUrl))}" target="_blank" rel="noopener noreferrer" class="text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded inline-flex items-center gap-1">
               <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
               معاينة
             </a>`
          : '<span class="text-slate-400 text-[10px]">-</span>';

        tr.innerHTML = `
          <td class="py-3 px-4 font-bold text-slate-800">
            <div class="flex items-center gap-2.5">
              <input type="checkbox" ${normStatus === 'done' ? 'checked' : ''} class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer master-task-quick-check" data-deal="${item.dealId}" data-idx="${item.taskIndex}" title="تحديد كمكتمل فوراً بنقرة واحدة">
              <span class="${normStatus === 'done' ? 'line-through text-slate-400' : 'text-slate-800'}">${escapeHtml(t.title || t.text)}</span>
            </div>
          </td>
          <td class="py-3 px-4 font-semibold text-slate-700">
            <button class="hover:text-blue-600 transition" onclick="openDetailsModal('${item.dealId}')">
              ${escapeHtml(item.companyName)}
            </button>
          </td>
          <td class="py-3 px-4">
            <span class="inline-flex items-center gap-1 font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[10px]">
              👤 ${escapeHtml(t.assignee || 'مؤمن النوساني')}
            </span>
          </td>
          <td class="py-3 px-4">
            <span class="text-[10px] font-bold px-2 py-0.5 rounded border inline-flex items-center gap-1 bg-purple-50 text-purple-700 border-purple-200">
              🛠️ ${escapeHtml(t.tool || 'ذكاء اصطناعي')}
            </span>
          </td>
          <td class="py-3 px-4 text-slate-600 font-mono text-[11px]" dir="ltr">
            ${escapeHtml(t.dueDate || 'بلا موعد')}
          </td>
          <td class="py-3 px-4">
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded border ${priorityBadges[t.priority] || priorityBadges['متوسطة']}">
              ${escapeHtml(t.priority || 'متوسطة')}
            </span>
          </td>
          <td class="py-3 px-4">
            <select class="text-[10px] font-bold rounded-lg border border-slate-300 p-1 bg-white focus:outline-none focus:border-blue-500 task-status-selector" data-deal="${item.dealId}" data-idx="${item.taskIndex}">
              <option value="todo" ${normStatus === 'todo' ? 'selected' : ''}>⏳ قيد الانتظار</option>
              <option value="in_progress" ${normStatus === 'in_progress' ? 'selected' : ''}>🚀 قيد التنفيذ</option>
              <option value="review" ${normStatus === 'review' ? 'selected' : ''}>🔍 مراجعة العميل</option>
              <option value="done" ${normStatus === 'done' ? 'selected' : ''}>✅ مكتملة ومسلّمة</option>
            </select>
          </td>
          <td class="py-3 px-4">${deliverableButton}</td>
          <td class="py-3 px-4 text-center">
            <button class="text-rose-500 hover:text-rose-700 p-1 font-bold text-xs delete-master-task-btn" data-deal="${item.dealId}" data-idx="${item.taskIndex}" title="حذف المهمة">
              ✕
            </button>
          </td>
        `;

        tbody.appendChild(tr);
      });

      tbody.querySelectorAll('.master-task-quick-check').forEach(chk => {
        chk.addEventListener('change', (e) => {
          const dealId = e.target.dataset.deal;
          const idx = e.target.dataset.idx;
          const deal = deals.find(d => d.id === dealId);
          if (deal && deal.tasks[idx] && canViewTask(deal.tasks[idx])) {
            const isDone = e.target.checked;
            deal.tasks[idx].done = isDone;
            deal.tasks[idx].status = isDone ? 'done' : 'in_progress';
            saveDeals();
            renderProjectsView();
            renderKanban();
            showToast(isDone ? 'تم إنجاز المهمة بنجاح ✅' : 'تم تحديث حالة المهمة');
          }
        });
      });

      tbody.querySelectorAll('.task-status-selector').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const dealId = e.target.dataset.deal;
          const idx = e.target.dataset.idx;
          const deal = deals.find(d => d.id === dealId);
          if (deal && deal.tasks[idx] && canViewTask(deal.tasks[idx])) {
            deal.tasks[idx].status = e.target.value;
            deal.tasks[idx].done = (e.target.value === 'done');
            saveDeals();
            renderProjectsView();
            renderKanban();
            showToast(`تم تحديث حالة المهمة في ${deal.companyName}`);
          }
        });
      });

      tbody.querySelectorAll('.delete-master-task-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const dealId = e.target.dataset.deal;
          const idx = e.target.dataset.idx;
          const deal = deals.find(d => d.id === dealId);
          if (deal && deal.tasks[idx] && canViewTask(deal.tasks[idx])) {
            if (!prepareTaskDeletion(deal, deal.tasks[idx]?.id)) return;
            saveDeals();
            renderProjectsView();
            renderKanban();
            showToast('تم حذف المهمة');
          }
        });
      });

      // Render Mobile Cards for Projects View
      const mobileList = document.getElementById('masterTasksMobileList');
      if (mobileList) {
        mobileList.innerHTML = '';
        filteredTasks.forEach(item => {
          const t = item.task;
          const normStatus = t.status || (t.done ? 'done' : 'todo');
          const card = document.createElement('div');
          card.className = 'bg-white p-3.5 rounded-2xl border border-slate-200 shadow-sm space-y-2.5';
          
          const priorityColors = {
            'عالية': 'bg-rose-50 text-rose-700 border-rose-200',
            'متوسطة': 'bg-amber-50 text-amber-700 border-amber-200',
            'عادية': 'bg-slate-100 text-slate-700 border-slate-200'
          };

          const deliverableTag = t.deliverableUrl
            ? `<a href="${escapeHtml(safeDeliverableUrl(t.deliverableUrl))}" target="_blank" rel="noopener noreferrer" class="text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg inline-flex items-center gap-1 border border-blue-200">معاينة ↗</a>`
            : '';

          card.innerHTML = `
            <div class="flex items-start justify-between gap-2">
              <label class="flex items-start gap-2.5 cursor-pointer flex-1">
                <input type="checkbox" ${normStatus === 'done' ? 'checked' : ''} class="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-5 h-5 cursor-pointer mobile-master-task-check" data-deal="${item.dealId}" data-idx="${item.taskIndex}">
                <div>
                  <h5 class="text-xs font-bold ${normStatus === 'done' ? 'line-through text-slate-400' : 'text-slate-900'} leading-tight">${escapeHtml(t.title || t.text)}</h5>
                  <div class="text-[10px] text-blue-700 font-semibold mt-0.5">📁 ${escapeHtml(item.companyName)}</div>
                </div>
              </label>
              <button type="button" class="text-rose-500 hover:text-rose-700 p-1 text-xs font-bold mobile-del-master-btn" data-deal="${item.dealId}" data-idx="${item.taskIndex}" title="حذف المهمة">✕</button>
            </div>

            <div class="flex flex-wrap items-center gap-1.5 text-[10px]">
              <span class="font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">👤 ${escapeHtml(t.assignee || 'مؤمن النوساني')}</span>
              <span class="font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md">🛠️ ${escapeHtml(t.tool || 'ذكاء اصطناعي')}</span>
              <span class="font-bold px-1.5 py-0.5 rounded-md border ${priorityColors[t.priority] || priorityColors['متوسطة']}">⚡ ${escapeHtml(t.priority || 'متوسطة')}</span>
              <span class="text-slate-500 font-mono" dir="ltr">📅 ${escapeHtml(t.dueDate || 'بلا موعد')}</span>
            </div>

            <div class="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
              <div class="flex-1">
                <select class="w-full text-xs font-bold rounded-xl border border-slate-300 p-2 bg-slate-50 focus:outline-none focus:border-blue-500 mobile-master-status-sel min-h-[40px]" data-deal="${item.dealId}" data-idx="${item.taskIndex}">
                  <option value="todo" ${normStatus === 'todo' ? 'selected' : ''}>⏳ قيد الانتظار</option>
                  <option value="in_progress" ${normStatus === 'in_progress' ? 'selected' : ''}>🚀 قيد التنفيذ</option>
                  <option value="review" ${normStatus === 'review' ? 'selected' : ''}>🔍 مراجعة العميل</option>
                  <option value="done" ${normStatus === 'done' ? 'selected' : ''}>✅ مكتملة ومسلّمة</option>
                </select>
              </div>
              ${deliverableTag}
            </div>
          `;
          mobileList.appendChild(card);
        });

        mobileList.querySelectorAll('.mobile-master-task-check').forEach(chk => {
          chk.addEventListener('change', (e) => {
            const dealId = e.target.dataset.deal;
            const idx = e.target.dataset.idx;
            const deal = deals.find(d => d.id === dealId);
            if (deal && deal.tasks[idx] && canViewTask(deal.tasks[idx])) {
              const isDone = e.target.checked;
              deal.tasks[idx].done = isDone;
              deal.tasks[idx].status = isDone ? 'done' : 'in_progress';
              saveDeals();
              renderProjectsView();
              renderKanban();
              showToast(isDone ? 'تم إنجاز المهمة بنجاح ✅' : 'تم تحديث حالة المهمة');
            }
          });
        });

        mobileList.querySelectorAll('.mobile-master-status-sel').forEach(sel => {
          sel.addEventListener('change', (e) => {
            const dealId = e.target.dataset.deal;
            const idx = e.target.dataset.idx;
            const deal = deals.find(d => d.id === dealId);
            if (deal && deal.tasks[idx] && canViewTask(deal.tasks[idx])) {
              deal.tasks[idx].status = e.target.value;
              deal.tasks[idx].done = (e.target.value === 'done');
              saveDeals();
              renderProjectsView();
              renderKanban();
              showToast(`تم تحديث حالة المهمة في ${deal.companyName}`);
            }
          });
        });

        mobileList.querySelectorAll('.mobile-del-master-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const dealId = e.target.dataset.deal;
            const idx = e.target.dataset.idx;
            const deal = deals.find(d => d.id === dealId);
            if (deal && deal.tasks[idx] && canViewTask(deal.tasks[idx])) {
              if (!prepareTaskDeletion(deal, deal.tasks[idx]?.id)) return;
              saveDeals();
              renderProjectsView();
              renderKanban();
              showToast('تم حذف المهمة');
            }
          });
        });
      }
    }

    function autoGenerateServiceTasks() {
      if (getCurrentUser().role !== 'admin') { showToast('توليد مهام الخدمات متاح للمدير فقط.', 'error'); return; }
      if (!allowMutation('canEditDeals')) return;
      const selected = document.getElementById('filterTaskProject').value;
      const targets = selected === 'all' ? deals : deals.filter(deal => deal.id === selected);
      const candidate = CrmCore.clone(targets);
      const count = CrmCore.addServiceTasks(candidate, SERVICE_TASK_TEMPLATES, newRecordId);
      if (!count) { showToast('لا توجد مهام خدمة جديدة؛ احتُفظ بكل المهام الحالية.'); return; }
      if (!window.confirm('سيتم إضافة ' + count + ' مهمة جديدة قيد الانتظار، دون حذف أي مهمة. متابعة؟')) return;
      dealStore.backup('before-service-task-generation');
      const byId = new Map(candidate.map(deal => [deal.id, deal]));
      deals = deals.map(deal => byId.get(deal.id) || deal);
      saveDeals(); renderProjectsView(); renderTeamTasksView(); renderKanban();
      showToast('تمت إضافة ' + count + ' مهمة جديدة قيد الانتظار.');
    }

    function openProjectTaskModal(preselectedAssignee = null) {
      if (typeof preselectedAssignee !== 'string') preselectedAssignee = null;
      populateAssigneeSelects();
      const modal = document.getElementById('projectTaskModal');
      const form = document.getElementById('projectTaskForm');
      form.reset();

      const dealSelect = document.getElementById('taskDealSelect');
      dealSelect.innerHTML = '';
      deals.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = `${d.companyName} (${SERVICES[d.primaryService]?.split(' ')[1] || 'مشروع'})`;
        dealSelect.appendChild(opt);
      });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 2);
      document.getElementById('taskDueDateInput').value = tomorrow.toISOString().slice(0, 10);

      document.getElementById('taskAssigneeSelect').disabled = getCurrentUser().role !== 'admin';
      if (getCurrentUser().role !== 'admin') preselectedAssignee = getCurrentUser().id;
      if (preselectedAssignee && preselectedAssignee !== 'all') {
        document.getElementById('taskAssigneeSelect').value = preselectedAssignee;
      }

      const customGroup = document.getElementById('customToolGroup');
      if (customGroup) customGroup.classList.add('hidden');

      modal.classList.remove('hidden');
    }

    function handleProjectTaskSubmit(e) {
      e.preventDefault();
      if (!allowMutation('canEditDeals')) return;
      const dealId = document.getElementById('taskDealSelect').value;
      const title = document.getElementById('taskTitleInput').value.trim();
      const assigneeId = getCurrentUser().role === 'admin' ? document.getElementById('taskAssigneeSelect').value : getCurrentUser().id;
      const assignedUser = teamUsers.find(user=>user.id===assigneeId);
      const assignee = assignedUser?.name || (assigneeId==='client'?'العميل':'');
      const dueDate = document.getElementById('taskDueDateInput').value;
      const priority = document.getElementById('taskPrioritySelect').value;
      const status = document.getElementById('taskStatusSelect').value;
      const deliverableUrl = document.getElementById('taskDeliverableInput').value.trim();

      const toolSelect = document.getElementById('taskToolSelect').value;
      const customToolInput = document.getElementById('taskCustomToolInput');
      const finalTool = (toolSelect === 'أداة مخصصة' && customToolInput && customToolInput.value.trim())
        ? customToolInput.value.trim()
        : toolSelect;

      const deal = deals.find(d => d.id === dealId);
      if (deal) {
        if (!deal.tasks) deal.tasks = [];
        deal.tasks.push({
          id: newRecordId(),
          title: title,
          text: title,
          assignee: assignee,
          ...(assignedUser ? {assigneeUserId:assignedUser.id} : {}),
          tool: finalTool,
          dueDate: dueDate,
          priority: priority,
          status: status,
          done: status === 'done',
          deliverableUrl: deliverableUrl
        });

        saveDeals();
        document.getElementById('projectTaskModal').classList.add('hidden');
        renderProjectsView();
        renderTeamTasksView();
        renderKanban();
        showToast(`تمت إضافة المهمة بنجاح إلى مشروع ${deal.companyName}`);
      }
    }

    // --- RENDER DASHBOARD & CHARTS ---
    function renderDashboard() {
      const activeDeals = deals.filter(d => !['won','lost'].includes(d.stage));
      
      const wonDeals = deals.filter(d => d.stage === 'won');
      
      const retainers = deals.filter(d => d.contractType === 'retainer' && d.stage === 'won');
      
      const closedDealsCount = deals.filter(d => d.stage === 'won' || d.stage === 'lost').length;
      const winRate = closedDealsCount > 0 ? Math.round((wonDeals.length / closedDealsCount) * 100) : 0;

      document.getElementById('kpiTotalPipeline').textContent = financialTotalsText(activeDeals);
      document.getElementById('kpiRetainersMRR').textContent = financialTotalsText(retainers,true);
      document.getElementById('kpiWonValue').textContent = financialTotalsText(wonDeals);
      document.getElementById('kpiWonCount').textContent = `${wonDeals.length} صفقات مغلقة بنجاح`;
      document.getElementById('kpiConversionRate').textContent = `${winRate}%`;
      document.getElementById('kpiActiveCount').textContent = `${activeDeals.length} صفقة نشطة في المسار`;

      if (typeof Chart === 'undefined' || !getCurrentUserPermissions().canViewFinancials) {
        for (const chart of [stageChartInstance, contractChartInstance]) if (chart) chart.destroy();
        stageChartInstance = null; contractChartInstance = null;
        // This view may still contain an administrator's prior financial markup.
        document.getElementById('urgentFollowUpsList').textContent = 'افتح مسار الصفقات لمراجعة المتابعات. لا توجد تذكيرات تلقائية متصلة في النسخة الحالية.';
        return;
      }
      // 1. Stage Breakdown Chart
      const stageLabels = STAGES.map(s => s.name);
      const currencies=Object.keys(CrmCore.moneyTotals(deals));
      const stageDatasets=currencies.map((currency,index)=>({label:'قيمة الصفقات — '+currency,data:STAGES.map(stage=>deals.filter(d=>d.stage===stage.id&&d.currency===currency).reduce((sum,d)=>sum+Number(d.dealValue||0),0)),backgroundColor:['#0284c7','#8b5cf6','#10b981','#f59e0b'][index%4],borderRadius:6}));
      if (stageChartInstance) stageChartInstance.destroy();
      const ctxStage = document.getElementById('stageChart').getContext('2d');
      stageChartInstance = new Chart(ctxStage, {
        type: 'bar',
        data: {
          labels: stageLabels,
          datasets: stageDatasets
        },
        options: {
          maintainAspectRatio: false,
          responsive: true,
          plugins: { legend: { display: true } },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { callback: function(val) { return val.toLocaleString(); } }
            }
          }
        }
      });

      // 2. Contract Type Chart
      const retainerVal = deals.filter(d => d.contractType === 'retainer').length;
      const projectVal = deals.filter(d => d.contractType === 'project').length;

      if (contractChartInstance) contractChartInstance.destroy();
      const ctxContract = document.getElementById('contractChart').getContext('2d');
      contractChartInstance = new Chart(ctxContract, {
        type: 'doughnut',
        data: {
          labels: ['شراكات شهرية مستمرة (Retainers)', 'مشاريع محددة (Projects)'],
          datasets: [{
            data: [retainerVal, projectVal],
            backgroundColor: ['#10b981', '#3b82f6'],
            borderWidth: 2,
            borderColor: '#ffffff'
          }]
        },
        options: {
          maintainAspectRatio: false,
          responsive: true,
          plugins: { legend: { position: 'bottom' } }
        }
      });

      // 3. Services Demand Chart
      const serviceKeys = Object.keys(SERVICES);
      const serviceNames = serviceKeys.map(k => SERVICES[k].replace(/^\d+\s+/,''));
      const serviceCounts = serviceKeys.map(k => deals.filter(d => (d.services?.length?d.services:[d.primaryService]).includes(k)).length);

      if (servicesChartInstance) servicesChartInstance.destroy();
      const ctxServices = document.getElementById('servicesChart').getContext('2d');
      servicesChartInstance = new Chart(ctxServices, {
        type: 'bar',
        data: {
          labels: serviceNames,
          datasets: [{
            label: 'عدد الصفقات والطلبات',
            data: serviceCounts,
            backgroundColor: '#0284c7',
            borderRadius: 4
          }]
        },
        options: {
          maintainAspectRatio: false,
          responsive: true,
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { stepSize: 1 }, beginAtZero: true }
          }
        }
      });

      // 4. Urgent Follow-ups
      const urgentContainer = document.getElementById('urgentFollowUpsList');
      urgentContainer.innerHTML = '';
      const pendingDeals = deals.filter(d => d.stage === 'new_lead' || d.stage === 'proposal' || d.stage === 'negotiation').slice(0, 5);

      if (pendingDeals.length === 0) {
        urgentContainer.innerHTML = '<p class="text-xs text-slate-400 py-3 text-center">لا توجد متابعات عاجلة مطلوبة حالياً.</p>';
      } else {
        pendingDeals.forEach(deal => {
          const item = document.createElement('div');
          item.className = 'py-3 flex items-center justify-between gap-2';
          const stageName = STAGES.find(s => s.id === deal.stage)?.name;
          item.innerHTML = `
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-700">
                ${escapeHtml(deal.companyName.charAt(0))}
              </div>
              <div>
                <h5 class="font-bold text-xs text-slate-800">${escapeHtml(deal.companyName)}</h5>
                <p class="text-[11px] text-slate-500">${escapeHtml(deal.contactPerson)} &bull; ${stageName}</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-blue-600">${formatFinancialValue(deal.dealValue, deal.currency)}</span>
              <button class="bg-blue-600 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg hover:bg-blue-700 transition" onclick="openDetailsModal('${deal.id}')">
                متابعة
              </button>
            </div>
          `;
          urgentContainer.appendChild(item);
        });
      }
    }

    // --- RENDER CONTACTS TABLE ---
    function renderContactsTable() {
      const tbody = document.getElementById('contactsTableBody');
      tbody.innerHTML = '';
      document.getElementById('tableCountBadge').textContent = deals.length;

      deals.forEach(deal => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50 transition border-b border-slate-100';

        const stageObj = STAGES.find(s => s.id === deal.stage) || { name: deal.stage, badgeBg: 'bg-slate-100 text-slate-700' };
        const contractBadge = deal.contractType === 'retainer'
          ? '<span class="bg-emerald-50 text-emerald-700 text-xs px-2 py-0.5 rounded font-bold">شراكة شهرية</span>'
          : '<span class="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded font-bold">مشروع محدد</span>';

        const cleanPhone = (deal.contactPhone || '').replace(/[^0-9+]/g, '');
        const tasks = deal.tasks || [];
        const completedTasks = tasks.filter(t => t.done).length;

        tr.innerHTML = `
          <td class="py-3 px-4 font-bold text-slate-800">
            <div>${escapeHtml(deal.companyName)}</div>
            <div class="text-[11px] text-slate-400 font-normal">${escapeHtml(deal.source || 'موقع AdVance')} &bull; ${escapeHtml(deal.date)}</div>
          </td>
          <td class="py-3 px-4">
            <div class="font-medium text-slate-700">${escapeHtml(deal.contactPerson)}</div>
            <div class="text-xs text-slate-500" dir="ltr">${escapeHtml(deal.contactPhone)}</div>
          </td>
          <td class="py-3 px-4 text-xs font-semibold text-slate-600">
            ${SERVICES[deal.primaryService] || deal.primaryService}
          </td>
          <td class="py-3 px-4">${contractBadge}</td>
          <td class="py-3 px-4">
            <span class="text-xs font-bold px-2.5 py-1 rounded-full ${stageObj.badgeBg}">${stageObj.name}</span>
          </td>
          <td class="py-3 px-4 font-bold text-slate-800">${formatFinancialValue(deal.dealValue, deal.currency)}</td>
          <td class="py-3 px-4 text-xs text-slate-600">
            <span class="font-bold text-slate-700">${completedTasks}/${tasks.length}</span> منجز
          </td>
          <td class="py-3 px-4 text-center">
            <div class="flex items-center justify-center gap-1.5">
              <a href="https://wa.me/${cleanPhone}" target="_blank" rel="noopener noreferrer" class="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition" title="فتح محادثة واتساب">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/></svg>
              </a>
              <button class="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition" title="عرض التفاصيل" onclick="openDetailsModal('${deal.id}')">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              </button>
            </div>
          </td>
        `;

        tbody.appendChild(tr);
      });
    }

    // --- CSV EXPORT FUNCTION ---
    function exportToCsv() {
      if (!allowMutation('canExportCsv')) return;
      const headers = ['اسم الشركة', 'مسؤول التواصل', 'رقم الهاتف', 'البريد الإلكتروني', 'نوع التعاقد', 'الخدمة المطلوبة', 'المرحلة', 'قيمة الصفقة', 'العملة', 'السوق', 'تاريخ التسجيل'];
      const canSeeMoney=getCurrentUserPermissions().canViewFinancials;
      const rows = deals.map(deal => [deal.companyName,deal.contactPerson,deal.contactPhone,deal.contactEmail,deal.contractType==='retainer'?'شراكة شهرية مستمرة':'مشروع محدد',(deal.services?.length?deal.services:[deal.primaryService]).map(service=>SERVICES[service]||service).join(' + '),STAGES.find(stage=>stage.id===deal.stage)?.name||deal.stage,canSeeMoney?deal.dealValue:'غير متاح',canSeeMoney?deal.currency:'غير متاح',deal.market==='gulf'?'الخليج':'مصر',deal.date]);
      const csvContent='\uFEFF'+[headers,...rows].map(row=>row.map(CrmCore.csvCell).join(',')).join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `AdVance_CRM_Export_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      showToast('تم تصدير قاعدة بيانات العملاء إلى ملف CSV بنجاح');
    }

    // --- DETAILS MODAL, TASKS & ACTIVITY LOG ---
    function openDetailsModal(dealId) {
      const deal = deals.find(d => d.id === dealId);
      if (!deal) return;
      currentActiveDealId = dealId;

      document.getElementById('detailCompanyName').textContent = deal.companyName;
      document.getElementById('detailPersonName').textContent = deal.contactPerson || 'غير محدد';
      const phone = document.getElementById('detailPhoneLink');
      phone.textContent = deal.contactPhone || 'غير مسجل';
      phone.href = 'tel:' + (deal.contactPhone || '').replace(/[^0-9+]/g, '');
      const email = document.getElementById('detailEmailLink');
      email.textContent = deal.contactEmail || 'غير مسجل';
      if (deal.contactEmail) email.href = 'mailto:' + encodeURIComponent(deal.contactEmail);
      else email.removeAttribute('href');
      const permissions = getCurrentUserPermissions();
      const amount = document.getElementById('detailValue');
      amount.dataset.restricted = String(!permissions.canViewFinancials);
      amount.textContent = permissions.canViewFinancials ? getFinancialText(deal.dealValue, deal.currency, deal.contractType === 'retainer' ? ' / شهر' : '') : 'غير متاحة لهذا الحساب';
      document.getElementById('detailAmountLabel').textContent = deal.contractType === 'retainer' ? 'قيمة التعاقد الشهرية' : 'قيمة الصفقة';
      document.getElementById('detailDeleteBtn').hidden = !permissions.canDeleteDeals || permissions.isReadOnly;
      document.getElementById('detailEditBtn').hidden = !permissions.canEditDeals || permissions.isReadOnly;
      document.getElementById('openProposalBtn').hidden = !permissions.canCreateProposals || permissions.isReadOnly;
      const srvs = (deal.services && deal.services.length > 0) ? deal.services : [deal.primaryService];
      document.getElementById('detailService').innerHTML = srvs.map(s => `<span class="inline-block bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-bold mr-1 mb-1 border border-blue-200">${SERVICES[s] || s}</span>`).join('');
      document.getElementById('detailContractType').textContent = deal.contractType === 'retainer' ? 'شراكة شهرية مستمرة (Retainer)' : 'مشروع محدد (Project)';
      document.getElementById('detailStage').textContent = STAGES.find(s => s.id === deal.stage)?.name || deal.stage;
      document.getElementById('detailMarket').textContent = deal.market === 'gulf' ? 'الخليج العربي (السعودية / الإمارات)' : 'مصر (القاهرة / الجيزة)';
      document.getElementById('detailSource').textContent = ({website:'الموقع الإلكتروني',whatsapp:'WhatsApp',meta_ads:'إعلانات Meta',google_ads:'إعلانات Google',referral:'إحالة / ترشيح'})[deal.source] || deal.source || 'غير محدد';
      document.getElementById('detailDate').textContent = deal.date;
      document.getElementById('detailNotes').textContent = deal.notes || 'لا توجد ملاحظات إضافية.';

      const cleanPhone = (deal.contactPhone || '').replace(/[^0-9+]/g, '');
      const waMsg = encodeURIComponent(`أهلاً بك أستاذ ${deal.contactPerson}، معك فريق AdVance للنمو والتحول الرقمي بخصوص مشروع ${deal.companyName}.`);
      document.getElementById('detailWhatsAppLink').href = `https://wa.me/${cleanPhone}?text=${waMsg}`;

      document.getElementById('detailStageSelect').value = deal.stage;

      renderTasksList(deal);
      renderActivitiesList(deal);
      ContentPlans.render(deal);

      document.getElementById('detailsModal').classList.remove('hidden');
    }

    function renderTasksList(deal) {
      const container = document.getElementById('dealTasksList');
      container.innerHTML = '';
      const entries = (deal.tasks || []).map((task, idx) => ({ task, idx })).filter(entry => canViewTask(entry.task) && !entry.task.contentPlanId);
      const tasks = entries.map(entry => entry.task);
      const completed = tasks.filter(t => t.done).length;
      document.getElementById('tasksProgressBadge').textContent = `${completed}/${tasks.length} مكتمل`;

      if (tasks.length === 0) {
        container.innerHTML = '<p class="text-xs text-slate-400 py-1">لا توجد مهام حالياً. أضف مهمة لمتابعة مسار الصفقة.</p>';
        return;
      }

      entries.forEach(({ task, idx }) => {
        const item = document.createElement('div');
        item.className = 'flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200 text-xs';
        item.innerHTML = `
          <label class="flex items-center gap-2 cursor-pointer flex-1">
            <input type="checkbox" ${task.done ? 'checked' : ''} class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 task-check-toggle" data-idx="${idx}">
            <span class="${task.done ? 'line-through text-slate-400' : 'text-slate-700 font-semibold'}">${escapeHtml(task.text)}</span>
          </label>
          <button class="text-rose-500 hover:text-rose-700 p-1 text-[11px] task-delete-btn" data-idx="${idx}" title="حذف المهمة">✕</button>
        `;
        container.appendChild(item);
      });

      container.querySelectorAll('.task-check-toggle').forEach(chk => {
        chk.addEventListener('change', (e) => {
          const idx = e.target.dataset.idx;
          if (!canViewTask(deal.tasks[idx])) return;
          deal.tasks[idx].done = e.target.checked;
          deal.tasks[idx].status = e.target.checked ? 'done' : 'in_progress';
          saveDeals();
          renderTasksList(deal);
          renderKanban();
          renderProjectsView();
        });
      });

      container.querySelectorAll('.task-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = e.target.dataset.idx;
          if (!prepareTaskDeletion(deal, deal.tasks[idx]?.id)) return;
          saveDeals();
          renderTasksList(deal);
          renderKanban();
          showToast('تم حذف المهمة');
        });
      });
    }

    function addTaskToCurrentDeal() {
      if (!allowMutation('canEditDeals')) return;
      const input = document.getElementById('newTaskInput');
      const text = input.value.trim();
      if (!text || !currentActiveDealId) return;

      const deal = deals.find(d => d.id === currentActiveDealId);
      if (deal) {
        if (!deal.tasks) deal.tasks = [];
        deal.tasks.push({ id: newRecordId(), title: text, text, assignee: getCurrentUser().name, assigneeUserId: getCurrentUser().id, tool: '', dueDate: '', priority: 'متوسطة', status: 'todo', done: false, deliverableUrl: '' });
        saveDeals();
        input.value = '';
        renderTasksList(deal);
        renderKanban();
        showToast('تمت إضافة المهمة بنجاح');
      }
    }

    function renderActivitiesList(deal) {
      const container = document.getElementById('activitiesTimeline');
      container.innerHTML = '';
      const activities = deal.activities || [];
      document.getElementById('activityCount').textContent = `${activities.length} متابعات`;

      if (activities.length === 0) {
        container.innerHTML = '<p class="text-xs text-slate-400 py-2">لا توجد متابعات مسجلة بعد. أضف متابعة جديدة أعلاه.</p>';
        return;
      }

      const typeLabels = {
        call: { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: '📞 مكالمة' },
        whatsapp: { badge: 'bg-green-50 text-green-700 border-green-200', icon: '💬 واتساب' },
        meeting: { badge: 'bg-blue-50 text-blue-700 border-blue-200', icon: '🤝 اجتماع' },
        proposal: { badge: 'bg-purple-50 text-purple-700 border-purple-200', icon: '📄 عرض' },
        note: { badge: 'bg-slate-100 text-slate-700 border-slate-200', icon: '📝 ملاحظة' }
      };

      activities.forEach(act => {
        const div = document.createElement('div');
        div.className = 'bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs';
        const typeInfo = typeLabels[act.type] || typeLabels.note;
        div.innerHTML = `
          <div class="flex items-center justify-between text-[10px] mb-1">
            <span class="px-1.5 py-0.2 rounded border font-bold ${typeInfo.badge}">${typeInfo.icon}</span>
            <span class="text-slate-400">${escapeHtml(act.date)}</span>
          </div>
          <p class="text-slate-700 font-medium">${escapeHtml(act.text)}</p>
        `;
        container.appendChild(div);
      });
    }

    function addActivityToCurrentDeal() {
      if (!allowMutation('canEditDeals')) return;
      const input = document.getElementById('newActivityInput');
      const typeSelect = document.getElementById('activityTypeSelect');
      const text = input.value.trim();
      if (!text || !currentActiveDealId) return;

      const deal = deals.find(d => d.id === currentActiveDealId);
      if (deal) {
        if (!deal.activities) deal.activities = [];
        deal.activities.unshift({
          type: typeSelect.value || 'note',
          date: new Date().toISOString().replace('T', ' ').substring(0, 16),
          text: text
        });
        saveDeals();
        input.value = '';
        renderActivitiesList(deal);
        showToast('تمت إضافة المتابعة للسجل');
      }
    }

    // --- PROPOSAL GENERATOR MODAL ---
    function openProposalModal() {
      if (!allowMutation('canCreateProposals')) return;
      const deal = deals.find(d => d.id === currentActiveDealId);
      if (!deal) return;

      document.getElementById('propRef').textContent = `ADV-2026-${deal.id.replace('deal_', '')}`;
      document.getElementById('propDate').textContent = new Date().toISOString().slice(0, 10);
      document.getElementById('propClientCompany').textContent = deal.companyName;
      document.getElementById('propClientPerson').textContent = deal.contactPerson;
      document.getElementById('propClientPhone').textContent = deal.contactPhone;
      document.getElementById('propContractType').textContent = deal.contractType === 'retainer' ? 'شراكة شهرية مستمرة (Monthly Retainer)' : 'تعاون قائم على المشروع (Project Scope)';
      document.getElementById('propServiceTitle').textContent = SERVICES[deal.primaryService] || deal.primaryService;
      document.getElementById('propMarket').textContent = deal.market === 'gulf' ? 'الخليج العربي (السعودية / الإمارات)' : 'جمهورية مصر العربية';

      const propServices = (deal.services && deal.services.length > 0) ? deal.services : [deal.primaryService];
      document.getElementById('propServiceTitle').textContent = propServices.map(s => SERVICES[s] || s).join(' + ');

      const delivContainer = document.getElementById('propDeliverablesList');
      delivContainer.innerHTML = '';

      propServices.forEach(srvKey => {
        const srvTitle = SERVICES[srvKey] || srvKey;
        const deliverables = SERVICE_DELIVERABLES[srvKey] || [
          'تحليل الاحتياجات وتحديد نطاق العمل والجدول الزمني.',
          'تنفيذ خطة العمل وفق المخرجات المتفق عليها.'
        ];

        const srvHeading = document.createElement('li');
        srvHeading.className = 'font-bold text-slate-800 text-xs bg-slate-200/80 p-2 rounded mt-3 mb-1';
        srvHeading.textContent = `مخرجات منظومة: ${srvTitle}`;
        delivContainer.appendChild(srvHeading);

        deliverables.forEach((item, index) => {
          const li = document.createElement('li');
          li.className = 'flex items-start gap-2 bg-slate-50 p-2 rounded border border-slate-100 mr-2';
          li.innerHTML = `<span class="font-bold text-blue-600">${index + 1}.</span> <span>${item}</span>`;
          delivContainer.appendChild(li);
        });
      });

      const currency = deal.currency || 'ج.م';
      const isRetainer = deal.contractType === 'retainer';
      document.getElementById('propFinancialValue').innerHTML = formatFinancialValue(deal.dealValue, currency, isRetainer);
      document.getElementById('propPaymentTerms').textContent = isRetainer
        ? '* يتم سداد المقابل الشهري في بداية كل شهر تعاقدي، مع تقديم تقرير الإنجاز ومؤشرات الأداء في اليوم 25 من كل شهر.'
        : '* نظام السداد: 50% دفعة مقدمة عند بدء المشروع، و50% عند الاعتماد النهائي لكافة المخرجات المتفق عليها.';

      document.getElementById('proposalModal').classList.remove('hidden');
    }

    // --- ADD / EDIT DEAL MODAL ---
    function openAddDealModal(deal = null) {
      const perms = getCurrentUserPermissions();
      if (!deal && (!perms.canCreateDeals || perms.isReadOnly)) {
        showToast('عذراً، حسابك لا يملك صلاحية إنشاء صفقات جديدة (صلاحية أدمن)');
        return;
      }
      if (deal && (!perms.canEditDeals || perms.isReadOnly)) {
        showToast('عذراً، حسابك لا يملك صلاحية تعديل بيانات الصفقات (صلاحية أدمن)');
        return;
      }
      const modal = document.getElementById('dealModal');
      const form = document.getElementById('dealForm');
      form.reset();

      if (deal) {
        document.getElementById('modalTitle').textContent = 'تعديل بيانات الصفقة';
        document.getElementById('dealId').value = deal.id;
        document.getElementById('companyName').value = deal.companyName;
        document.getElementById('contactPerson').value = deal.contactPerson;
        document.getElementById('contactPhone').value = deal.contactPhone;
        document.getElementById('contactEmail').value = deal.contactEmail || '';
        document.getElementById('contractType').value = deal.contractType;
        document.getElementById('primaryService').value = deal.primaryService;
        document.getElementById('dealValue').value = perms.canViewFinancials ? deal.dealValue : '';
        document.getElementById('dealValue').required = perms.canViewFinancials;
        document.getElementById('dealValue').disabled = !perms.canViewFinancials;
        document.getElementById('dealCurrency').disabled = !perms.canViewFinancials;
        document.getElementById('dealCurrency').value = deal.currency || 'ج.م';
        document.getElementById('dealStage').value = deal.stage;
        document.getElementById('dealMarket').value = deal.market;
        document.getElementById('leadSource').value = deal.source || 'website';
        document.getElementById('dealNotes').value = deal.notes || '';
        selectedDealServices = (deal.services && deal.services.length > 0) ? [...deal.services] : [deal.primaryService || 'growth_strategy'];
      } else {
        document.getElementById('modalTitle').textContent = 'إضافة صفقة / عميل جديد';
        document.getElementById('dealId').value = '';
        document.getElementById('dealValue').required = true;
        document.getElementById('dealValue').disabled = false;
        document.getElementById('dealCurrency').disabled = false;
        document.getElementById('dealStage').value = 'new_lead';
        document.getElementById('dealCurrency').value = 'ج.م';
        selectedDealServices = ['growth_strategy'];
      }

      renderDealServicesPills();
      modal.classList.remove('hidden');
    }

    function handleDealFormSubmit(e) {
      e.preventDefault();
      const id = document.getElementById('dealId').value;
      if (!allowMutation(id ? 'canEditDeals' : 'canCreateDeals')) return;
      if (!document.getElementById('dealForm').reportValidity()) return;
      const companyName = document.getElementById('companyName').value.trim();
      const contactPerson = document.getElementById('contactPerson').value.trim();
      const contactPhone = document.getElementById('contactPhone').value.trim();
      const contactEmail = document.getElementById('contactEmail').value.trim();
      const contractType = document.getElementById('contractType').value;
      const primaryService = document.getElementById('primaryService').value;
      const originalDeal = id ? deals.find(deal => deal.id === id) : null;
      const preserveFinancials = originalDeal && !getCurrentUserPermissions().canViewFinancials;
      const dealValue = preserveFinancials ? originalDeal.dealValue : Number(document.getElementById('dealValue').value);
      const currency = preserveFinancials ? originalDeal.currency : document.getElementById('dealCurrency').value;
      const stage = document.getElementById('dealStage').value;
      const market = document.getElementById('dealMarket').value;
      const source = document.getElementById('leadSource').value;
      const notes = document.getElementById('dealNotes').value.trim();

      const activeServices = (selectedDealServices.length > 0) ? [...selectedDealServices] : [primaryService];
      const mainService = primaryService;
      if (!activeServices.includes(mainService)) activeServices.unshift(mainService);

      if (!companyName || !contactPerson || !contactPhone || !Number.isFinite(dealValue) || dealValue < 0 || !SERVICES[mainService]) { showToast('راجع الحقول المطلوبة وقيمة الصفقة.', 'error'); return; }
      if (id && !deals.some(deal => deal.id === id)) { showToast('الصفقة غير موجودة. أعد فتح القائمة.', 'error'); return; }
      if (id) {
        const deal = deals.find(d => d.id === id);
        if (deal) {
          deal.companyName = companyName;
          deal.contactPerson = contactPerson;
          deal.contactPhone = contactPhone;
          deal.contactEmail = contactEmail;
          deal.contractType = contractType;
          deal.primaryService = mainService;
          deal.services = activeServices;
          deal.dealValue = dealValue;
          deal.currency = currency;
          deal.stage = stage;
          deal.market = market;
          deal.source = source;
          deal.notes = notes;

        }
      } else {
        const newDeal = {
          id: newRecordId(),
          companyName,
          contactPerson,
          contactPhone,
          contactEmail,
          contractType,
          primaryService: mainService,
          services: activeServices,
          dealValue,
          currency,
          stage,
          market,
          source,
          date: new Date().toISOString().slice(0, 10),
          notes,
          tasks: [
            { id: newRecordId(), title: 'الاتصال بالعميل وعقد جلسة الاكتشاف الأولى', text: 'الاتصال بالعميل وعقد جلسة الاكتشاف الأولى', assignee: 'مؤمن النوساني', tool: 'كلود (Claude)', dueDate: new Date().toISOString().slice(0, 10), priority: 'عالية', status: 'todo', done: false }
          ],
          activities: [
            {
              type: 'note',
              date: new Date().toISOString().replace('T', ' ').substring(0, 16),
              text: 'تم إنشاء الصفقة وتسجيلها في النظام.'
            }
          ]
        };
        deals.unshift(newDeal);

      }

      saveDeals();
      showToast(id ? 'تم حفظ تعديلات الصفقة.' : 'تم حفظ الصفقة الجديدة.');
      document.getElementById('dealModal').classList.add('hidden');
      renderKanban();
      renderContactsTable();
    }

    function deleteCurrentDeal() {
      if (!allowMutation('canDeleteDeals') || !currentActiveDealId) return;
      const deal = deals.find(item => item.id === currentActiveDealId);
      if (!deal || !window.confirm('حذف الصفقة وكل مهامها وأنشطتها؟ ستُحفظ نسخة استرجاع قبل الحذف.')) return;
      dealStore.backup('before-delete-deal');
      deals = deals.filter(item => item.id !== currentActiveDealId);
      saveDeals(); currentActiveDealId = null;
      document.getElementById('detailsModal').classList.add('hidden');
      renderKanban(); renderContactsTable(); renderProjectsView(); renderTeamTasksView();
      showToast('تم حذف الصفقة. يمكن استرجاع النسخة السابقة من شريط النسخ الاحتياطي.');
    }

    document.addEventListener('DOMContentLoaded', () => {
      setupRecoveryActions();
      ContentPlans.setup();
      if (!loadUsers()) return;
      populateUserSwitcherSelect();
      updateUIForCurrentPermissions();
      function authenticateUser(username, password) {
        const uLower = (username || '').trim().toLowerCase();
        const pTrim = (password || '').trim();

        const matched = teamUsers.find(u => {
          const matchU = (u.username && u.username.toLowerCase() === uLower) || (u.id.toLowerCase() === uLower) || (u.name.toLowerCase() === uLower);
          const matchP = (u.password && u.password === pTrim) || (!u.password && pTrim === 'demo-admin-only');
          return matchU && matchP;
        });

        if (matched) {
          document.getElementById('detailsModal').classList.add('hidden');
          document.getElementById('dealTasksList').textContent = '';
          currentUserId = matched.id;
          try {
            sessionStorage.setItem('advance_crm_repair_session_v1', matched.id);
          } catch(e) {}
          document.getElementById('loginOverlay').classList.add('hidden');
          updateUIForCurrentPermissions();
          renderRolesDashboard();
          renderKanban();
          renderContactsTable();
          renderDashboard();
          renderProjectsView();
          if (document.getElementById('teamTasksView') && !document.getElementById('teamTasksView').classList.contains('hidden')) {
            renderTeamTasksView();
          }
          showToast(`مرحباً بك يا ${matched.name}! تم تسجيل الدخول بنجاح`);
          return true;
        } else {
          showToast('اسم المستخدم أو كلمة المرور غير صحيحة', 'error');
          return false;
        }
      }

      // Login form submit
      const loginForm = document.getElementById('loginForm');
      if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const u = document.getElementById('loginUsername').value;
          const p = document.getElementById('loginPassword').value;
          authenticateUser(u, p);
        });
      }

      // Toggle password visibility in login
      const togglePwdBtn = document.getElementById('toggleLoginPasswordBtn');
      if (togglePwdBtn) {
        togglePwdBtn.addEventListener('click', () => {
          const pwdInput = document.getElementById('loginPassword');
          if (pwdInput.type === 'password') {
            pwdInput.type = 'text';
            togglePwdBtn.textContent = '🔒';
          } else {
            pwdInput.type = 'password';
            togglePwdBtn.textContent = '👁️';
          }
        });
      }

// Quick login buttons removed for security

      // Logout button
      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
          try {
            sessionStorage.removeItem('advance_crm_repair_session_v1');
          } catch(e) {}
          document.getElementById('loginUsername').value = '';
          document.getElementById('loginPassword').value = '';
          document.getElementById('loginOverlay').classList.remove('hidden');
          showToast('تم تسجيل الخروج بنجاح. أهلاً بك مجدداً.');
        });
      }

      // Check session on load
      let savedSession = null;
      try {
        savedSession = sessionStorage.getItem('advance_crm_repair_session_v1');
      } catch(e) {}

      if (savedSession && teamUsers.some(u => u.id === savedSession)) {
        currentUserId = savedSession;
        updateUIForCurrentPermissions();
        document.getElementById('loginOverlay').classList.add('hidden');
      } else {
        // Show login overlay by default for security
        document.getElementById('loginOverlay').classList.remove('hidden');
      }


      // User Switcher in Header
      const userSel = document.getElementById('activeUserSelector');
      if (userSel) {
        userSel.addEventListener('change', (e) => {
          switchActiveUser(e.target.value);
        });
      }

      // Add User Modal
      const openUserModalBtn = document.getElementById('openAddUserModalBtn');
      if (openUserModalBtn) {
        openUserModalBtn.addEventListener('click', () => {
          if (!requireTeamManager()) return;
          document.getElementById('addUserForm').reset();
          document.getElementById('addUserModal').classList.remove('hidden');
        });
      }
      const closeUserModalBtn = document.getElementById('closeAddUserModalBtn');
      if (closeUserModalBtn) closeUserModalBtn.addEventListener('click', () => document.getElementById('addUserModal').classList.add('hidden'));
      const cancelUserModalBtn = document.getElementById('cancelAddUserModalBtn');
      if (cancelUserModalBtn) cancelUserModalBtn.addEventListener('click', () => document.getElementById('addUserModal').classList.add('hidden'));
      for (const id of ['closeChangePasswordModalBtn','cancelChangePasswordModalBtn']) {
        document.getElementById(id).addEventListener('click',()=>document.getElementById('changePasswordModal').classList.add('hidden'));
      }
      document.getElementById('changePasswordForm').addEventListener('submit',event=>{
        event.preventDefault();
        if(!requireTeamManager())return;
        const target=teamUsers.find(user=>user.id===document.getElementById('changePasswordUserId').value);
        const password=document.getElementById('newPasswordInput').value.trim();
        if(!target||password.length<8){showToast('اختر مستخدمًا وكلمة مرور لا تقل عن 8 أحرف.','error');return;}
        target.password=password;saveUsers();
        document.getElementById('newPasswordInput').value='';
        document.getElementById('changePasswordModal').classList.add('hidden');
        showToast('تم تغيير كلمة المرور المحلية.');
      });

      const addUserForm = document.getElementById('addUserForm');
      if (addUserForm) {
        addUserForm.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!requireTeamManager()) return;
          const name = document.getElementById('newUserNameInput').value.trim();
          const roleTitle = document.getElementById('newUserRoleTitleInput').value.trim();
          const canViewFin = document.getElementById('permNewFinancials').checked;
          const isReadOnly = document.getElementById('permNewReadOnly').checked;
          const canCreate = document.getElementById('permNewCreateDeals').checked;
          const canEdit = document.getElementById('permNewEditDeals').checked;
          const canDelete = document.getElementById('permNewDeleteDeals').checked;
          const canProp = document.getElementById('permNewProposals').checked;
          const canExport = document.getElementById('permNewExportCsv').checked;

          const username = (document.getElementById('newUserUsernameInput') ? document.getElementById('newUserUsernameInput').value.trim().toLowerCase() : '') || ('user_' + Date.now());
          const password = (document.getElementById('newUserPasswordInput') ? document.getElementById('newUserPasswordInput').value.trim() : '') || 'demo-admin-only';

          // Check if username already exists
          if (teamUsers.some(u => u.username === username)) {
            showToast('اسم المستخدم هذا مسجل مسبقاً، اختر اسماً آخر');
            return;
          }

          const newId = 'u_' + Date.now();
          const newUser = {
            id: newId,
            username: username,
            password: password,
            name: name,
            role: 'member',
            roleLabel: roleTitle,
            avatar: '👤',
            canViewFinancials: canViewFin,
            isReadOnly: isReadOnly,
            canCreateDeals: canCreate,
            canEditDeals: canEdit,
            canDeleteDeals: canDelete,
            canCreateProposals: canProp,
            canExportCsv: canExport,
            canAccessIntegrations: false,
            canManageRoles: false
          };

          teamUsers.push(newUser);
          saveUsers();
          populateUserSwitcherSelect();
          populateAssigneeSelects();
          renderRolesDashboard();
          document.getElementById('addUserModal').classList.add('hidden');
          showToast(`تمت إضافة العضو ${name} وتحديد صلاحياته بنجاح`);
        });
      }


      if (!loadDeals()) return;
      setupTabs();
      renderKanban();

      // Filters & Sorting (Desktop)
      document.getElementById('filterContract').addEventListener('change', renderKanban);
      document.getElementById('filterService').addEventListener('change', renderKanban);
      document.getElementById('filterMarket').addEventListener('change', renderKanban);
      document.getElementById('sortDeals').addEventListener('change', renderKanban);
      document.getElementById('globalSearch').addEventListener('input', renderKanban);

      // Mobile Search Input & Two-way Sync
      const mobSearch = document.getElementById('mobileSearchInput');
      if (mobSearch) {
        mobSearch.addEventListener('input', (e) => {
          document.getElementById('globalSearch').value = e.target.value;
          renderKanban();
        });
      }

      // Mobile Filter Drawer Modal setup
      const openMobFilterBtn = document.getElementById('openMobileFilterModalBtn');
      if (openMobFilterBtn) {
        openMobFilterBtn.addEventListener('click', () => {
          document.getElementById('filterContractMobile').value = document.getElementById('filterContract').value;
          document.getElementById('filterServiceMobile').value = document.getElementById('filterService').value;
          document.getElementById('filterMarketMobile').value = document.getElementById('filterMarket').value;
          document.getElementById('sortDealsMobile').value = document.getElementById('sortDeals').value;
          document.getElementById('mobileFilterModal').classList.remove('hidden');
        });
      }

      const closeMobFilterBtn = document.getElementById('closeMobileFilterBtn');
      if (closeMobFilterBtn) {
        closeMobFilterBtn.addEventListener('click', () => {
          document.getElementById('mobileFilterModal').classList.add('hidden');
        });
      }

      const applyMobFilterBtn = document.getElementById('applyMobileFiltersBtn');
      if (applyMobFilterBtn) {
        applyMobFilterBtn.addEventListener('click', () => {
          document.getElementById('filterContract').value = document.getElementById('filterContractMobile').value;
          document.getElementById('filterService').value = document.getElementById('filterServiceMobile').value;
          document.getElementById('filterMarket').value = document.getElementById('filterMarketMobile').value;
          document.getElementById('sortDeals').value = document.getElementById('sortDealsMobile').value;
          document.getElementById('mobileFilterModal').classList.add('hidden');
          renderKanban();
          showToast('تم تطبيق الفلاتر بنجاح');
        });
      }

      const resetMobFilterBtn = document.getElementById('resetMobileFiltersBtn');
      if (resetMobFilterBtn) {
        resetMobFilterBtn.addEventListener('click', () => {
          document.getElementById('filterContract').value = 'all';
          document.getElementById('filterService').value = 'all';
          document.getElementById('filterMarket').value = 'all';
          document.getElementById('sortDeals').value = 'date_desc';
          document.getElementById('filterContractMobile').value = 'all';
          document.getElementById('filterServiceMobile').value = 'all';
          document.getElementById('filterMarketMobile').value = 'all';
          document.getElementById('sortDealsMobile').value = 'date_desc';
          document.getElementById('mobileFilterModal').classList.add('hidden');
          renderKanban();
          showToast('تمت إعادة ضبط الفلاتر بنجاح');
        });
      }

      // Mobile Header Quick Actions
      const mobAddDealBtn = document.getElementById('mobileHeaderAddDealBtn');
      if (mobAddDealBtn) {
        mobAddDealBtn.addEventListener('click', () => {
          openAddDealModal();
        });
      }

      const mobLogoutBtn = document.getElementById('mobileHeaderLogoutBtn');
      if (mobLogoutBtn) {
        mobLogoutBtn.addEventListener('click', () => {
          document.getElementById('logoutBtn').click();
        });
      }

      // Mobile User Modal Setup
      const mobUserMenuBtn = document.getElementById('mobileUserMenuBtn');
      if (mobUserMenuBtn) {
        mobUserMenuBtn.addEventListener('click', () => {
          document.getElementById('mobileUserModal').classList.remove('hidden');
        });
      }

      const closeMobUserBtn = document.getElementById('closeMobileUserBtn');
      if (closeMobUserBtn) {
        closeMobUserBtn.addEventListener('click', () => {
          document.getElementById('mobileUserModal').classList.add('hidden');
        });
      }

      document.querySelectorAll('.mobile-switch-account-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const uid = btn.dataset.uid;
          document.getElementById('mobileUserModal').classList.add('hidden');
          switchActiveUser(uid);
        });
      });

      const mobUserModalLogoutBtn = document.getElementById('mobileUserModalLogoutBtn');
      if (mobUserModalLogoutBtn) {
        mobUserModalLogoutBtn.addEventListener('click', () => {
          document.getElementById('mobileUserModal').classList.add('hidden');
          document.getElementById('logoutBtn').click();
        });
      }

      // Reset data
      document.getElementById('resetSampleDataBtn').addEventListener('click', () => {
        if (!allowMutation('canDeleteDeals')) return;
        if (!window.confirm('سيتم استبدال كل الصفقات الحالية بعينة تجريبية. ستُحفظ نسخة استرجاع. هل تريد المتابعة؟')) return;
        dealStore.backup('before-reset-demo');
        deals = CrmCore.clone(INITIAL_DEALS);
        saveDeals();
        renderKanban();
        renderContactsTable();
        showToast('تمت استعادة البيانات الافتراضية بنجاح');
      });

      // Modals setup
      document.getElementById('openAddDealModalBtn').addEventListener('click', () => openAddDealModal());
      document.getElementById('closeModalBtn').addEventListener('click', () => document.getElementById('dealModal').classList.add('hidden'));
      document.getElementById('cancelModalBtn').addEventListener('click', () => document.getElementById('dealModal').classList.add('hidden'));
      document.getElementById('dealForm').addEventListener('submit', handleDealFormSubmit);

      // Details Modal setup
      document.getElementById('closeDetailsModalBtn').addEventListener('click', () => document.getElementById('detailsModal').classList.add('hidden'));
      document.getElementById('detailEditBtn').addEventListener('click', () => {
        const deal = deals.find(d => d.id === currentActiveDealId);
        document.getElementById('detailsModal').classList.add('hidden');
        openAddDealModal(deal);
      });
      document.getElementById('detailDeleteBtn').addEventListener('click', deleteCurrentDeal);
      
      // Tasks in Details Modal
      document.getElementById('addTaskBtn').addEventListener('click', addTaskToCurrentDeal);
      document.getElementById('newTaskInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addTaskToCurrentDeal();
      });

      // Activities in Details Modal
      document.getElementById('addActivityBtn').addEventListener('click', addActivityToCurrentDeal);
      document.getElementById('newActivityInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addActivityToCurrentDeal();
      });

      // Stage quick change
      document.getElementById('detailStageSelect').addEventListener('change', (e) => {
        if (currentActiveDealId) {
          moveDealToStage(currentActiveDealId, e.target.value);
          const deal = deals.find(d => d.id === currentActiveDealId);
          document.getElementById('detailStage').textContent = STAGES.find(s => s.id === e.target.value)?.name || e.target.value;
          renderActivitiesList(deal);
        }
      });

      // Proposal Modal buttons
      document.getElementById('openProposalBtn').addEventListener('click', openProposalModal);
      document.getElementById('closeProposalModalBtn').addEventListener('click', () => document.getElementById('proposalModal').classList.add('hidden'));
      document.getElementById('printProposalBtn').addEventListener('click', () => window.print());

      // Projects & Tasks Delivery Management Event Listeners
      document.getElementById('filterTaskProject').addEventListener('change', renderProjectsView);
      document.getElementById('filterTaskAssignee').addEventListener('change', renderMasterTasksTable);
      document.getElementById('filterTaskStatus').addEventListener('change', renderMasterTasksTable);
      document.getElementById('autoGenerateTasksBtn').addEventListener('click', autoGenerateServiceTasks);

      document.getElementById('openAddTaskModalBtn').addEventListener('click', openProjectTaskModal);
      document.getElementById('closeTaskModalBtn').addEventListener('click', () => document.getElementById('projectTaskModal').classList.add('hidden'));
      document.getElementById('cancelTaskModalBtn').addEventListener('click', () => document.getElementById('projectTaskModal').classList.add('hidden'));
      document.getElementById('projectTaskForm').addEventListener('submit', handleProjectTaskSubmit);

      // Export CSV
      document.getElementById('exportCsvBtn').addEventListener('click', exportToCsv);

      // Automation test buttons
      document.querySelectorAll('.test-automation-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const actionName = btn.dataset.action || 'اختبار الأتمتة';
          showToast('محاكاة فقط: لم تُرسل أي رسالة أو مهمة خارج النظام.');
        });
      });

      // Automation toggles
      document.querySelectorAll('.auto-toggle').forEach(tgl => {
        tgl.addEventListener('change', (e) => {
          const status = e.target.checked ? 'تفعيل' : 'إيقاف';
          showToast('هذا المفتاح للعرض فقط؛ الأتمتة غير موصولة بعد.');
        });
      });

      // Integrations Tab: Copy Code
      document.getElementById('copyFormCodeBtn').addEventListener('click', () => {
        const code = document.getElementById('embedFormCodeBlock').innerText;
        navigator.clipboard.writeText(code).then(() => {
          showToast('تم نسخ كود النموذج إلى الحافظة بنجاح');
        }).catch(() => {
          showToast('تم تحديد الكود لنسخه');
        });
      });

      // Integrations Tab: Smart WhatsApp Link Generator
      document.getElementById('generateWaLinkBtn').addEventListener('click', () => {
        const srv = document.getElementById('waGenService').value;
        const cmp = document.getElementById('waGenCampaign').value || 'الموقع الإلكتروني';
        const msg = `مرحباً فريق AdVance، أود الاستفسار عن خدمة (${srv}) - القناة: ${cmp}`;
        const url = `https://wa.me/201148484548?text=${encodeURIComponent(msg)}`;
        document.getElementById('generatedWaUrlInput').value = url;
        showToast('تم توليد رابط الواتساب بنجاح');
      });

      document.getElementById('copyWaUrlBtn').addEventListener('click', () => {
        const url = document.getElementById('generatedWaUrlInput').value;
        navigator.clipboard.writeText(url).then(() => {
          showToast('تم نسخ رابط الواتساب الذكي');
        });
      });

      // Team Tasks view filters & actions
      const memberStatusFilter = document.getElementById('filterMemberTaskStatus');
      if (memberStatusFilter) memberStatusFilter.addEventListener('change', renderTeamTasksView);
      const memberToolFilter = document.getElementById('filterMemberTaskTool');
      if (memberToolFilter) memberToolFilter.addEventListener('change', renderTeamTasksView);

      const quickAddBtn = document.getElementById('quickAddMemberTaskBtn');
      if (quickAddBtn) {
        quickAddBtn.addEventListener('click', () => {
          openProjectTaskModal(activeTeamMember);
        });
      }

      // Tool selector custom tool toggle
      const taskToolSel = document.getElementById('taskToolSelect');
      if (taskToolSel) {
        taskToolSel.addEventListener('change', (e) => {
          const customGrp = document.getElementById('customToolGroup');
          if (customGrp) {
            if (e.target.value === 'أداة مخصصة') {
              customGrp.classList.remove('hidden');
            } else {
              customGrp.classList.add('hidden');
            }
          }
        });
      }

      // Integrations Tab: Test API endpoint
      document.getElementById('testApiBtn').addEventListener('click', () => {
        const endpoint = document.getElementById('apiEndpointInput').value;
        showToast('اختبار الخادم غير منفذ في النسخة المحلية الحالية.');
        setTimeout(() => {
          showToast('جاهز للربط مع سيرفر هوستنجر بمجرد رفع api.php');
        }, 1200);
      });
    });
  
