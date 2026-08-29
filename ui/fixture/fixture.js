'use strict';

const COPY = {
    ar: {
        skip: 'تخطَّ إلى المحتوى', reduceMotion: 'تقليل الحركة', fullMotion: 'الحركة الكاملة',
        eyebrow: 'الدائرة الحيّة / نظام الإنتاج', title: 'لغة واحدة لكل شاشة',
        intro: 'هذه المكونات هي نفسها التي يحمّلها التطبيق، وليست رسماً منفصلاً عنه.',
        actions: 'الأفعال', play: 'العب الآن', majalis: 'المجالس', unavailable: 'غير متاح', settings: 'الإعدادات',
        fields: 'الحقول', nameLabel: 'اسم اللاعب', namePlaceholder: 'مثال: نور', nameHint: 'يظهر لأعضاء المجلس فقط',
        codeLabel: 'رمز المجلس', codeError: 'تحقق من الرمز وحاول مرة أخرى', navigation: 'التنقل والحالة',
        collection: 'مجموعتي', store: 'المتجر', balance: '240 تاماشي', owned: '22 / 22 مملوكة',
        storeEmpty: 'لا توجد توسعة متاحة الآن', feedback: 'التغذية الراجعة', success: 'تم حفظ إعداداتك',
        warning: 'الاتصال ضعيف، لعبتك محفوظة', loading: 'نجهّز الطاولة…', surfaces: 'الأسطح والحوار',
        paper: 'ورق هادئ', bright: 'ورق مرتفع', ink: 'حبر', openDialog: 'افتح مثال الحوار',
        dialogTitle: 'اترك المجلس؟', dialogBody: 'ستعود إلى الرئيسية، ويمكنك الانضمام من الدعوة مرة أخرى.',
        stay: 'ابقَ هنا', leave: 'غادر', close: 'إغلاق'
    },
    en: {
        skip: 'Skip to content', reduceMotion: 'Reduce motion', fullMotion: 'Full motion',
        eyebrow: 'The Living Circle / Production system', title: 'One language for every screen',
        intro: 'These are the same components loaded by the game, not a separate illustration.',
        actions: 'Actions', play: 'Play now', majalis: 'Majalis', unavailable: 'Unavailable', settings: 'Settings',
        fields: 'Fields', nameLabel: 'Player name', namePlaceholder: 'Example: Noor', nameHint: 'Visible only to majlis members',
        codeLabel: 'Majlis code', codeError: 'Check the code and try again', navigation: 'Navigation and status',
        collection: 'My cards', store: 'Store', balance: '240 Tamashi', owned: '22 / 22 owned',
        storeEmpty: 'No expansion is available right now', feedback: 'Feedback', success: 'Your settings were saved',
        warning: 'Connection is weak; your game is safe', loading: 'Preparing the table…', surfaces: 'Surfaces and dialog',
        paper: 'Quiet paper', bright: 'Raised paper', ink: 'Ink', openDialog: 'Open dialog example',
        dialogTitle: 'Leave the majlis?', dialogBody: 'You will return home and can rejoin from the invite.',
        stay: 'Stay here', leave: 'Leave', close: 'Close'
    }
};

const params = new URLSearchParams(window.location.search);
let locale = params.get('locale') === 'en' ? 'en' : 'ar';
let scale = params.get('scale') === '200' ? '200' : '100';
let motion = params.get('motion') === 'reduced' ? 'reduced' : 'full';
let lastFocused = null;

const localeToggle = document.getElementById('locale-toggle');
const scaleToggle = document.getElementById('scale-toggle');
const motionToggle = document.getElementById('motion-toggle');
const dialogBackdrop = document.getElementById('dialog-backdrop');

function applyCopy() {
    const dictionary = COPY[locale];
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-copy]').forEach(element => {
        element.textContent = dictionary[element.dataset.copy];
    });
    document.querySelectorAll('[data-copy-aria]').forEach(element => {
        element.setAttribute('aria-label', dictionary[element.dataset.copyAria]);
    });
    document.querySelectorAll('[data-copy-placeholder]').forEach(element => {
        element.setAttribute('placeholder', dictionary[element.dataset.copyPlaceholder]);
    });
    localeToggle.textContent = locale === 'ar' ? 'EN' : 'عربي';
    scaleToggle.textContent = scale === '200' ? '100%' : '200%';
    motionToggle.textContent = dictionary[motion === 'reduced' ? 'fullMotion' : 'reduceMotion'];
    document.body.dataset.uiTextScale = scale;
    document.body.dataset.uiMotion = motion;
}

function setParam(name, value) {
    params.set(name, value);
    history.replaceState(null, '', `${location.pathname}?${params}`);
}

function closeDialog() {
    dialogBackdrop.hidden = true;
    document.body.style.overflow = '';
    if (lastFocused) lastFocused.focus();
}

localeToggle.addEventListener('click', () => {
    locale = locale === 'ar' ? 'en' : 'ar';
    setParam('locale', locale);
    applyCopy();
});

scaleToggle.addEventListener('click', () => {
    scale = scale === '100' ? '200' : '100';
    setParam('scale', scale);
    applyCopy();
});

motionToggle.addEventListener('click', () => {
    motion = motion === 'full' ? 'reduced' : 'full';
    setParam('motion', motion);
    applyCopy();
});

document.querySelectorAll('[role="tab"]').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('[role="tab"]').forEach(candidate => {
            const selected = candidate === tab;
            candidate.setAttribute('aria-selected', String(selected));
            candidate.tabIndex = selected ? 0 : -1;
            document.getElementById(candidate.getAttribute('aria-controls')).hidden = !selected;
        });
    });
});

document.getElementById('dialog-open').addEventListener('click', event => {
    lastFocused = event.currentTarget;
    dialogBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    document.getElementById('dialog-close').focus();
});

document.getElementById('dialog-close').addEventListener('click', closeDialog);
document.getElementById('dialog-cancel').addEventListener('click', closeDialog);
dialogBackdrop.addEventListener('click', event => {
    if (event.target === dialogBackdrop) closeDialog();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !dialogBackdrop.hidden) closeDialog();
});

applyCopy();
