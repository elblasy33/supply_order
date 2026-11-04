# -*- coding: utf-8 -*-
"""Builds docs/src/trial-plan.html and docs/TRIAL_TRACKER.xlsx from scenarios.py (one source of truth).
Run:  python3 docs/src/build_docs.py   then   node docs/src/print-pdf.mjs
"""
import html
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from scenarios import ROLES, S  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..")
e = html.escape

PRIO = {"حرج": "b-bad", "مهم": "b-warn", "عادي": "b-grey"}


def scenario_block(sc):
    sid, title, prio, mins, pre, steps, expected = sc
    steps_html = "".join(f"<li>{e(x)}</li>" for x in steps)
    exp_html = "".join(f"<li>{e(x)}</li>" for x in expected)
    return f"""
<div class="scn">
  <div class="scn-head"><span class="sid num">{sid}</span><b>{e(title)}</b>
    <span class="badge {PRIO[prio]}">{prio}</span><span class="small">حوالي <span class="num">{mins}</span> دقيقة</span></div>
  <p class="small"><b>قبل البدء:</b> {e(pre)}</p>
  <div class="cols">
    <div><b class="kufi">الخطوات</b><ol>{steps_html}</ol></div>
    <div><b class="kufi">النتيجة المتوقعة</b><ul>{exp_html}</ul></div>
  </div>
  <p class="res">النتيجة: <span class="check"></span> نجح &nbsp; <span class="check"></span> نجح بملاحظة &nbsp; <span class="check"></span> فشل &nbsp;&nbsp;|&nbsp;&nbsp; المختبِر: ________________ &nbsp; التاريخ: ____/____</p>
</div>"""


def role_sections():
    out = []
    for key in "ASWCX":
        name, css = ROLES[key]
        items = [s for s in S if s[0].startswith(key)]
        total = sum(s[3] for s in items)
        out.append(f'<h2><span class="chip {css}">{key}</span> {e(name)} <span class="small">— {len(items)} سيناريوهات، حوالي <span class="num">{total}</span> دقيقة</span></h2>')
        out.extend(scenario_block(s) for s in items)
    return "\n".join(out)


def summary_table():
    rows = []
    for key in "ASWCX":
        name, css = ROLES[key]
        items = [s for s in S if s[0].startswith(key)]
        crit = sum(1 for s in items if s[2] == "حرج")
        rows.append(f"<tr><td><span class='chip {css}'>{key}</span> {e(name)}</td><td class='num'>{len(items)}</td><td class='num'>{crit}</td><td class='num'>{sum(s[3] for s in items)}</td></tr>")
    total = f"<tr><td><b>المجموع</b></td><td class='num'><b>{len(S)}</b></td><td class='num'><b>{sum(1 for s in S if s[2]=='حرج')}</b></td><td class='num'><b>{sum(s[3] for s in S)}</b></td></tr>"
    return "<table><thead><tr><th>الدور</th><th>السيناريوهات</th><th>منها حرجة</th><th>الدقائق التقريبية</th></tr></thead><tbody>" + "".join(rows) + total + "</tbody></table>"


EXTRA_CSS = """
.scn { border: 1px solid var(--line); border-radius: 2.5mm; padding: 3mm 4mm; margin: 0 0 4mm; break-inside: avoid; }
.scn-head { display:flex; gap: 3mm; align-items:center; flex-wrap: wrap; font-size: 11.5pt; margin-bottom: 1mm; }
.scn-head .sid { background: var(--brand); color:#fff; border-radius: 1.5mm; padding: 0 2.5mm; font-family: "Noto Kufi Arabic"; font-size: 10pt; }
.scn .cols { display:flex; gap: 6mm; } .scn .cols > div { flex:1; } .scn ol, .scn ul { margin: 1mm 0 2mm; font-size: 10.3pt; line-height: 1.8; }
.scn .res { font-size: 9.5pt; margin: 2mm 0 0; border-top: 1px dashed var(--line); padding-top: 2mm; color: var(--muted); }
.line { display:inline-block; border-bottom: 1px solid #94a3b8; min-width: 38mm; height: 5mm; }
"""

PLAN = f"""<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>خطة التجربة والاختبار — نظام أوامر التوريد</title>
<link rel="stylesheet" href="style.css"><style>{EXTRA_CSS}</style></head><body>

<div class="cover">
  <div class="band">
    <img class="logo" src="../img/logo.png" alt="">
    <h1>خطة التجربة والاختبار</h1>
    <p class="sub">نظام أوامر التوريد — أودو 20 مع تطبيق الويب<br>دليل التجربة للإدارة والموظفين، وكيف تصلنا ملاحظاتكم</p>
  </div>
  <table>
    <tr><td class="small">الإصدار</td><td><b class="num">1.0</b></td></tr>
    <tr><td class="small">مدة التجربة</td><td><b>١٤ يوماً</b> (٢٠ ساعة تقريباً موزَّعة على المشاركين)</td></tr>
    <tr><td class="small">الموجَّه إلى</td><td>إدارة العميل، ومندوبو المبيعات، وأمناء المخازن، والمحاسبون</td></tr>
    <tr><td class="small">البيئة</td><td>قاعدة بيانات <b>تجريبية</b> + تطبيق ويب على نطاق فرعي بـ HTTPS — لا علاقة لها ببيانات الإنتاج</td></tr>
    <tr><td class="small">رابط التجربة</td><td>________________________________________</td></tr>
  </table>
</div>

<div class="section">
  <h1>١. الغرض وما نريده منكم</h1>
  <p>بنينا نظاماً يجعل <b>أمر التوريد</b> نقطة البداية، وتتبعه المستندات (التسليم، الفاتورة…) بحسب ما يحدث فعلاً. نريد أن نعرف قبل الإنتاج: <b>هل يطابق طريقة عملكم؟ وهل هو أسرع وأوضح من طريقتكم الحالية؟ وأين يتعثر موظفوكم؟</b></p>
  <div class="row">
    <div class="callout ok"><b>ما نختبره</b>
      <ul>
        <li>دورة الأمر كاملة: إنشاء ← تأكيد ← تسليم/استلام ← فاتورة ← تسوية.</li>
        <li>الحالات الواقعية: تسليم ناقص، استبدال، تعديل بعد التأكيد، مرتجع، استلام بتشغيلات.</li>
        <li>العدّ بكاميرا الجوال والتطبيق المثبَّت على الشاشة الرئيسية.</li>
        <li>الطباعة، لوحة المؤشرات، التنبيهات، الصلاحيات.</li>
      </ul></div>
    <div class="callout warn"><b>ما ليس هدف التجربة</b>
      <ul>
        <li>استبدال عملكم الحالي: تجري التجربة <b>بالتوازي</b> وعلى قاعدة تجريبية.</li>
        <li>اختبار الأداء بآلاف الأوامر.</li>
        <li>نقل بيانات من نظام قديم.</li>
        <li>تخصيصات جديدة؛ نجمعها كملاحظات لما بعد التجربة.</li>
      </ul></div>
  </div>
  <div class="callout"><b>الملاحظة الأهم عندنا ليست «نجح/فشل»</b>، بل «هذا غير مريح لأن…». كل جملة من نوع <i>«كنت أتوقع كذا فحدث كذا»</i> مفيدة جداً، ولو بدت صغيرة.</div>
</div>

<div class="section">
  <h1>٢. الجدول الزمني</h1>
  <table>
    <thead><tr><th>اليوم</th><th>النشاط</th><th>من يشارك</th><th>المخرج</th></tr></thead>
    <tbody>
      <tr><td class="num">٠ (قبل البدء)</td><td>تجهيز القاعدة التجريبية والبيانات وحسابات المستخدمين وتثبيت التطبيق على الجوالات (انظر ٤)</td><td>الفريق التقني + مسؤول التجربة لدى العميل</td><td>قائمة التجهيز مكتملة</td></tr>
      <tr><td class="num">١</td><td>تدريب: ساعة لكل دور (عرض حي + تجربة بأيديهم) + ٣٠ دقيقة أسئلة</td><td>كل المشاركين</td><td>كل مشارك سجّل دخوله وأنهى أول سيناريو</td></tr>
      <tr><td class="num">٢ – ٤</td><td><b>تجربة موجَّهة</b>: سيناريوهات دورك بالترتيب (القسم ٨)، وتسجيل النتيجة لكل سيناريو</td><td>كل مشارك بدوره</td><td>سجل النتائج + الملاحظات</td></tr>
      <tr><td class="num">٥ – ١٠</td><td><b>استخدام حر</b>: حالات أقرب للواقع (أوامر حقيقية مصغَّرة)، مع تجربة الحالات الشاذة التي تعرفونها ولم نفكر بها</td><td>كل مشارك</td><td>ملاحظات يومية + السجل اليومي</td></tr>
      <tr><td class="num">١١</td><td>إغلاق التجربة وتعبئة <b>الاستبيان</b> (القسم ٩)</td><td>كل مشارك</td><td>استبيان لكل مشارك</td></tr>
      <tr><td class="num">١٢</td><td><b>ورشة الملاحظات</b> (ساعتان): مراجعة كل ملاحظة وترتيب أولوياتها</td><td>مسؤول التجربة + ممثل عن كل دور + الفريق التقني</td><td>قائمة أولويات متفق عليها</td></tr>
      <tr><td class="num">١٣</td><td>خطة التعديلات وتقدير الوقت من جانبنا</td><td>الفريق التقني</td><td>خطة التعديلات</td></tr>
      <tr><td class="num">١٤</td><td>اجتماع القرار: إنتاج، أو جولة ثانية بعد التعديلات (انظر ١٠)</td><td>الإدارة</td><td>قرار مكتوب</td></tr>
    </tbody>
  </table>
  <p class="small">اجتماع يومي <b>١٠ دقائق</b> (حضوري أو مكالمة) أيام ٢–١٠ لحل العوائق السريعة، ومجموعة مراسلة للأسئلة العاجلة.</p>
</div>

<div class="section">
  <h1>٣. المشاركون والمسؤوليات</h1>
  <table class="form">
    <thead><tr><th>الدور</th><th>الاسم</th><th>الجوال (لتثبيت التطبيق)</th><th>بريد/واتساب</th></tr></thead>
    <tbody>
      <tr><td><span class="chip mgr">A</span> مدير/مسؤول التجربة (قرارات، صلاحيات)</td><td></td><td></td><td></td></tr>
      <tr><td><span class="chip sales">S</span> مندوب مبيعات ١</td><td></td><td></td><td></td></tr>
      <tr><td><span class="chip sales">S</span> مندوب مبيعات ٢</td><td></td><td></td><td></td></tr>
      <tr><td><span class="chip wh">W</span> أمين مخزن ١</td><td></td><td></td><td></td></tr>
      <tr><td><span class="chip wh">W</span> أمين مخزن ٢</td><td></td><td></td><td></td></tr>
      <tr><td><span class="chip acc">C</span> محاسب</td><td></td><td></td><td></td></tr>
      <tr><td>مسؤول تقني لدى العميل (الاتصال بأودو والشبكة)</td><td></td><td></td><td></td></tr>
    </tbody>
  </table>
  <p>يفضَّل <b>مشاركان على الأقل</b> في دور المخزن (أكثر دور يتأثر بالسرعة وعدّ الباركود) ومشارك من كل دور آخر.</p>
  <h2>المسؤوليات</h2>
  <table>
    <thead><tr><th>الجهة</th><th>تتولى</th></tr></thead>
    <tbody>
      <tr><td>مسؤول التجربة لدى العميل</td><td>توزيع السيناريوهات، متابعة التقدم يومياً، حضور الاجتماع اليومي والورشة، اعتماد الصلاحيات والحسابات المحاسبية</td></tr>
      <tr><td>كل مشارك</td><td>تنفيذ سيناريوهات دوره، تسجيل النتيجة والملاحظات يومياً، حضور التدريب والورشة</td></tr>
      <tr><td>فريقنا</td><td>تجهيز البيئة، التدريب، الدعم والإصلاح السريع أثناء التجربة حسب مستوى الخطورة، تجميع الملاحظات وترتيبها وتنفيذها</td></tr>
    </tbody>
  </table>
</div>

<div class="section">
  <h1>٤. التجهيز قبل البدء (اليوم ٠)</h1>
  <h2>من جانب العميل</h2>
  <table class="form">
    <thead><tr><th style="width:10mm"></th><th>البند</th><th>ملاحظات</th></tr></thead>
    <tbody>
      <tr><td><span class="check"></span></td><td>خادم أودو 20 تجريبي، أو قاعدة بيانات تجريبية على الخادم الحالي، مع صلاحية تثبيت موديولات</td><td></td></tr>
      <tr><td><span class="check"></span></td><td>نطاق فرعي (مثل supply.شركتكم.com) موجَّه لخادم التطبيق، ومنفذا ٨٠ و٤٤٣ مفتوحان</td><td></td></tr>
      <tr><td><span class="check"></span></td><td>أصناف تجريبية (٣٠ تقريباً) <b>بباركودات حقيقية صحيحة (EAN-13)</b> وأسعار وضرائب وفئات</td><td>الباركود بمجموع تحقق خاطئ لا يقرؤه الماسح</td></tr>
      <tr><td><span class="check"></span></td><td>صنفان متتبَّعان بالتشغيلات على الأقل، أحدهما بترقيم تلقائي، وتواريخ صلاحية ومهلة تنبيه على المنتج أو الفئة</td><td></td></tr>
      <tr><td><span class="check"></span></td><td>٥ عملاء و٣ موردين، وقائمة أسعار واحدة على الأقل</td><td></td></tr>
      <tr><td><span class="check"></span></td><td>أرصدة مخزون كافية للأصناف في المستودع الرئيسي</td><td></td></tr>
      <tr><td><span class="check"></span></td><td>قاعدة خصم شرطي واحدة، وبرنامج خصم تراكمي واحد، وحسابات الخصومات المؤجلة (مقترحة ومراجَعة من المحاسب)</td><td></td></tr>
      <tr><td><span class="check"></span></td><td>يومية بنك ودفعات بقيود يومية (لتجربة التسوية)</td><td>الدفعة بلا قيد لا تظهر في التسوية</td></tr>
      <tr><td><span class="check"></span></td><td>شعار الشركة وبياناتها في أودو (تظهر في الطباعة)</td><td></td></tr>
      <tr><td><span class="check"></span></td><td>ملصقات باركود مطبوعة للأصناف للتجربة بالكاميرا (على صناديق أو ورق)</td><td></td></tr>
      <tr><td><span class="check"></span></td><td>جوالات حديثة بمتصفح Chrome (أندرويد) أو Safari (آيفون)، ويفضَّل جهاز لكل أمين مخزن</td><td></td></tr>
    </tbody>
  </table>
  <h2>من جانبنا</h2>
  <table class="form">
    <tbody>
      <tr><td style="width:10mm"><span class="check"></span></td><td>تثبيت الموديولات على القاعدة التجريبية، وإنشاء مستخدم التكامل ومفتاحه</td></tr>
      <tr><td><span class="check"></span></td><td>نشر التطبيق على الحاوية بالنطاق وHTTPS، وفحص «الاتصال بأودو» بالنجاح الكامل</td></tr>
      <tr><td><span class="check"></span></td><td>إنشاء مستخدمي التجربة وتسليم كلمات المرور المؤقتة بشكل آمن</td></tr>
      <tr><td><span class="check"></span></td><td>إعداد سجل النتائج (الجدول الإلكتروني) ومجموعة المراسلة</td></tr>
      <tr><td><span class="check"></span></td><td>إجراء سيناريوهات الفريق الداخلي كاملة قبل تسليم التجربة (فحص دخان)</td></tr>
    </tbody>
  </table>
</div>

<div class="section">
  <h1>٥. قواعد التجربة</h1>
  <div class="row">
    <div class="callout ok"><b>افعل</b>
      <ul>
        <li>اعمل على القاعدة التجريبية فقط (الرابط في الغلاف).</li>
        <li>نفّذ السيناريو كما هو مكتوب أولاً، ثم جرّب بطريقتك.</li>
        <li>سجّل كل ما يدهشك: بطء، نص غير مفهوم، زر لم تجده، خطوة زائدة.</li>
        <li>خذ لقطة شاشة للمشكلة قبل أن تغادر الشاشة.</li>
        <li>جرّب الخطأ عمداً (كمية سالبة، إلغاء متأخر…) لترى كيف يتصرف النظام.</li>
      </ul></div>
    <div class="callout warn"><b>لا تفعل</b>
      <ul>
        <li>لا تدخل بيانات حساسة حقيقية لعملاء لا يعلمون.</li>
        <li>لا تُعِد المحاولة مراراً عند الخطأ: سجّله مرة وانتقل.</li>
        <li>لا تشارك كلمة المرور أو مفتاح API.</li>
        <li>لا تُجرِ تغييرات في إعدادات أودو (محاسبة، مخزون) دون التنسيق مع مسؤول التجربة.</li>
        <li>لا تعتمد على التجربة لتسليم فعلي لعميل حقيقي.</li>
      </ul></div>
  </div>
</div>

<div class="section">
  <h1>٦. معايير النجاح</h1>
  <p>نعتبر التجربة ناجحة ونوصي بالانتقال للإنتاج عند تحقق ما يلي (تُعدَّل بالاتفاق في اليوم الأول):</p>
  <table>
    <thead><tr><th>المعيار</th><th>الهدف</th><th>كيف نقيسه</th></tr></thead>
    <tbody>
      <tr><td>اكتمال السيناريوهات الحرجة</td><td><b>١٠٠٪</b> من السيناريوهات الحرجة منفَّذة، و<b>٩٠٪ على الأقل</b> منها «نجح» أو «نجح بملاحظة»</td><td>سجل النتائج</td></tr>
      <tr><td>ملاحظات الخطورة «حرجة»</td><td><b>صفر</b> مفتوحة في يوم القرار</td><td>سجل الملاحظات</td></tr>
      <tr><td>سلامة البيانات</td><td>تطابق ١٠ أوامر عيّنة بين التطبيق وأودو (الكميات والمبالغ والحالات) دون فرق</td><td>مراجعة المحاسب</td></tr>
      <tr><td>سرعة المخزن</td><td>عدّ إذن من ٢٠ سطراً بالكاميرا في <b>٣ دقائق أو أقل</b>، وليس أبطأ من الطريقة الحالية</td><td>السيناريو X4</td></tr>
      <tr><td>تقبّل الموظفين</td><td>متوسط الاستبيان <b>٤ من ٥ فأعلى</b> في «سهولة الاستخدام»، و«أفضّله على طريقتنا الحالية» عند أغلب المشاركين</td><td>الاستبيان (٩)</td></tr>
      <tr><td>الاعتمادية</td><td>لا فقد لبيانات محفوظة، وانقطاع الاتصال يُعرَض بوضوح ولا يخرّب شيئاً</td><td>A2، W12</td></tr>
      <tr><td>جودة الطباعة</td><td>يوافق مسؤول المبيعات والمحاسب على عرض السعر والفاتورة التجارية والفاتورة</td><td>S3، C2، X6</td></tr>
    </tbody>
  </table>
</div>

<div class="section">
  <h1>٧. كيف تُسجَّل الملاحظات وتصلنا</h1>
  <h2>ثلاث قنوات</h2>
  <table>
    <thead><tr><th>القناة</th><th>متى</th><th>ما يُكتب فيها</th></tr></thead>
    <tbody>
      <tr><td><b>سجل نتائج التجربة</b> (الجدول الإلكتروني)</td><td>أثناء التنفيذ</td><td>ورقة «السيناريوهات»: نتيجة كل سيناريو؛ ورقة «الملاحظات»: كل مشكلة أو اقتراح بسطر</td></tr>
      <tr><td><b>مجموعة المراسلة</b></td><td>للعاجل فقط (حرج أو «لا أستطيع المتابعة»)</td><td>سطر واحد + لقطة شاشة + الرقم في السجل</td></tr>
      <tr><td><b>الاجتماع اليومي</b> (١٠ دقائق)</td><td>أيام ٢–١٠</td><td>العوائق، وما تعلمناه اليوم، وما نحتاج توضيحه</td></tr>
    </tbody>
  </table>
  <h2>ماذا تكتب في الملاحظة؟</h2>
  <table>
    <thead><tr><th>الحقل</th><th>مثال</th></tr></thead>
    <tbody>
      <tr><td>رقم السيناريو (إن وُجد)</td><td>W3</td></tr>
      <tr><td>الشاشة</td><td>شاشة الإذن المخزني</td></tr>
      <tr><td>ماذا فعلتَ؟ (بالخطوات)</td><td>عددت ٦ من ١٠ ثم ضغطت «تأكيد التسليم»</td></tr>
      <tr><td>ماذا كنت تتوقع؟</td><td>أن يسألني عن المتبقي</td></tr>
      <tr><td>ماذا حدث؟</td><td>ظهرت النافذة لكن لم أفهم الفرق بين الخيارين</td></tr>
      <tr><td>الخطورة</td><td>متوسطة</td></tr>
      <tr><td>لقطة شاشة + الوقت + الجهاز</td><td>الصورة مرفقة · ١٠:٢٠ · آيفون ١٣</td></tr>
    </tbody>
  </table>
  <h2>مستويات الخطورة وزمن الاستجابة</h2>
  <table>
    <thead><tr><th>المستوى</th><th>التعريف</th><th>استجابتنا</th></tr></thead>
    <tbody>
      <tr><td><span class="badge b-bad">حرج</span></td><td>يمنع العمل، أو يُفسد/يُضيع بيانات، أو أرقام خاطئة في فاتورة أو مخزون</td><td>خلال <b>٤ ساعات عمل</b>: تشخيص، وحل أو حل بديل</td></tr>
      <tr><td><span class="badge b-warn">عالٍ</span></td><td>يُبطئ العمل كثيراً أو يتطلب حيلة للإنجاز، ولا يُفسد البيانات</td><td>خلال <b>يوم عمل</b></td></tr>
      <tr><td><span class="badge b-grey">متوسط</span></td><td>مزعج أو غير واضح، ويمكن العمل رغمه</td><td>يدخل في خطة التعديلات (يوم ١٣)</td></tr>
      <tr><td><span class="badge b-grey">منخفض</span></td><td>تجميلي أو صياغة</td><td>يُجمَّع للتحسين</td></tr>
      <tr><td><span class="badge b-ok">اقتراح</span></td><td>«لو كان يفعل كذا لكان أفضل»</td><td>يُناقش في الورشة</td></tr>
    </tbody>
  </table>
  <div class="callout"><b>كيف تأخذ لقطة شاشة؟</b> على الجوال: زر الطاقة + خفض الصوت (أندرويد) أو الطاقة + رفع الصوت (آيفون). على الحاسوب: <span class="code">Win + Shift + S</span>. أرفقها في الجدول أو أرسلها في المجموعة.</div>
</div>

<div class="section newpage">
  <h1>٨. السيناريوهات حسب الدور</h1>
  <p>لكل دور سيناريوهاته؛ ويُنصح أن يجرّب كل مشارك سيناريوهات دوره <b>ثم</b> يطّلع على سيناريوهات الأدوار الأخرى ليفهم الدورة كاملة. «حرج» يعني أنه لا يمكن اعتماد النظام دون نجاحه.</p>
  {summary_table()}
  <p class="small">تُسجَّل نتيجة كل سيناريو في الجدول الإلكتروني (ورقة «السيناريوهات»)، وتُترك هذه الصفحات للطباعة والتعبئة على الورق إن فُضِّل.</p>
</div>

<div class="section newpage" style="margin-top:0">
  {role_sections()}
</div>

<div class="section newpage">
  <h1>٩. الاستبيان النهائي (اليوم ١١)</h1>
  <p>عبّئه كل مشارك على حدة. التقدير من ١ (لا أوافق إطلاقاً) إلى ٥ (أوافق تماماً).</p>
  <table class="form">
    <thead><tr><th>العبارة</th><th style="width:9mm">١</th><th style="width:9mm">٢</th><th style="width:9mm">٣</th><th style="width:9mm">٤</th><th style="width:9mm">٥</th></tr></thead>
    <tbody>
      <tr><td>فهمت ما أفعله في كل شاشة دون مساعدة</td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>أنجز مهامي بسرعة تكفي ضغط العمل الحقيقي</td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>الرسائل والتنبيهات واضحة وتقول لي ماذا أفعل</td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>أثق في الأرقام والكميات التي يعرضها</td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>استخدام الجوال (الكاميرا/التطبيق) مريح في ظروف عملي الفعلية</td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>الطباعة (عرض السعر/الفاتورة) تصلح للإرسال كما هي</td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>الدورة تطابق الطريقة التي نعمل بها فعلاً</td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>أفضّل هذا النظام على طريقتنا الحالية</td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>أستطيع تدريب زميل جديد عليه في ساعة</td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>أوصي بتشغيله في العمل الفعلي</td><td></td><td></td><td></td><td></td><td></td></tr>
    </tbody>
  </table>
  <h2>أسئلة مفتوحة</h2>
  <table class="form">
    <tbody>
      <tr><td>أكثر شيء أعجبك؟</td></tr><tr><td style="height:14mm"></td></tr>
      <tr><td>أكثر شيء أزعجك أو أبطأك؟</td></tr><tr><td style="height:14mm"></td></tr>
      <tr><td>ما الذي ينقص ولا بد منه قبل التشغيل الفعلي؟</td></tr><tr><td style="height:14mm"></td></tr>
      <tr><td>موقف في عملكم لم تغطّه السيناريوهات وتتمنى أن نجرّبه:</td></tr><tr><td style="height:14mm"></td></tr>
    </tbody>
  </table>
  <p>الاسم (اختياري): <span class="line"></span> &nbsp; الدور: <span class="line"></span> &nbsp; التاريخ: <span class="line" style="min-width:25mm"></span></p>
</div>

<div class="section">
  <h1>١٠. ورشة الملاحظات والقرار</h1>
  <h2>جدول الورشة (ساعتان، اليوم ١٢)</h2>
  <table>
    <thead><tr><th>الوقت</th><th>البند</th></tr></thead>
    <tbody>
      <tr><td class="num">١٠ د</td><td>نتائج السيناريوهات والاستبيان بالأرقام</td></tr>
      <tr><td class="num">٣٠ د</td><td>الملاحظات الحرجة والعالية: لكل واحدة نتفق على ما نفعله ومتى</td></tr>
      <tr><td class="num">٣٠ د</td><td>الملاحظات المتوسطة: نصنّف «قبل التشغيل» أو «بعده»</td></tr>
      <tr><td class="num">٢٠ د</td><td>الاقتراحات والتحسينات الجديدة (بأولوية من القائمة)</td></tr>
      <tr><td class="num">٢٠ د</td><td>القرارات المفتوحة: الصلاحيات، الحسابات، العملات، الاحتياجات الإضافية</td></tr>
      <tr><td class="num">١٠ د</td><td>ملخص وموعد اجتماع القرار</td></tr>
    </tbody>
  </table>
  <h2>خيارات القرار (اليوم ١٤)</h2>
  <table>
    <thead><tr><th>القرار</th><th>متى</th><th>التالي</th></tr></thead>
    <tbody>
      <tr><td><span class="badge b-ok">انتقال للإنتاج</span></td><td>تحققت معايير النجاح، وما تبقى لا يمنع العمل</td><td>خطة نقل البيانات الفعلية، تدريب كل الموظفين، تشغيل متوازٍ أسبوعاً ثم قطع</td></tr>
      <tr><td><span class="badge b-warn">جولة ثانية</span></td><td>ملاحظات جوهرية تحتاج تعديلاً قبل الإنتاج</td><td>تنفيذ التعديلات، ثم تجربة أقصر (٥ أيام) على السيناريوهات الفاشلة والمعدّلة</td></tr>
      <tr><td><span class="badge b-bad">إعادة نظر</span></td><td>الدورة لا تطابق عملكم في نقطة أساسية</td><td>جلسة تصميم مع المسؤولين لتعديل الفكرة</td></tr>
    </tbody>
  </table>
</div>

<div class="section newpage">
  <h1>ملحق أ: السجل اليومي (يُعبَّأ آخر كل يوم)</h1>
  <p>الاسم: <span class="line"></span> &nbsp; الدور: <span class="line"></span></p>
  <table class="form">
    <thead><tr><th style="width:22mm">اليوم</th><th>السيناريوهات التي أنجزتها</th><th>الزمن</th><th>أهم ملاحظة/مشكلة</th></tr></thead>
    <tbody>{"".join("<tr><td class='num'>"+str(i)+"</td><td></td><td></td><td></td></tr>" for i in range(2, 12))}</tbody>
  </table>
</div>

<div class="section">
  <h1>ملحق ب: نموذج ملاحظة (للطباعة)</h1>
  <table class="form">
    <tbody>
      <tr><td style="width:40mm">رقم السيناريو</td><td></td><td style="width:30mm">التاريخ/الوقت</td><td></td></tr>
      <tr><td>الشاشة</td><td colspan="3"></td></tr>
      <tr><td>ماذا فعلتُ (بالخطوات)</td><td colspan="3" style="height:22mm"></td></tr>
      <tr><td>ماذا كنت أتوقع</td><td colspan="3" style="height:14mm"></td></tr>
      <tr><td>ماذا حدث</td><td colspan="3" style="height:14mm"></td></tr>
      <tr><td>الخطورة</td><td colspan="3"><span class="check"></span> حرج &nbsp; <span class="check"></span> عالٍ &nbsp; <span class="check"></span> متوسط &nbsp; <span class="check"></span> منخفض &nbsp; <span class="check"></span> اقتراح</td></tr>
      <tr><td>الجهاز والمتصفح</td><td colspan="3"></td></tr>
      <tr><td>لقطة شاشة مرفقة</td><td colspan="3"><span class="check"></span> نعم &nbsp; <span class="check"></span> لا</td></tr>
    </tbody>
  </table>
  <h2>أسئلة شائعة قبل التجربة</h2>
  <ul>
    <li><b>هل التجربة تؤثر على بياناتنا الحقيقية؟</b> لا. هي على قاعدة بيانات وتطبيق منفصلين.</li>
    <li><b>هل يتأثر عملنا اليومي؟</b> لا. التجربة بالتوازي، والتدريب ساعة لكل دور فقط.</li>
    <li><b>ماذا لو وجدتُ مشكلة ولم أعرف إن كانت مشكلة؟</b> سجّلها كملاحظة «اقتراح» أو «أسئلة»، وسنقرر معكم.</li>
    <li><b>لا تعمل الكاميرا؟</b> الأسباب الشائعة: الرابط ليس HTTPS، أو رُفض إذن الكاميرا (يظهر شرح على الشاشة)، أو الباركود بمجموع تحقق خاطئ.</li>
    <li><b>من أتصل به عند التعطل؟</b> مجموعة المراسلة، وللحرج: __________________________</li>
  </ul>
</div>

</body></html>
"""

with open(os.path.join(HERE, "trial-plan.html"), "w", encoding="utf-8") as f:
    f.write(PLAN)

# ------------------------------------------------------------------ xlsx tracker
from openpyxl import Workbook  # noqa: E402
from openpyxl.formatting.rule import CellIsRule, FormulaRule  # noqa: E402
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side  # noqa: E402
from openpyxl.utils import get_column_letter  # noqa: E402
from openpyxl.worksheet.datavalidation import DataValidation  # noqa: E402

TEAL = "0B7882"
head_fill = PatternFill("solid", fgColor=TEAL)
head_font = Font(name="Arial", bold=True, color="FFFFFF", size=11)
thin = Side(style="thin", color="DFE5EC")
border = Border(left=thin, right=thin, top=thin, bottom=thin)
wrap = Alignment(wrap_text=True, vertical="top", horizontal="right")


def style_header(ws, row=1):
    for c in ws[row]:
        c.fill, c.font, c.border = head_fill, head_font, border
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[row].height = 28


def widths(ws, ws_widths):
    for i, w in enumerate(ws_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


wb = Workbook()

# --- scenarios
ws = wb.active
ws.title = "السيناريوهات"
ws.sheet_view.rightToLeft = True
ws.append(["الرقم", "الدور", "السيناريو", "الأولوية", "الزمن المقدَّر (د)", "قبل البدء", "الخطوات", "النتيجة المتوقعة", "النتيجة", "المختبِر", "التاريخ", "الزمن الفعلي (د)", "ملاحظات / رقم الملاحظة"])
style_header(ws)
role_name = {k: v[0] for k, v in ROLES.items()}
for sid, title, prio, mins, pre, steps, exp in S:
    ws.append([sid, role_name[sid[0]], title, prio, mins, pre,
               "\n".join(f"{i}. {s}" for i, s in enumerate(steps, 1)),
               "\n".join(f"• {s}" for s in exp), "لم يُجرَّب", "", None, None, ""])
for row in ws.iter_rows(min_row=2):
    for c in row:
        c.alignment = wrap
        c.border = border
        c.font = Font(name="Arial", size=10)
    ws.row_dimensions[row[0].row].height = 128
    row[0].font = Font(name="Arial", size=10, bold=True)
    row[8].font = Font(name="Arial", size=10, bold=True)
    row[10].number_format = "yyyy-mm-dd"
widths(ws, [8, 18, 30, 10, 11, 26, 48, 44, 14, 16, 12, 12, 34])
n = len(S) + 1
dv = DataValidation(type="list", formula1='"لم يُجرَّب,نجح,نجح بملاحظة,فشل,تعذّر التنفيذ"', allow_blank=False)
ws.add_data_validation(dv)
dv.add(f"I2:I{n}")
green = PatternFill("solid", bgColor="C6EFCE", fgColor="C6EFCE")
amber = PatternFill("solid", bgColor="FFEB9C", fgColor="FFEB9C")
red = PatternFill("solid", bgColor="FFC7CE", fgColor="FFC7CE")
grey = PatternFill("solid", bgColor="E7E6E6", fgColor="E7E6E6")
rng = f"I2:I{n}"
ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"نجح"'], fill=green))
ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"نجح بملاحظة"'], fill=amber))
ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"فشل"'], fill=red))
ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"تعذّر التنفيذ"'], fill=red))
ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=['"لم يُجرَّب"'], fill=grey))
ws.freeze_panes = "D2"
ws.auto_filter.ref = f"A1:M{n}"

# --- notes
wn = wb.create_sheet("الملاحظات")
wn.sheet_view.rightToLeft = True
wn.append(["#", "التاريخ", "المُبلِّغ", "الدور", "رقم السيناريو", "الشاشة", "ماذا فعلتُ", "ماذا كنت أتوقع", "ماذا حدث", "الخطورة", "الجهاز / المتصفح", "لقطة شاشة (رابط/اسم ملف)", "الحالة", "ردّنا / الإصلاح", "تاريخ الإغلاق"])
style_header(wn)
for i in range(1, 201):
    wn.append([i] + [""] * 14)
for row in wn.iter_rows(min_row=2, max_row=201):
    for c in row:
        c.alignment = wrap
        c.border = border
        c.font = Font(name="Arial", size=10)
    row[1].number_format = "yyyy-mm-dd"
    row[14].number_format = "yyyy-mm-dd"
widths(wn, [5, 12, 16, 14, 10, 20, 36, 30, 36, 11, 18, 22, 14, 34, 12])
dv2 = DataValidation(type="list", formula1='"حرج,عالٍ,متوسط,منخفض,اقتراح"', allow_blank=True)
dv3 = DataValidation(type="list", formula1='"جديدة,قيد الدراسة,قيد الإصلاح,تم الإصلاح,بانتظار تأكيدكم,مؤجلة,مرفوضة"', allow_blank=True)
dv4 = DataValidation(type="list", formula1='"مدير,مندوب مبيعات,أمين مخزن,محاسب"', allow_blank=True)
for d in (dv2, dv3, dv4):
    wn.add_data_validation(d)
dv2.add("J2:J201"); dv3.add("M2:M201"); dv4.add("D2:D201")
wn.conditional_formatting.add("J2:J201", CellIsRule(operator="equal", formula=['"حرج"'], fill=red))
wn.conditional_formatting.add("J2:J201", CellIsRule(operator="equal", formula=['"عالٍ"'], fill=amber))
wn.conditional_formatting.add("M2:M201", CellIsRule(operator="equal", formula=['"تم الإصلاح"'], fill=green))
wn.freeze_panes = "A2"
wn.auto_filter.ref = "A1:O201"

# --- survey
wq = wb.create_sheet("الاستبيان")
wq.sheet_view.rightToLeft = True
statements = [
    "فهمت ما أفعله في كل شاشة دون مساعدة", "أنجز مهامي بسرعة تكفي ضغط العمل الحقيقي", "الرسائل والتنبيهات واضحة وتقول لي ماذا أفعل",
    "أثق في الأرقام والكميات التي يعرضها", "استخدام الجوال (الكاميرا/التطبيق) مريح في ظروف عملي الفعلية", "الطباعة (عرض السعر/الفاتورة) تصلح للإرسال كما هي",
    "الدورة تطابق الطريقة التي نعمل بها فعلاً", "أفضّل هذا النظام على طريقتنا الحالية", "أستطيع تدريب زميل جديد عليه في ساعة", "أوصي بتشغيله في العمل الفعلي",
]
wq.append(["العبارة (التقدير من ١ إلى ٥)", "المتوسط"] + [f"مشارك {i}" for i in range(1, 11)] + ["أكثر ما أعجبه", "أكثر ما أزعجه"])
style_header(wq)
for i, st in enumerate(statements, start=2):
    wq.append([st, f"=IF(COUNT(C{i}:L{i})=0,\"\",ROUND(AVERAGE(C{i}:L{i}),2))"] + [None] * 10)
for row in wq.iter_rows(min_row=2, max_row=len(statements) + 1):
    for c in row:
        c.border = border
        c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center" if c.column > 1 else "right")
        c.font = Font(name="Arial", size=10)
    row[1].font = Font(name="Arial", size=10, bold=True)
dvs = DataValidation(type="whole", operator="between", formula1="1", formula2="5", allow_blank=True)
wq.add_data_validation(dvs)
dvs.add(f"C2:L{len(statements)+1}")
wq.conditional_formatting.add(f"B2:B{len(statements)+1}", CellIsRule(operator="greaterThanOrEqual", formula=["4"], fill=green))
wq.conditional_formatting.add(f"B2:B{len(statements)+1}", CellIsRule(operator="lessThan", formula=["3"], fill=red))
widths(wq, [52, 10] + [10] * 10 + [30, 30])
wq.freeze_panes = "C2"

# --- summary
wsu = wb.create_sheet("الملخص", 0)
wsu.sheet_view.rightToLeft = True
wsu["A1"] = "ملخص نتائج التجربة — نظام أوامر التوريد"
wsu["A1"].font = Font(name="Arial", bold=True, size=16, color=TEAL)
wsu.merge_cells("A1:E1")
rows = [
    ("السيناريوهات (المجموع)", f"=COUNTA('السيناريوهات'!A2:A{n})"),
    ("نجح", f"=COUNTIF('السيناريوهات'!I2:I{n},\"نجح\")"),
    ("نجح بملاحظة", f"=COUNTIF('السيناريوهات'!I2:I{n},\"نجح بملاحظة\")"),
    ("فشل", f"=COUNTIF('السيناريوهات'!I2:I{n},\"فشل\")"),
    ("تعذّر التنفيذ", f"=COUNTIF('السيناريوهات'!I2:I{n},\"تعذّر التنفيذ\")"),
    ("لم يُجرَّب", f"=COUNTIF('السيناريوهات'!I2:I{n},\"لم يُجرَّب\")"),
    ("نسبة الإنجاز (المنفَّذ من المجموع)", "=IF(B3=0,0,(B3-B8)/B3)"),
    ("السيناريوهات الحرجة (المجموع)", f"=COUNTIF('السيناريوهات'!D2:D{n},\"حرج\")"),
    ("الحرجة المنفَّذة (ليست «لم يُجرَّب»)", f"=COUNTIFS('السيناريوهات'!D2:D{n},\"حرج\",'السيناريوهات'!I2:I{n},\"<>لم يُجرَّب\")"),
    ("الحرجة الناجحة (نجح أو نجح بملاحظة)", f"=COUNTIFS('السيناريوهات'!D2:D{n},\"حرج\",'السيناريوهات'!I2:I{n},\"نجح\")+COUNTIFS('السيناريوهات'!D2:D{n},\"حرج\",'السيناريوهات'!I2:I{n},\"نجح بملاحظة\")"),
    ("نسبة نجاح الحرجة من المنفَّذة (الهدف ٩٠٪)", "=IF(B11=0,0,B12/B11)"),
    ("ملاحظات حرجة مفتوحة (الهدف: صفر)", "=COUNTIFS('الملاحظات'!J2:J201,\"حرج\",'الملاحظات'!M2:M201,\"<>تم الإصلاح\",'الملاحظات'!M2:M201,\"<>مرفوضة\")-COUNTIFS('الملاحظات'!J2:J201,\"حرج\",'الملاحظات'!M2:M201,\"\")+COUNTIFS('الملاحظات'!J2:J201,\"حرج\",'الملاحظات'!M2:M201,\"\")"),
    ("إجمالي الملاحظات المسجَّلة", "=COUNTA('الملاحظات'!G2:G201)"),
    ("متوسط الاستبيان — «أفضّله على طريقتنا الحالية» (الهدف ≥ ٤)", "='الاستبيان'!B9"),
    ("متوسط الاستبيان — «سهولة الفهم» (الهدف ≥ ٤)", "='الاستبيان'!B2"),
]
wsu.append([])
wsu.append(["المؤشر", "القيمة"])
style_header(wsu, 3)
# rows start at 4 => B3 reference in formulas above must be row-aligned: rebuild with explicit rows
for i, (label, formula) in enumerate(rows, start=4):
    wsu.cell(row=i, column=1, value=label)
    wsu.cell(row=i, column=2, value=formula)

# fix references (rows are 4..): map labels to their rows
ref = {label: i for i, (label, _) in enumerate(rows, start=4)}
total_r, notrun_r = ref["السيناريوهات (المجموع)"], ref["لم يُجرَّب"]
crit_r, crit_done_r, crit_ok_r = ref["السيناريوهات الحرجة (المجموع)"], ref["الحرجة المنفَّذة (ليست «لم يُجرَّب»)"], ref["الحرجة الناجحة (نجح أو نجح بملاحظة)"]
wsu.cell(row=ref["نسبة الإنجاز (المنفَّذ من المجموع)"], column=2, value=f"=IF(B{total_r}=0,0,(B{total_r}-B{notrun_r})/B{total_r})")
wsu.cell(row=ref["نسبة نجاح الحرجة من المنفَّذة (الهدف ٩٠٪)"], column=2, value=f"=IF(B{crit_done_r}=0,0,B{crit_ok_r}/B{crit_done_r})")
wsu.cell(row=ref["ملاحظات حرجة مفتوحة (الهدف: صفر)"], column=2,
         value="=COUNTIFS('الملاحظات'!J2:J201,\"حرج\")-COUNTIFS('الملاحظات'!J2:J201,\"حرج\",'الملاحظات'!M2:M201,\"تم الإصلاح\")-COUNTIFS('الملاحظات'!J2:J201,\"حرج\",'الملاحظات'!M2:M201,\"مرفوضة\")")
wsu.cell(row=ref["متوسط الاستبيان — «أفضّله على طريقتنا الحالية» (الهدف ≥ ٤)"], column=2, value="='الاستبيان'!B9")
wsu.cell(row=ref["متوسط الاستبيان — «سهولة الفهم» (الهدف ≥ ٤)"], column=2, value="='الاستبيان'!B2")
for r in range(4, 4 + len(rows)):
    for c in (1, 2):
        cell = wsu.cell(row=r, column=c)
        cell.border = border
        cell.font = Font(name="Arial", size=11, bold=(c == 2))
        cell.alignment = Alignment(horizontal="right" if c == 1 else "center", vertical="center", wrap_text=True)
    wsu.row_dimensions[r].height = 24
for label in ("نسبة الإنجاز (المنفَّذ من المجموع)", "نسبة نجاح الحرجة من المنفَّذة (الهدف ٩٠٪)"):
    wsu.cell(row=ref[label], column=2).number_format = "0%"
ok_r = ref["نسبة نجاح الحرجة من المنفَّذة (الهدف ٩٠٪)"]
wsu.conditional_formatting.add(f"B{ok_r}", CellIsRule(operator="greaterThanOrEqual", formula=["0.9"], fill=green))
wsu.conditional_formatting.add(f"B{ok_r}", CellIsRule(operator="lessThan", formula=["0.9"], fill=red))
open_r = ref["ملاحظات حرجة مفتوحة (الهدف: صفر)"]
wsu.conditional_formatting.add(f"B{open_r}", CellIsRule(operator="equal", formula=["0"], fill=green))
wsu.conditional_formatting.add(f"B{open_r}", CellIsRule(operator="greaterThan", formula=["0"], fill=red))
widths(wsu, [62, 16, 14, 14, 14])
wsu.cell(row=4 + len(rows) + 1, column=1, value="كيف يُستخدم: عبّئ أوراق «السيناريوهات» و«الملاحظات» و«الاستبيان»، فيتحدث هذا الملخص تلقائياً.").font = Font(name="Arial", size=10, italic=True, color="5F6B7A")

# --- guide sheet
wg = wb.create_sheet("تعليمات")
wg.sheet_view.rightToLeft = True
lines = [
    ("سجل نتائج التجربة — نظام أوامر التوريد", True),
    ("", False),
    ("١. ورقة «السيناريوهات»: ابدأ بسيناريوهات دورك. بعد كل سيناريو اختر النتيجة من القائمة، واكتب اسمك وتاريخ التنفيذ والزمن الفعلي.", False),
    ("٢. إن حدث أي شيء غير متوقع (حتى لو نجح السيناريو) سجّله في ورقة «الملاحظات» واكتب رقم الملاحظة في عمود «ملاحظات» بالسيناريو.", False),
    ("٣. ورقة «الملاحظات»: سطر لكل مشكلة أو اقتراح. اكتب: ماذا فعلتَ، ماذا توقعتَ، ماذا حدث، ثم اختر الخطورة. أرفق لقطة شاشة (اسم الملف).", False),
    ("٤. مستويات الخطورة: حرج (يمنع العمل أو يفسد بيانات)، عالٍ (يبطئ كثيراً)، متوسط (مزعج)، منخفض (تجميلي)، اقتراح.", False),
    ("٥. «الحالة» و«ردّنا» نعبّئهما نحن؛ تأكد من «بانتظار تأكيدكم» لكل إصلاح بعد تجربته.", False),
    ("٦. ورقة «الاستبيان»: يعبّئها المشاركون في اليوم ١١ بتقدير من ١ إلى ٥.", False),
    ("٧. ورقة «الملخص» تُحسب وحدها وتعرض معايير النجاح (٩٠٪ من الحرجة، صفر ملاحظات حرجة مفتوحة، متوسط الاستبيان ≥ ٤).", False),
]
for i, (t, bold) in enumerate(lines, start=1):
    c = wg.cell(row=i, column=1, value=t)
    c.font = Font(name="Arial", size=14 if bold else 11, bold=bold, color=TEAL if bold else "17212B")
    c.alignment = Alignment(wrap_text=True, vertical="top", horizontal="right")
    wg.row_dimensions[i].height = 40 if not bold else 30
wg.column_dimensions["A"].width = 120

wb.save(os.path.join(OUT, "TRIAL_TRACKER.xlsx"))
print("built: trial-plan.html, TRIAL_TRACKER.xlsx with", len(S), "scenarios")
