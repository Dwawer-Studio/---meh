# تقرير المرحلة P2 — الخدمة الاجتماعية صاحبة السلطة

التاريخ: 2026-08-28

الحالة: `Engineering Complete / Validation Deferred`

## حدود المرحلة

غيّرت P2 السلطة والاعتمادية والتخزين فقط. لم تغيّر تعريف بطاقة أو صورتها أو
وصفة `classic-60-v1` أو اقتصاد تاماشي الذي يبدأ في P4. يبقى PeerJS مسارًا
وديًا قديمًا بلا نتيجة/تاماشي موثوقين، وتُفعّل الخدمة الجديدة بعلم مستقل وعنوان
خدمة صريح.

## قائمة الإغلاق

- [x] ADR للسلطة الخادمية وحدود الحتمية.
- [x] ADR لقاعدة البيانات والنقل والاحتفاظ.
- [x] عقد بروتوكول وتسلسل وidempotency وتنقيح.
- [x] `MatchReducer` مشترك وحتمي، مع adapter للعميل والخادم.
- [x] خدمة غرف وحضور وseat leases واستعادة وتدوير للرمز.
- [x] WebSocket heartbeat وتسلسل وإعادة snapshot واسترجاع عميل تلقائي.
- [x] حساب guest وترقية ودخول اختياريان ومزامنة إعدادات/عضويات وحذف فعلي.
- [x] هجرات PostgreSQL ونسخ/استعادة منطقية مشفرة مجربة.
- [x] مراقبة وحدود معدل وسجل تدقيق واختبارات إساءة وإعادة رسالة.
- [x] quick play فوري مع bot backfill.
- [x] نموذج حمل وsoak وأمان و10,000 replay بلا اختلاف.
- [x] `check:clean` من lockfile وcache مؤقت معزول.
- [x] كوميت التنفيذ `d37fa98` وُرفع؛ ثم يُطابق رأس الفرع المحلي والبعيد بعد
  كوميت توثيق الإغلاق.

## أدلة التنفيذ

| المجال | الدليل | النتيجة المسجلة |
|---|---|---|
| Core Lock | `git diff --name-only -- assets/cards` + manifest diff | لا ملف بطاقة/صورة متغير؛ تعديل manifest الوحيد تصدير CommonJS لنفس القيم |
| الحتمية | `npm run test:p2:replay` | 10,000/10,000؛ 470,828 فعلًا؛ mismatch=0؛ max=284؛ كل 22 تعريف بطاقة لُعب |
| خدمة P2 | `npm run test:p2` | 17/17: reducer، البروتوكول، WebSocket، الحساب، الاسترجاع، الاحتفاظ وPostgreSQL |
| PostgreSQL | `tests/p2-postgres-integration.test.js` | تطبيق الهجرة مرتين، مباراة محفوظة، sync، حذف هوية، backup مشفر، restore مستقل، وprune |
| الاسترجاع | `npm run test:p2:recovery` | 1,000/1,000 خلال 30s؛ RCR هندسي=100%؛ p95 محلي=0.0852ms |
| متصفح فعلي | `tests/e2e/authoritative.spec.js` | قطع WebSocket، استعادة وتدوير token، استمرار اللعب، ومنع dev mutation |
| حمل النقل | `npm run test:p2:network-load` | 64/64 WebSocket؛ أخطاء=0؛ p95 ACK محلي=96.6227ms |
| staircase | `npm run test:p2:load` | 8/16/32/64 غرفة؛ MCR=100% وcrash-free=100% في كل درجة؛ p95 الأعلى=70.2216ms |
| soak | نفس البوابة مع `MEH_P2_SOAK_MS=120000` | 120.103s؛ 11,058/11,058 غرفة؛ 291 دفعة عند 38 متزامنة؛ أخطاء=0؛ max heap=144,524,440 bytes |
| أمن التبعيات | `npm audit --audit-level=high` | `found 0 vulnerabilities` بتاريخ التقرير |
| regression | `npm run check` | 168/168 Node و9/9 Browser؛ HTML/CSS/syntax خضراء |
| clean tree | `npm run check:clean` | تثبيت 265 حزمة من lockfile؛ 168/168 + 9/9؛ الشجرة المعزولة نظيفة |

## ما لا تدعيه هذه الأدلة

- p95 أعلاه محلي وليس قياس السعودية/البحرين/الكويت. القياس الإقليمي هو
  `P2-H01` ولا يحق استبداله بالرقم المحلي.
- اختبار الحمل الكامل استخدم MemoryStore، بينما PGlite أثبت صحة SQL والمعاملات
  وظيفيًا؛ لم يثبت سعة PostgreSQL مُدار. حمل الإطلاق في `P2-H03`.
- النسخة المنطقية المشفرة واستعادتها نجحتا، لكن WAL/PITR وRPO/RTO في بيئة
  production-like هما `P2-O01`.
- 1,000 استعادة هندسية لا تستبدل `P2-H02` على شبكات وأجهزة مستخدمين حقيقيين.
- الطرح والرجوع موثقان ولم ينفذا على حركة حقيقية؛ ذلك `P2-O02`.

لذلك الحالة الصحيحة هي `Engineering Complete / Validation Deferred`، وليست
`Validated` أو جاهزية إطلاق عام.

## مراجع التشغيل

- `docs/P2-PROTOCOL.md`
- `docs/P2-OPERATIONS-RUNBOOK.md`
- `docs/P2-CAPACITY-MODEL.md`
- `docs/P2-ROLLOUT-ROLLBACK.md`
- `docs/THREAT-MODEL-P2.md`
- `docs/DEFERRED-VALIDATION-REGISTER.md`
- `docs/adr/0007-authoritative-match-service.md`
- `docs/adr/0008-postgresql-realtime-boundary.md`

لا يُضمّن SHA النهائي داخل commit نفسه لأنه يغير SHA دائريًا؛ يثبت تطابق
رأس الفرع المحلي والبعيد بأمر Git بعد push ويسجل في تسليم المرحلة.
