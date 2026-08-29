'use strict';

(function initializePrototype() {
    const allowed = {
        screen: new Set(['home', 'table', 'results']),
        locale: new Set(['ar', 'en']),
        frame: new Set(['portrait', 'landscape'])
    };
    const params = new URLSearchParams(window.location.search);
    const state = {
        screen: allowed.screen.has(params.get('screen')) ? params.get('screen') : 'home',
        locale: allowed.locale.has(params.get('locale')) ? params.get('locale') : 'ar',
        frame: allowed.frame.has(params.get('frame')) ? params.get('frame') : 'portrait',
        capture: params.get('capture') === '1'
    };
    const device = document.getElementById('device');

    function render() {
        document.documentElement.lang = state.locale;
        document.documentElement.dir = state.locale === 'ar' ? 'rtl' : 'ltr';
        document.body.classList.toggle('capture', state.capture);
        device.className = `device ${state.frame} screen-${state.screen}`;

        document.querySelectorAll('[data-ar][data-en]').forEach(element => {
            element.textContent = element.dataset[state.locale];
        });
        document.querySelectorAll('[data-set]').forEach(button => {
            button.classList.toggle('active', state[button.dataset.set] === button.dataset.value);
        });

        const label = state.locale === 'ar' ? 'نموذج مرجعي' : 'Reference mockup';
        device.setAttribute('aria-label', `${label}: ${state.screen}, ${state.frame}`);
        document.title = `MEH UIX-0 — ${state.screen} / ${state.locale} / ${state.frame}`;
    }

    function updateQuery(key, value) {
        const url = new URL(window.location.href);
        url.searchParams.set(key, value);
        if (state.capture) url.searchParams.set('capture', '1');
        window.history.replaceState({}, '', url);
    }

    document.querySelectorAll('[data-set]').forEach(button => {
        button.addEventListener('click', () => {
            const key = button.dataset.set;
            const value = button.dataset.value;
            if (!allowed[key] || !allowed[key].has(value)) return;
            state[key] = value;
            updateQuery(key, value);
            render();
        });
    });

    render();
})();
